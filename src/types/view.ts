/**
 * View models for the three pivot screens (Books, Segments, Recorder).
 *
 * The pre-pivot pair — `SectionCard`/`ChapterCard` with `hasArtwork`,
 * `thumbUrl`, `imageUrl` — is gone (D6: artwork no longer decides layout).
 * These are pure shapes and nothing else. The derivations over them
 * (`segmentRowState`, `firstNotFinished`) and the row's peak resolution live
 * in `lib/view/segment-rows.ts` — this layer is domain types, and
 * `tests/types-erasable.test.ts` holds it to that (L-17, #160). Building the
 * rows (reading the repo, `segment-audio`, and `peaks`) is a `hooks/` job.
 */

import type { Peaks } from "./audio";
import type { BookId, ChapterId, ClipId, SegmentId } from "./domain";

// ── Books screen (B2) ──────────────────────────────────────────────────────

export interface ChapterRow {
  readonly chapterId: ChapterId;
  readonly number: number;
  /**
   * The facilitator's passage label (#264), or `null` ⇒ show "Chapter
   * {number}". The Books row and the Segments breadcrumb both render it through
   * `strings.chapterHeading`.
   */
  readonly name: string | null;
  /** From `chapterProgress` — count of segments with `status === "affirmed"`. */
  readonly finishedCount: number;
  /** 0 ⇒ the UI shows NO counter (an empty chapter is not "0/0"). */
  readonly totalCount: number;
}

export interface BookCard {
  readonly bookId: BookId;
  readonly name: string;
  readonly chapters: readonly ChapterRow[];
}

// ── Segments screen (B3) ───────────────────────────────────────────────────

export interface SegmentRow {
  readonly segmentId: SegmentId;
  /** = `Segment.index`, the wordless identifier and the export position. */
  readonly ordinal: number;
  /**
   * Playable audio is present — derived from
   * `resolveSegmentAudio(...).kind === "resolved"`, NOT from
   * `activeTakeId !== null`. This folds the dangling/undecodable cases into
   * the never-recorded visual (F3), so the only action a broken row offers is
   * re-record — never amber bars over audio the database cannot produce.
   */
  readonly hasClip: boolean;
  /** `isFinished(segment.status)`. */
  readonly finished: boolean;
  /**
   * The resolved clip's id, or null when there is none. A true identity for the
   * audio: a re-record mints a fresh `ClipId`, so a row keyed on this resets its
   * scrub across a 1:1 replace even when the new clip is the same length —
   * duration is an attribute two different clips can share, not an identity.
   */
  readonly clipId: ClipId | null;
  /** Precomputed; null on never-recorded / dangling so scrolling stays cheap. */
  readonly peaks: Peaks | null;
  readonly durationMs: number | null;
}

export type SegmentRowState = "finished" | "recorded" | "empty";
