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
 * this sits `| null` on the segment. Nothing writes it non-null this lane;
 * B7's OBS/template import (#33) is the writer.
 *
 * `scope` uses the Scripture Burrito ingredient-scope grammar rather than a
 * bespoke pair, because that is what the audio interchange standard keys on:
 *
 *   ""          whole book
 *   "2"         whole chapter
 *   "2-4"       chapter range
 *   "2:1-13"    verse range within a chapter
 *   "2:1-3:4"   cross-chapter span
 *
 * See docs/research/prior-art.md §4.
 *
 * @pivotpending Written by B7's OBS/template import (#33); no reader consumes
 * it as an export this lane, so it is tagged rather than left to fail CI. The
 * type itself is live — `Segment.reference` is typed on it.
 */
export interface SegmentRef {
  /** USFM book code where known, e.g. "RUT", or "OBS" for Open Bible Stories. */
  readonly book: string;
  /** Scripture Burrito scope string. Empty string means the whole book. */
  readonly scope: string;
}

export interface Book {
  readonly id: BookId;
  /**
   * User-facing. Auto-named "Book NNN" on create (B2), renamed in place by the
   * facilitator for the passage being translated — "Mark" (#264). Always
   * non-empty: a rename to blank keeps the current name.
   */
  readonly name: string;
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
}

export interface Chapter {
  readonly id: ChapterId;
  readonly bookId: BookId;
  /** 1-based, unique within its book (max existing + 1 on create). */
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
}

export interface Segment {
  readonly id: SegmentId;
  /** Hangs off the chapter directly; no Section. */
  readonly chapterId: ChapterId;
  /**
   * 1-based ordinal. A denormalised mirror of this segment's position in
   * `Chapter.segmentIds` (D-IDX): the array is the truth for order; this is
   * the display digit. The invariant holds while creation is append-only; a
   * future reorder/delete batch must renumber or drop this field.
   */
  readonly index: number;
  /** A1: null is the normal case. B7 (#33) is the writer. */
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
   * (see `addTake` in `storage/takes.ts`). A stacked `takeIds[]` was the
   * pre-pivot model A2 removed; it leaks unreachable PCM (#2/D3).
   */
  readonly activeTakeId: TakeId | null;
  readonly status: RecordingStatus;
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
