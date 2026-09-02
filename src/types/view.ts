/**
 * View models for the three pivot screens (Books, Segments, Recorder).
 *
 * The pre-pivot pair — `SectionCard`/`ChapterCard` with `hasArtwork`,
 * `thumbUrl`, `imageUrl` — is gone (D6: artwork no longer decides layout).
 * These are pure shapes plus a couple of pure derivations; building the rows
 * (reading the repo, `segment-audio`, and `peaks`) is a `hooks/` job.
 */

import type { Peaks } from "./audio";
import type { BookId, ChapterId, ClipId, SegmentId } from "./domain";

// ── Books screen (B2) ──────────────────────────────────────────────────────

export interface ChapterRow {
  readonly chapterId: ChapterId;
  readonly number: number;
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

/**
 * Waveform resolution of a Segments row, in min/max buckets.
 *
 * Shared between the row loader (which computes peaks from a PCM clip) and the
 * Finished transcode (which computes them from the PCM it is about to drop and
 * stores them on the MP3 clip, B8) — so a finished row draws from stored peaks
 * at exactly the resolution a PCM row is drawn at, and the two never diverge.
 */
export const ROW_PEAK_BUCKETS = 120;

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

/**
 * The three row states of mockup 2, derived clip-presence-first (F3):
 * a dangling/undecodable clip renders as "empty" so re-record is the only
 * offer, never a finished-looking row with no audio behind it.
 */
export function segmentRowState(row: SegmentRow): SegmentRowState {
  if (!row.hasClip) return "empty"; // no status glyph, flat line, red record
  return row.finished ? "finished" : "recorded"; // green check + green wave / amber wave, play
}

/**
 * F5 scroll target: where a returning user lands. Replaces `firstUnrecorded`
 * — the pivot lands on the first *not finished* segment, not the first with no
 * audio. All finished ⇒ null (caller scrolls to top).
 */
export function firstNotFinished(
  rows: readonly SegmentRow[]
): SegmentRow | null {
  return rows.find((r) => !r.finished) ?? null;
}
