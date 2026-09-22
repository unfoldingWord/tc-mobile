import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

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
  | { readonly kind: "open-chapter"; readonly chapterId: ChapterId }
  | { readonly kind: "add-segment" }
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
    }
  | {
      readonly screen: "segments";
      /** The chapter read has completed. */
      readonly loaded: boolean;
      readonly segmentCount: number;
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
 * The chain is: New Book -> Create book -> Add chapter -> open that chapter ->
 * Add segment -> Record. It ends there, and that is a decision rather than an
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
      return view.loaded && view.segmentCount === 0
        ? { kind: "add-segment" }
        : null;
    case "recorder":
      // Steps 7 and 8 in one condition. A take is spliced into the working
      // buffer only when the sheet closes (Model A, commit-on-close — see
      // `recorder.tsx`'s `onPlayButton`), so `hasAudio` stays false for the
      // whole of a first take and the ring does not blink out the instant
      // Record is tapped. It turns true on the next open, where the guide is
      // over.
      return view.loaded && !view.hasAudio ? { kind: "record" } : null;
  }
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
  return first ? { kind: "open-chapter", chapterId: first.chapterId } : null;
}
