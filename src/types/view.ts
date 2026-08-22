/**
 * View models shared by the section browser and the section view.
 *
 * Both layouts render the same data — the grid and the list are two
 * compositions of one model, not two features. That is what makes
 * "a chapter with artwork is browsed by picture, one without is browsed by
 * sound" a single conditional rather than a fork in the product.
 */

import type { Peaks } from "./audio";
import type { RecordingStatus, SectionId, SegmentId } from "./domain";

export interface SectionCard {
  readonly sectionId: SectionId;
  /** The segment a recording attaches to. One per section in Phase 1. */
  readonly segmentId: SegmentId;
  /** 1-based position, and the only digit shown on the primary path. */
  readonly ordinal: number;
  /** Burrito scope string, e.g. "1:7". */
  readonly scope: string;
  /** Bundled thumbnail, or `null` for a chapter with no artwork. */
  readonly thumbUrl: string | null;
  /** Full-size artwork for the section view, fetched on demand. */
  readonly imageUrl: string | null;
  /** Precomputed so the list never walks raw samples while scrolling. */
  readonly peaks: Peaks | null;
  readonly durationMs: number | null;
  readonly status: RecordingStatus;
}

export interface ChapterCard {
  readonly chapterId: string;
  readonly title: string;
  readonly ordinal: number;
  /**
   * Drives both the layout and what a tap does. The single conditional the
   * whole screen turns on.
   */
  readonly hasArtwork: boolean;
  /** Story-level reference narration, when the content ships any. */
  readonly referenceAudioUrl: string | null;
  readonly sections: readonly SectionCard[];
}

export function recordedCount(chapter: ChapterCard): number {
  return chapter.sections.filter((s) => s.durationMs !== null).length;
}

/** The first section with no recording — where a returning user should land. */
export function firstUnrecorded(chapter: ChapterCard): SectionCard | null {
  return chapter.sections.find((s) => s.durationMs === null) ?? null;
}
