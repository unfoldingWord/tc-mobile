/**
 * What the Scripture Bundle builders read (#1567, ADR 0014): a book as the app
 * holds it, plus the two numbers a bundle needs of each piece of audio. The
 * builders are pure, so the bytes themselves never come in; whoever zips the
 * export measures each ingredient (`md5.ts`) and hands the size and digest
 * here.
 */

import type { ClipMeta } from "@/types/audio";
import type { Book, Chapter, Segment, Take } from "@/types/domain";

/** One segment's audio as it will sit in the zip, already measured. */
export interface BundleAudio {
  readonly clip: ClipMeta;
  /** Bytes of the ingredient as written: the MP3 as stored, or the whole WAV. */
  readonly size: number;
  /** Lowercase hex MD5 of those bytes. */
  readonly md5: string;
}

export interface BundleSegmentInput {
  readonly segment: Segment;
  /** `null` when the segment was never recorded. */
  readonly take: Take | null;
  /**
   * `null` when there is no audio to write: never recorded, or a take whose
   * clip is gone. The reason is derived from `take`, not passed in.
   */
  readonly audio: BundleAudio | null;
}

interface BundleChapterInput {
  readonly chapter: Chapter;
  /** In `Chapter.segmentIds` order. */
  readonly segments: readonly BundleSegmentInput[];
}

export interface BundleBookInput {
  readonly book: Book;
  /** The name to write: the book's own, or the caller's placeholder wording. */
  readonly bookName: string;
  /** In `Book.chapterIds` order. */
  readonly chapters: readonly BundleChapterInput[];
  /** The app's version, as the footer stamp reads it. */
  readonly appVersion: string;
  /** BCP-47 tag of the interface locale (not the book's language). */
  readonly defaultLocale: string;
  /** The export time, epoch milliseconds. */
  readonly exportedAt: number;
  /** The book language's own name; defaults to the tag, or "Undetermined". */
  readonly languageName?: string;
}

/** Why a segment has no audio ingredient. */
export type MissingAudioReason = "not-recorded" | "audio-missing";

export function missingAudioReason(
  segment: BundleSegmentInput
): MissingAudioReason | null {
  if (segment.audio !== null) return null;
  return segment.take === null ? "not-recorded" : "audio-missing";
}

/** Zero-padded to three digits; wider when a book needs it. */
function pad(position: number): string {
  return String(position).padStart(3, "0");
}

export function segmentIngredientPath(
  chapterPosition: number,
  segmentPosition: number,
  clipEncoding: ClipMeta["encoding"]
): string {
  const ext = clipEncoding === "mp3" ? "mp3" : "wav";
  return `ingredients/audio/c${pad(chapterPosition)}/s${pad(segmentPosition)}.${ext}`;
}

export const PROJECT_INGREDIENT_PATH = "ingredients/tc-mobile/project.json";
