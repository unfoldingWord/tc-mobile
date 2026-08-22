/**
 * Domain model for tC Mobile.
 *
 * Mirrors the hierarchy in the inception notes (docs/spec-transcription.md):
 *
 *   Project (Book)  = collection of Chapters
 *     Chapter       = ordered collection of Sections (stories, pericopes)
 *       Section     = the unit of work — "the work happens here"
 *         Segment   = contiguous speech unit (OBS frame, verse span)
 *           Take    = one recorded attempt at a Segment
 *
 * The note left the top-level name open ("Resource? Collection? Project?").
 * `Project` is used here as a placeholder; it is a rename away from any of
 * them because nothing outside this file depends on the word.
 *
 * Every recording is born addressed to a Segment, which is what makes
 * downstream STT / checking / publishing possible. Audio is never stored as
 * an unaddressed voice memo.
 */

export type ProjectId = string & { readonly __brand: "ProjectId" };
export type ChapterId = string & { readonly __brand: "ChapterId" };
export type SectionId = string & { readonly __brand: "SectionId" };
export type SegmentId = string & { readonly __brand: "SegmentId" };
export type TakeId = string & { readonly __brand: "TakeId" };
export type ClipId = string & { readonly __brand: "ClipId" };

/**
 * Where a section sits in canonical scripture addressing.
 *
 * `scope` deliberately uses the Scripture Burrito ingredient-scope grammar
 * rather than a bespoke chapter/section pair, because that is what the audio
 * interchange standard actually keys on and it costs nothing to adopt now:
 *
 *   ""          whole book
 *   "2"         whole chapter
 *   "2-4"       chapter range
 *   "2:1-13"    verse range within a chapter
 *   "2:1-3:4"   cross-chapter span
 *
 * Section-granular scopes like "2:1-13" are already emitted by shipping
 * software (SIL's Audio Project Manager splits Ruth 2 into "2:1-13" and
 * "2:14-22"), so tC Mobile's section granularity is on the standard's happy
 * path. See docs/research/prior-art.md §4.
 */
export interface SectionRef {
  /** USFM book code where known, e.g. "RUT", or "OBS" for Open Bible Stories. */
  readonly book: string;
  /** Scripture Burrito scope string. Empty string means the whole book. */
  readonly scope: string;
}

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  /** BCP-47 tag of the language being recorded, when known. */
  readonly languageCode: string | null;
  readonly chapterIds: readonly ChapterId[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Chapter {
  readonly id: ChapterId;
  readonly projectId: ProjectId;
  readonly number: number;
  /** Ordered. Order is the source of truth for export concatenation. */
  readonly sectionIds: readonly SectionId[];
}

export interface Section {
  readonly id: SectionId;
  readonly chapterId: ChapterId;
  readonly ref: SectionRef;
  /**
   * Optional human label. Deliberately optional: the primary UI path is
   * text-free, so a section is identified by image/number/audio prompt, not
   * by reading this.
   */
  readonly label: string | null;
  /** Ordered. A section always has at least one segment. */
  readonly segmentIds: readonly SegmentId[];
}

export interface Segment {
  readonly id: SegmentId;
  readonly sectionId: SectionId;
  /** 1-based position within the section. */
  readonly index: number;
  readonly takeIds: readonly TakeId[];
  /**
   * The take that represents this segment in playback and export.
   * `null` means the segment has been created but not yet recorded.
   */
  readonly activeTakeId: TakeId | null;
  readonly status: RecordingStatus;
}

/**
 * Progress of a segment, using the vocabulary Shema Studio already ships
 * (docs/research/prior-art.md §1). Carried now rather than added later
 * because phase 2 needs it for progress display and versioning, and
 * retrofitting a status onto existing records is a migration.
 */
export type RecordingStatus =
  "not-started" | "partly-recorded" | "draft" | "refined" | "affirmed";

export interface Take {
  readonly id: TakeId;
  readonly segmentId: SegmentId;
  /** The stored audio this take plays. */
  readonly clipId: ClipId;
  readonly createdAt: number;
  readonly durationMs: number;
}
