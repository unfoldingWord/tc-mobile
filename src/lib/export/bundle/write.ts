/**
 * The Scripture Bundle zip of an exported book (#1587, ADR 0014 point 3).
 *
 * Each recorded segment's audio is streamed into the zip at its ordinal
 * ingredient path, piece by piece, and measured on the way through: its byte
 * count and MD5 (`md5.ts`) come from the very pieces the zip stores. Only once
 * every segment is in does this build `project.json` and then `metadata.json`
 * from those measurements (`project.ts`, `metadata.ts`) and write them, in
 * that order, so `metadata.json` is the archive's last entry.
 *
 * It reuses Share Book's streaming zip (`openZipSink` / `finishZip` in
 * `../book.ts`) and its {@link ArchiveSink}: every entry is stored, and each
 * piece's write is awaited before the next piece is read, so what this module
 * holds is one piece and the zip's stream state, never a segment or the book.
 * Where the bytes land is the caller's sink, as for Share Book.
 *
 * Pure, like the builders: the audio comes in through a {@link
 * BundleAudioSource} per segment, so no storage or browser API is touched
 * here. Gathering a book from IndexedDB into these sources, and sharing the
 * result, are later work.
 */

import { wavHeader } from "@/lib/audio/wav";
import {
  type ArchiveSink,
  type ZipSink,
  finishZip,
  openZipSink,
} from "@/lib/export/book";
import { createMd5 } from "@/lib/export/md5";
import type { ClipMeta } from "@/types/audio";
import type { Chapter, ClipId, Segment, Take } from "@/types/domain";

import {
  PROJECT_INGREDIENT_PATH,
  segmentIngredientPath,
  type BundleBookInput,
  type BundleSegmentInput,
} from "./input";
import { buildBundleMetadata, type BundleFileDigest } from "./metadata";
import { buildProjectManifest } from "./project";

/**
 * One clip's stored bytes, read in pieces: the MP3 as stored, or the PCM
 * sample bytes as stored (this module puts the WAV header in front).
 *
 * A piece is handed to the zip and then to the sink as it is, so the source
 * must not reuse or change a piece after yielding it — the same rule the
 * {@link ArchiveSink} contract sets for sinks.
 */
export interface BundleAudioSource {
  readonly clip: ClipMeta;
  read(): AsyncIterable<Uint8Array<ArrayBuffer>>;
}

export interface BundleWriteSegment {
  readonly segment: Segment;
  /** `null` when the segment was never recorded. */
  readonly take: Take | null;
  /** `null` when there is no audio to write: never recorded, or its clip is gone. */
  readonly source: BundleAudioSource | null;
}

/** A {@link BundleBookInput} whose audio is still to be read and measured. */
export interface BundleWriteInput extends Omit<BundleBookInput, "chapters"> {
  /** In `Book.chapterIds` order, each with its segments in `segmentIds` order. */
  readonly chapters: readonly {
    readonly chapter: Chapter;
    readonly segments: readonly BundleWriteSegment[];
  }[];
}

interface BundleWritten {
  /** Audio ingredients written. */
  readonly audio: number;
  /** Segments with no audio ingredient; `project.json` says why for each. */
  readonly missing: number;
}

/**
 * A PCM clip's bytes did not come to `frameCount` x 2. Its WAV header, already
 * written, would describe audio that is not there (or not all of it), so the
 * export stops rather than ship a WAV that lies.
 */
export class PcmLengthMismatchError extends Error {
  constructor(clipId: ClipId, expected: number, actual: number) {
    super(
      `PCM clip ${clipId} has ${actual} bytes, its frame count says ${expected}`
    );
    this.name = "PcmLengthMismatchError";
  }
}

/** The clip's ingredient bytes: as stored, with a WAV header ahead of PCM. */
async function* ingredientPieces(
  source: BundleAudioSource
): AsyncIterable<Uint8Array<ArrayBuffer>> {
  const { clip } = source;
  if (clip.encoding === "mp3") {
    yield* source.read();
    return;
  }
  const expected = clip.frameCount * 2;
  yield wavHeader(clip.frameCount, clip.sampleRate);
  let seen = 0;
  for await (const piece of source.read()) {
    seen += piece.length;
    yield piece;
  }
  if (seen !== expected) {
    throw new PcmLengthMismatchError(clip.id, expected, seen);
  }
}

async function* once(
  bytes: Uint8Array<ArrayBuffer>
): AsyncIterable<Uint8Array<ArrayBuffer>> {
  yield bytes;
}

/** Wait for every write handed to the sink, and surface a zip error. */
async function settle(zip: ZipSink): Promise<void> {
  await zip.drain();
  const zipError = zip.error();
  if (zipError) throw zipError;
}

/**
 * Store `pieces` as the entry `path`, measuring them as they pass. Each
 * piece's writes are awaited before the next piece is read.
 */
async function writeEntry(
  zip: ZipSink,
  path: string,
  pieces: AsyncIterable<Uint8Array<ArrayBuffer>>
): Promise<BundleFileDigest> {
  const entry = zip.entry(path);
  zip.zip.add(entry);
  const md5 = createMd5();
  let size = 0;
  for await (const piece of pieces) {
    md5.update(piece);
    size += piece.length;
    entry.push(piece, false);
    await settle(zip);
  }
  entry.push(new Uint8Array(0), true);
  await settle(zip);
  return { size, md5: md5.digestHex() };
}

const encoder = new TextEncoder();

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(value, null, 2));
}

/**
 * Write `input` as a Scripture Bundle zip to `sink`: every recorded segment's
 * audio, then `project.json`, then `metadata.json`, then the central
 * directory.
 *
 * Returns `null` when `shouldContinue` (checked before each segment) says
 * stop, and throws on a read, write or zip error, or a
 * {@link PcmLengthMismatchError}. Either way the sink may hold part of an
 * archive, which is not a bundle; the caller discards it, as for Share Book.
 */
export async function writeBundleZip(
  input: BundleWriteInput,
  sink: ArchiveSink,
  shouldContinue?: () => boolean
): Promise<BundleWritten | null> {
  const zip = await openZipSink(sink);
  let audio = 0;
  let missing = 0;
  const chapters: BundleBookInput["chapters"][number][] = [];
  for (const [ci, { chapter, segments }] of input.chapters.entries()) {
    const measured: BundleSegmentInput[] = [];
    for (const [si, { segment, take, source }] of segments.entries()) {
      if (shouldContinue && !shouldContinue()) return null;
      if (source === null) {
        measured.push({ segment, take, audio: null });
        missing++;
        continue;
      }
      const path = segmentIngredientPath(ci + 1, si + 1, source.clip.encoding);
      const digest = await writeEntry(zip, path, ingredientPieces(source));
      measured.push({ segment, take, audio: { clip: source.clip, ...digest } });
      audio++;
    }
    chapters.push({ chapter, segments: measured });
  }
  if (shouldContinue && !shouldContinue()) return null;

  const book: BundleBookInput = { ...input, chapters };
  const project = await writeEntry(
    zip,
    PROJECT_INGREDIENT_PATH,
    once(jsonBytes(buildProjectManifest(book)))
  );
  await writeEntry(
    zip,
    "metadata.json",
    once(jsonBytes(buildBundleMetadata(book, project)))
  );
  await finishZip(zip);
  return { audio, missing };
}
