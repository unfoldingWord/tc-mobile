/**
 * Domain model for tC Mobile (post-pivot).
 *
 * The pivot (docs/design/pivot-plan.md) collapsed the tree:
 *
 *   was:  Project → Chapter → Section → Segment → Take
 *   now:  Book    → Chapter →           Segment (→ Take, hidden, 1:1)
 *
 *   Book      = a user-created, named collection of Chapters
 *     Chapter = ordered collection of Segments
 *       Segment = the unit of work — one recording, edited in place
 *         Take  = the one recording behind a segment (hidden, 1:1)
 *
 * Section is gone: a Segment hangs off a Chapter directly and is where the
 * work happens. A Take is 1:1 with its Segment — re-recording REPLACES it, it
 * does not stack (A2/D1; the pre-pivot many-takes array leaked PCM, #2/D3).
 *
 * Every recording is still born addressed to a Segment, which is what keeps
 * downstream STT / checking / publishing possible. Audio is never stored as
 * an unaddressed voice memo.
 */

import type { LicenceId, SegmentSpan, TemplateRef } from "./template";

export type BookId = string & { readonly __brand: "BookId" };
export type ChapterId = string & { readonly __brand: "ChapterId" };
export type SegmentId = string & { readonly __brand: "SegmentId" };
export type TakeId = string & { readonly __brand: "TakeId" };
export type ClipId = string & { readonly __brand: "ClipId" };

/**
 * Optional canonical-scripture addressing for a segment (was `SectionRef`).
 *
 * A1: a segment is generic, and a Scripture/OBS reference is optional metadata
 * a template attaches — so a segment with no reference is the normal case, and
 * this sits `| null` on the segment.
 *
 * Numbers, not a scope string (v12, #1462; Q4: "a segment stores a start and
 * an end chapter:verse"): the template package's span, `SegmentSpan`, with its
 * three allowed states. A span that crosses a chapter belongs to its start
 * chapter (R6). `book` is the USFM code, or "OBS" for Open Bible Stories
 * (story:frame as chapter:verse), which the export maps (ADR 0014). The
 * Scripture Bundle scope string is an output the export writes, not a stored
 * value (ADR 0004, amended by v12; docs/design/v12-schema.md).
 *
 * @pivotpending Written by the template writer (#1450); no reader consumes it
 * as an export yet, so it is tagged rather than left to fail CI. The type
 * itself is live — `Segment.reference` is typed on it.
 */
export type SegmentRef = SegmentSpan;

/**
 * How the app made a book (v12, #1462): blank, or from a template package,
 * with the package's attribution text as it read when the book was made (the
 * export needs the notice that applied then; ADR 0006). Not what was typed
 * into the book: a template typed in by hand is still `blank`.
 */
type BookProvenance =
  | { readonly kind: "blank" }
  | {
      readonly kind: "template";
      readonly template: TemplateRef;
      readonly attribution: string;
    };

export interface Book {
  readonly id: BookId;
  /**
   * The facilitator's own name for the book — "Mark" (#264) — or `null` while
   * it has none, which is how every book starts (B2).
   *
   * Nullable for the reason `Chapter.name` is (#169): what an unnamed book
   * shows is a PLACEHOLDER, and a placeholder is UI copy. Storing the rendered
   * "Book 001" froze English into IndexedDB, so a second UI language could
   * never rename the books already on a phone. The slot is stored instead
   * ({@link Book.number}) and the words are rendered at the screen.
   *
   * A rename to blank keeps the current value, so an unnamed book stays
   * unnamed rather than acquiring the placeholder as a real name.
   */
  readonly name: string | null;
  /**
   * The placeholder slot: 1-based, the first one not already shown on the
   * shelf when this book was created.
   *
   * Only ever SHOWN while {@link Book.name} is `null` — a named book keeps its
   * slot dormant, and dormant slots are free for a later book to take, so the
   * number is not an identity and is not unique across the shelf.
   */
  readonly number: number;
  /** BCP-47 tag of the language being recorded, when known. */
  readonly languageCode: string | null;
  readonly chapterIds: readonly ChapterId[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * Optional cover colour the facilitator picked from the O4 palette (#957,
   * from #937's D7/D8 — "people choose a colour", "a palette of 8–12"). The
   * chapter-name / segment-label pattern, one field over: `null` is the
   * default — no choice has been made — and `lib/cover-colour.ts`'s
   * `resolveCoverKey` derives one deterministically from the book's id, so a
   * reader never has to treat "no colour" as a real UI state.
   *
   * Stores a palette **key** ("forest"), never a hex value: the palette
   * itself (`lib/cover-colour.ts`, ten keys as of #937's D8b, decided
   * 2026-09-25) may still be retuned independently of any book already
   * carrying a key. A key a future trim drops is not this type's problem to
   * prevent — reading it
   * safely, for a key that is no longer in the live palette, is
   * `resolveCoverKey`'s job, not a constraint this field can express. Typed
   * as a bare `string` rather than a union of the current keys for exactly
   * that reason: the type→lib onion order means this file cannot import the
   * palette's key union from `lib/` even if it wanted to (imports never go
   * upward), and a bare string is also the honest shape for a value a future
   * palette change must not require a schema migration to re-type. Every row
   * carries the field (the v9 backfill stamps pre-#957 books `null`), so a
   * reader never meets `undefined`.
   */
  readonly coverColourKey: string | null;
  /**
   * Where the book sits on the Books screen: 0 is the top (#338). The shelf
   * is read in this order (`listBooks`), so it is the user's to set — by
   * press-and-hold on the book (`moveBook`) — rather than a property of the
   * data like `createdAt`.
   *
   * Dense (0..N-1) after every create and every move: a new book takes 0 and
   * the rest move down one, and a move renumbers the whole shelf. A delete
   * leaves a gap, which changes no order and is closed by the next create or
   * move. Not activity on the book: nothing that sets it touches `updatedAt`.
   * Every row carries the field (the v11 step gives each pre-#338 book the
   * position the shelf already showed it at), so a reader never meets
   * `undefined`.
   */
  readonly shelfPosition: number;
  /**
   * v12 (#1462). A non-null union: every pre-v12 book is backfilled
   * `{ kind: "blank" }`, which is true of every book a shipped build made.
   */
  readonly provenance: BookProvenance;
  /**
   * The licence a share or a backup reads (D5). `null` means not chosen yet:
   * the v12 backfill and a new non-template book (R20). A template book is
   * written CC BY-SA 4.0, and its lock is `provenance.kind === "template"`.
   */
  readonly licence: LicenceId | null;
  /**
   * When this row was last written, or `null` when no put has touched it
   * since v12 (the backfill reads no clock). Not `updatedAt`, which means
   * activity and which a reorder leaves alone. Every put of the row stamps
   * it with the write's time, in that same put (#1463); a write that puts
   * nothing leaves it.
   */
  readonly modifiedAt: number | null;
}

export interface Chapter {
  readonly id: ChapterId;
  readonly bookId: BookId;
  /**
   * 1-based, unique within its book (max existing + 1 on create). A reorder
   * (`moveChapter`, #953) renumbers every chapter of the book to its position
   * + 1, so the badge and the export file name follow the order.
   *
   * From v12 this is the chapter's real number (R7: "Every chapter carries the
   * number someone types or the template gives"), and the order is
   * `Book.chapterIds`. The upgrade keeps every stored value; the writers and
   * readers that still treat it as the position are #1272's to change.
   */
  readonly number: number;
  /**
   * Optional passage label the facilitator sets in place — "Mark 6" (#264).
   * `null` is the default: the UI then shows "Chapter {number}". Clearing the
   * name reverts to `null`. Every row carries the field (the v5 backfill stamps
   * pre-#264 chapters `null`), so a reader never meets `undefined`.
   */
  readonly name: string | null;
  /**
   * Ordered — segments hang off the chapter directly (no Section). This array
   * is the source of truth for export concatenation order.
   */
  readonly segmentIds: readonly SegmentId[];
  /** Write time at creation; `null` on a pre-v12 row, whose time is unknown. */
  readonly createdAt: number | null;
  /** As {@link Book.modifiedAt}. */
  readonly modifiedAt: number | null;
  /** The template package's own key for this chapter ("01"), or `null`. */
  readonly templateKey: string | null;
}

export interface Segment {
  readonly id: SegmentId;
  /** Hangs off the chapter directly; no Section. */
  readonly chapterId: ChapterId;
  /**
   * 1-based ordinal. A denormalised mirror of this segment's position in
   * `Chapter.segmentIds` (D-IDX): the array is the truth for order; this is
   * the display digit. Creation appends, a reorder (`moveSegment`, #953)
   * renumbers to position + 1, and so does a delete (`deleteSegment`, #590) —
   * both share the one renumber write, `lib/storage/books.ts`'s
   * `renumberSegments`.
   */
  readonly index: number;
  /** A1: null is the normal case. The template writer (#1450) writes it. */
  readonly reference: SegmentRef | null;
  /**
   * Optional label the facilitator sets in place — "verses 3–4" (#591). A label
   * over the ordinal, never a replacement for it: the UI shows "3 · verses 3–4",
   * and `null` (the default) shows the ordinal alone. Clearing the label reverts
   * to `null`. Every row carries the field (the v8 backfill stamps pre-#591
   * segments `null`), so a reader never meets `undefined`.
   */
  readonly label: string | null;
  /**
   * The one take behind this segment, or `null` ⇒ never recorded.
   *
   * 1:1 per D1/A2 — there is no take history. Re-recording REPLACES the take
   * (see `saveTake` in `storage/takes.ts`). A stacked `takeIds[]` was the
   * pre-pivot model A2 removed; it leaks unreachable PCM (#2/D3).
   */
  readonly activeTakeId: TakeId | null;
  readonly status: RecordingStatus;
  /** As {@link Chapter.createdAt}. */
  readonly createdAt: number | null;
  /** As {@link Book.modifiedAt}. */
  readonly modifiedAt: number | null;
  /**
   * The template package's own key for this segment ("01-07"), or `null`. A
   * separate field from `reference` because an introduction has no passage
   * and still needs a title.
   */
  readonly templateKey: string | null;
  /**
   * Which take is active, as a count (v13, #38): every write that changes
   * `activeTakeId` or replaces the active take adds one, in the same
   * transaction. Two reads with the same value saw the same active take. It
   * does not move on a transcode, the Finished toggle or a rename
   * (docs/design/pending-take-lifecycle.md, §1).
   */
  readonly audioRevision: number;
}

/**
 * Progress of a segment, using the vocabulary Shema Studio already ships
 * (docs/research/prior-art.md §1). The 5-value enum STAYS for Phase 2; the
 * pivot UI is binary over it (`isFinished` in `storage/takes.ts`): only
 * "affirmed" reads as finished, and the toggle writes "affirmed"/"draft".
 */
export type RecordingStatus =
  "not-started" | "partly-recorded" | "draft" | "refined" | "affirmed";

/** Hidden, 1:1 with its segment. One recording per segment. */
export interface Take {
  readonly id: TakeId;
  readonly segmentId: SegmentId;
  /** The stored audio this take plays. */
  readonly clipId: ClipId;
  readonly createdAt: number;
  readonly durationMs: number;
}

/**
 * One row of the `tombstones` store (v12, #1462): a book or segment a person
 * deleted, so a backup or a later sync can tell "deleted" from "never here".
 * A log under an out-of-line auto-increment key: insertion order is deletion
 * order, and the store itself would keep two rows for one id. Written by
 * `deleteBook` and `deleteSegment` inside the delete's own transaction, and
 * only when the row was there, so a repeated delete adds none (#1463).
 */
export interface Tombstone {
  readonly entity: "book" | "segment";
  /** The deleted row's id. */
  readonly entityId: string;
  /** `null` for a book; the chapter's id for a segment. */
  readonly parentId: string | null;
  readonly deletedAt: number;
}

/**
 * The audio a pending take splices onto (#174, 2026-10-19: "base = stored |
 * inline"). `stored` only while the editor's buffer is that stored clip
 * unchanged; `generation` and `frameCount` let a replay refuse a clip that was
 * transcoded since. Everything else, a first take included (an empty buffer),
 * is `inline`.
 */
export type PendingTakeBase =
  | {
      readonly kind: "stored";
      readonly sourceClipId: ClipId;
      readonly generation: number;
      readonly frameCount: number;
    }
  | { readonly kind: "inline"; readonly samples: ArrayBuffer };

/**
 * One row of the `pendingTakes` store (v12, #1462): a take whose save has not
 * landed, kept so a kill and relaunch does not lose it. Keyed by `segmentId`,
 * because the app holds one save slot and a retry must overwrite. The writer
 * and the replay are #38's; the shape is docs/design/v12-schema.md's.
 */
export interface StoredPendingTake {
  readonly segmentId: SegmentId;
  readonly ordinal: number | null;
  /** The clip id the save will write. */
  readonly clipId: ClipId;
  readonly base: PendingTakeBase;
  /** Int16 PCM, copied through a fresh buffer. */
  readonly recorded: ArrayBuffer;
  readonly sampleRate: number;
  /** Samples. */
  readonly offset: number;
  readonly finished: boolean;
  readonly editOnly: boolean;
  readonly createdAt: number;
  /**
   * The segment's `audioRevision` that the take's base was read at, carried
   * on the take from the recorder's load (v13; the note's §1 and step 6 of
   * "The hold"), never the hold's own read. Absent on a row written before
   * v13, which the step does not guess, and on a take that did not know it.
   */
  readonly baseRevision?: number;
}

/**
 * Why a take stopped being pending (v13, #38), keyed by its `clipId`, written
 * in the same transaction as the act that ends its row. `given-up` may become
 * `saved` or `discarded`; those two are final. Deleted only with its segment.
 * See docs/design/pending-take-lifecycle.md, §3.
 */
export interface TakeDisposition {
  readonly clipId: ClipId;
  readonly segmentId: SegmentId;
  readonly kind: "given-up" | "discarded" | "saved";
  /** Write time; diagnostic only, never a deletion clock. */
  readonly at: number;
}
