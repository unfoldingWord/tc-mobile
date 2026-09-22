import type { BookId, ChapterId, SegmentId } from "@/types/domain";
import type { BookCard, SegmentRow } from "@/types/view";

/**
 * The control the guide is pointing at right now, or `null` for "nothing".
 *
 * One member per step of #604's chain. The screens compare `kind` and paint
 * `is-guided` on the one control it names — they never re-derive the rule, so
 * "where is the accent" has exactly one answer per state, and moving it is a
 * change to this file rather than to three screens.
 */
export type GuidedStep =
  | { readonly kind: "new-book" }
  | { readonly kind: "create-book" }
  | { readonly kind: "add-chapter"; readonly bookId: BookId }
  | { readonly kind: "expand-book"; readonly bookId: BookId }
  | { readonly kind: "open-chapter"; readonly chapterId: ChapterId }
  | { readonly kind: "add-segment" }
  | { readonly kind: "open-segment"; readonly segmentId: SegmentId }
  | { readonly kind: "record" };

/**
 * What a screen already knows, and nothing more. Every field is state the
 * screen holds for its own rendering — the guide adds no storage read, so it
 * cannot answer a question its host screen could not already answer.
 */
export type GuideView =
  | {
      readonly screen: "books";
      /** The shelf read has completed. */
      readonly loaded: boolean;
      /** The New Book naming dialog (#314) is open. */
      readonly naming: boolean;
      readonly books: readonly BookCard[];
      /**
       * The books whose chapter lists are open. Screen state, not stored: it
       * resets every time the shelf remounts — coming Back from Segments, or
       * on a reload — which is why the guide has to ask.
       */
      readonly expandedBooks: ReadonlySet<BookId>;
    }
  | {
      readonly screen: "segments";
      /** The chapter read has completed. */
      readonly loaded: boolean;
      /** The rows the screen is already rendering. */
      readonly segments: readonly SegmentRow[];
    }
  | {
      readonly screen: "recorder";
      /** The segment view has loaded; Record is inert until it has. */
      readonly loaded: boolean;
      /** The working buffer holds audio — an existing clip, or an edit of one. */
      readonly hasAudio: boolean;
    };

/**
 * Which control is the next REQUIRED action, for a first-time user walking the
 * app from an empty shelf to a first recording (#604).
 *
 * The chain is: New Book -> Create book -> Add chapter -> (open the book) ->
 * open that chapter -> Add segment -> that segment's Record -> the recorder's
 * Record. It ends there, and that is a decision rather than an
 * omission: the guide exists to reach a first recording without instruction,
 * and once a recording exists in the book there is no further step the app can
 * call required — marking a segment Finished is the translator's judgement, not
 * a next tap. So this returns `null` for every state past the first take, and
 * the accent leaves the screen entirely.
 *
 * `null` is also the answer while a screen is still reading. An unread shelf
 * and an empty one are the same value in `books`, and the empty-shelf step is
 * the loudest one in the chain, so guiding before the read lands would flash
 * the ring on New Book at every launch — including the launches that have
 * books.
 */
export function guidedStep(view: GuideView): GuidedStep | null {
  switch (view.screen) {
    case "books":
      return booksStep(view);
    case "segments":
      return segmentsStep(view);
    case "recorder":
      // Steps 7 and 8 in one condition. A take is spliced into the working
      // buffer only when the sheet closes (Model A, commit-on-close — the
      // `Recorder` component's own docblock, "a take is committed when the
      // sheet closes (F8)"), so `hasAudio` stays false for the
      // whole of a first take and the ring does not blink out the instant
      // Record is tapped. It turns true on the next open, where the guide is
      // over.
      return view.loaded && !view.hasAudio ? { kind: "record" } : null;
  }
}

function segmentsStep(
  view: Extract<GuideView, { screen: "segments" }>
): GuidedStep | null {
  if (!view.loaded) return null;
  const { segments } = view;
  if (segments.length === 0) return { kind: "add-segment" };
  // The terminal rule on this screen. `hasClip` and not `activeTakeId`: a
  // dangling or undecodable clip reads as never-recorded in the row itself
  // (F3, `types/view.ts`), and a guide that disagreed with the row would point
  // at a finished-looking segment or skip a broken one.
  if (segments.some((segment) => segment.hasClip)) return null;
  // The hop between "Add segment" and the recorder. A segment with no audio is
  // not the end of the chain — the row's red Record is the only door to the
  // recorder, and a first-time user has never seen it.
  const first = segments.find((segment) => !segment.hasClip);
  return first ? { kind: "open-segment", segmentId: first.segmentId } : null;
}

function booksStep(
  view: Extract<GuideView, { screen: "books" }>
): GuidedStep | null {
  if (!view.loaded) return null;
  const { books } = view;
  if (books.length === 0)
    // The dialog's Confirm, not its field: the field arrives pre-filled with
    // the placeholder (#314), so Confirm alone completes the create and typing
    // is optional.
    return view.naming ? { kind: "create-book" } : { kind: "new-book" };
  // Past the first run. Someone making a second book has done this before, and
  // naming it is not a step anyone needs walked through.
  if (books.length > 1 || view.naming) return null;
  const book = books[0];
  if (!book) return null;
  if (book.chapters.length === 0)
    return { kind: "add-chapter", bookId: book.bookId };
  // The Books half of the terminal rule. `ChapterRow` carries segment counts
  // and no take information (`types/view.ts`), and the guide takes no reading
  // of its own, so "a chapter holds segments" is the strongest honest reading
  // of "this book has been worked in" available on the shelf.
  if (book.chapters.some((chapter) => chapter.totalCount > 0)) return null;
  const first = book.chapters[0];
  if (!first) return null;
  // A collapsed book renders no chapter rows, so the row this step names is
  // not on screen to be marked and the accent would simply vanish — which is
  // what happens on the two most ordinary paths there are: Back from Segments,
  // and a reload. Both remount the shelf and reset `expanded`. The step before
  // it is then the required one: open the book.
  return view.expandedBooks.has(book.bookId)
    ? { kind: "open-chapter", chapterId: first.chapterId }
    : { kind: "expand-book", bookId: book.bookId };
}

/**
 * Whether the recorder's Record wears the ring right now (#604 step 8).
 *
 * Separate from {@link guidedStep} because the two answers come apart. The
 * step stays `record` for the whole of a first take — that is the chain's
 * answer and it is correct — while the BUTTON goes inert twice on the way
 * there and back: once while `getUserMedia` is in flight (`requesting`) and
 * once while the take is being sealed (`processing`). A gate keyed on the
 * button's inertness alone blinked the ring off at the tap and again at the
 * end, which is exactly what step 8 says must not happen.
 *
 * So: a take in flight keeps the ring, whatever the button's own state; at
 * idle the ring follows the button, because an idle control that is refusing
 * taps (a sounding preview, a finger on the stage) is the guide asking for
 * something the app is declining; and the closing sheet drops it, because that
 * is the one reason that outlasts the tap rather than resolving in a moment.
 */
export function guidedRecordShown(input: {
  readonly step: GuidedStep | null;
  /** The recorder is not idle — requesting, recording, paused or processing. */
  readonly takeInFlight: boolean;
  /** The sheet is committing and leaving. */
  readonly isClosing: boolean;
  /** `recordDisabled(...)` — the button's own gate. */
  readonly recordInert: boolean;
}): boolean {
  if (input.step?.kind !== "record") return false;
  if (input.isClosing) return false;
  return input.takeInFlight || !input.recordInert;
}
