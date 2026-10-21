/**
 * The tC Mobile `project.json` of an exported book (#1567, ADR 0014 point 4):
 * everything the app knows per book, chapter and segment that the Scripture
 * Bundle ingredient shape has no room for. It is ours, with its own
 * `schemaVersion`, and it is what a later import would read. Pure.
 */

import {
  exportTimeIso,
  missingAudioReason,
  segmentIngredientPath,
  type BundleBookInput,
  type MissingAudioReason,
} from "./input";

/** Bumped when the shape below changes; a change is a new ADR or an amendment. */
const PROJECT_SCHEMA_VERSION = 1;

interface ProjectSegment {
  readonly id: string;
  readonly position: number;
  readonly index: number;
  readonly label: string | null;
  readonly reference: {
    readonly book: string;
    readonly startChapter: number;
    readonly startVerse: number | null;
    readonly endChapter: number;
    readonly endVerse: number | null;
  } | null;
  /** The OBS story and frame, when the reference is an OBS one. */
  readonly obs: { readonly story: number; readonly frame: number } | null;
  readonly status: string;
  readonly templateKey: string | null;
  readonly createdAt: number | null;
  readonly modifiedAt: number | null;
  readonly take: {
    readonly id: string;
    readonly createdAt: number;
    readonly durationMs: number;
  } | null;
  readonly clip: {
    readonly id: string;
    readonly encoding: "pcm" | "mp3";
    readonly generation: number;
    readonly sampleRate: number;
    readonly frameCount: number;
    readonly durationMs: number;
    readonly byteLength: number;
  } | null;
  /** The audio ingredient's path, or `null` with `missingAudio` saying why. */
  readonly ingredient: string | null;
  readonly missingAudio: MissingAudioReason | null;
}

export interface ProjectManifest {
  readonly schemaVersion: number;
  readonly app: { readonly name: "tC Mobile"; readonly version: string };
  readonly exportedAt: string;
  readonly book: Record<string, unknown>;
  readonly chapters: readonly Record<string, unknown>[];
}

/** Build `project.json`: every segment is listed, audio or not. */
export function buildProjectManifest(input: BundleBookInput): ProjectManifest {
  const { book } = input;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    app: { name: "tC Mobile", version: input.appVersion },
    exportedAt: exportTimeIso(input.exportedAt),
    book: {
      id: book.id,
      name: book.name,
      exportedName: input.bookName,
      number: book.number,
      languageCode: book.languageCode,
      coverColourKey: book.coverColourKey,
      shelfPosition: book.shelfPosition,
      provenance: book.provenance,
      licence: book.licence,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      modifiedAt: book.modifiedAt,
    },
    chapters: input.chapters.map((chapterInput, ci) => {
      const { chapter } = chapterInput;
      const segments: ProjectSegment[] = chapterInput.segments.map(
        (segmentInput, si) => {
          const { segment, take, audio } = segmentInput;
          const ref = segment.reference;
          return {
            id: segment.id,
            position: si + 1,
            index: segment.index,
            label: segment.label,
            reference: ref === null ? null : { ...ref },
            obs:
              ref !== null && ref.book === "OBS" && ref.startVerse !== null
                ? { story: ref.startChapter, frame: ref.startVerse }
                : null,
            status: segment.status,
            templateKey: segment.templateKey,
            createdAt: segment.createdAt,
            modifiedAt: segment.modifiedAt,
            take:
              take === null
                ? null
                : {
                    id: take.id,
                    createdAt: take.createdAt,
                    durationMs: take.durationMs,
                  },
            clip:
              audio === null
                ? null
                : {
                    id: audio.clip.id,
                    encoding: audio.clip.encoding,
                    generation: audio.clip.generation,
                    sampleRate: audio.clip.sampleRate,
                    frameCount: audio.clip.frameCount,
                    durationMs: audio.clip.durationMs,
                    byteLength: audio.clip.byteLength,
                  },
            ingredient:
              audio === null
                ? null
                : segmentIngredientPath(ci + 1, si + 1, audio.clip.encoding),
            missingAudio: missingAudioReason(segmentInput),
          };
        }
      );
      return {
        id: chapter.id,
        position: ci + 1,
        number: chapter.number,
        name: chapter.name,
        templateKey: chapter.templateKey,
        createdAt: chapter.createdAt,
        modifiedAt: chapter.modifiedAt,
        segments,
      };
    }),
  };
}
