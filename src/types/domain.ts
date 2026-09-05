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
 * Written by #253's `createBookFromTemplate` (`lib/storage/templates.ts`) — an
 * OBS template stamps `{ book: "OBS", scope: obsFrameScope(story, frame) }`
 * per frame, a Bible-book template stamps `{ book, scope: String(chapter) }`
 * per starter segment. No export reads it yet (that stays a later lane's
 * concern), so the type is live but the field's *use* beyond storage is still
 * ahead of it.
 */
export interface SegmentRef {
  /** USFM book code where known, e.g. "RUT", or "OBS" for Open Bible Stories. */
  readonly book: string;
  /** Scripture Burrito scope string. Empty string means the whole book. */
  readonly scope: string;
}

/**
 * Where a Book's structure (and, for OBS, its content) came from — stamped
 * once at creation by `createBookFromTemplate` (#253) and never written
 * again this lane. `null` is a from-scratch book with no template behind it
 * (today's `createBook`/`createNextBook` path).
 *
 * This is the smallest additive slice of #174's fuller provenance plan
 * (licence, attribution, `updatedAt`/`deletedAt` on every store) that #253
 * needs on its own: #174 has not landed as of this field's v5 bump, and #253
 * blocking on it would trade "nobody can start from OBS at the training" for
 * a schema bump this repo's own discipline treats as free. #174's remaining
 * pieces (pendingTakes, timestamps/tombstones) are still that issue's to add,
 * additively, whenever it lands.
 */
export type BookProvenance =
  | { readonly kind: "obs"; readonly catalogVersion: string }
  | { readonly kind: "scripture"; readonly book: string }
  | { readonly kind: "user" };

export interface Book {
  readonly id: BookId;
  /** User-facing; auto-named "Book NNN" in B2 (Q1: rename deferred). */
  readonly name: string;
  /** BCP-47 tag of the language being recorded, when known. */
  readonly languageCode: string | null;
  /** Source of this book's structure/content, or `null` for a hand-made one. */
  readonly provenance: BookProvenance | null;
  readonly chapterIds: readonly ChapterId[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Chapter {
  readonly id: ChapterId;
  readonly bookId: BookId;
  /** 1-based, unique within its book (max existing + 1 on create). */
  readonly number: number;
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
   * The one take behind this segment, or `null` ⇒ never recorded.
   *
   * 1:1 per D1/A2 — there is no take history. Re-recording REPLACES the take
   * (see `addTake` in `storage/books.ts`). A stacked `takeIds[]` was the
   * pre-pivot model A2 removed; it leaks unreachable PCM (#2/D3).
   */
  readonly activeTakeId: TakeId | null;
  readonly status: RecordingStatus;
}

/**
 * Progress of a segment, using the vocabulary Shema Studio already ships
 * (docs/research/prior-art.md §1). The 5-value enum STAYS for Phase 2; the
 * pivot UI is binary over it (`isFinished` in `storage/books.ts`): only
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
