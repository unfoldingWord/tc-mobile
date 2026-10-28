/**
 * Gather a book from IndexedDB into what `writeBundleZip` takes (#1457,
 * ADR 0014 point 3).
 *
 * Read-only: nothing here writes a row, so a clip's `generation` is exactly what
 * it was before the export (ADR 0009 — an export is not a lossy pass). Each
 * segment goes through the one segment -> take -> clip walk
 * (`resolveSegmentAudio`), so a segment nobody recorded and a segment whose
 * take or clip is gone come out as `source: null`, with `take` set only when
 * the take row exists, which is how `project.json` tells the reasons apart.
 *
 * The audio itself is not read here. Each source reads its clip when the writer
 * asks for it, one segment at a time, and hands the bytes out as stored: the
 * MP3 for a Finished segment, the PCM sample bytes for an unfinished one (the
 * writer puts the WAV header ahead of them). Nothing is decoded or re-encoded.
 *
 * A chapter id whose record is gone is dropped, as Share Book drops it
 * (`resolveBookChapters`); `project.json` describes the chapters that exist.
 */

import {
  getBook,
  getSegmentsOfChapter,
  resolveBookChapters,
} from "@/lib/storage/books";
import { getClip } from "@/lib/storage/clips";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import type { ClipMeta } from "@/types/audio";
import type { BookId, SegmentId } from "@/types/domain";

import type { BundleBookInput } from "./input";
import type {
  BundleAudioSource,
  BundleWriteInput,
  BundleWriteSegment,
} from "./write";

/** Bytes per piece handed to the zip: bounds what one read holds in flight. */
const BUNDLE_PIECE_BYTES = 256 * 1024;

/** A clip row changed or vanished between the gather and the read. */
class BundleClipChangedError extends Error {
  constructor(clipId: string, why: string) {
    super(`clip ${clipId} ${why} while the bundle was being written`);
    this.name = "BundleClipChangedError";
  }
}

function storedSource(meta: ClipMeta): BundleAudioSource {
  return {
    clip: meta,
    async *read() {
      const stored = await getClip(meta.id);
      if (!stored) throw new BundleClipChangedError(meta.id, "was removed");
      if (stored.encoding !== meta.encoding) {
        throw new BundleClipChangedError(meta.id, "changed encoding");
      }
      const bytes =
        stored.encoding === "mp3"
          ? stored.mp3
          : new Uint8Array(
              stored.samples.buffer as ArrayBuffer,
              stored.samples.byteOffset,
              stored.samples.byteLength
            );
      for (let at = 0; at < bytes.length; at += BUNDLE_PIECE_BYTES) {
        yield bytes.subarray(
          at,
          Math.min(at + BUNDLE_PIECE_BYTES, bytes.length)
        );
      }
    },
  };
}

async function gatherSegment(
  segmentId: SegmentId
): Promise<BundleWriteSegment | null> {
  const found = await resolveSegmentAudio(segmentId);
  switch (found.kind) {
    case "no-segment":
      return null;
    case "no-active-take":
    case "take-missing":
      return { segment: found.segment, take: null, source: null };
    case "clip-missing":
      return { segment: found.segment, take: found.take, source: null };
    case "resolved":
      return {
        segment: found.segment,
        take: found.take,
        source: storedSource(found.clip),
      };
  }
}

/** What the caller supplies; the rest comes from storage. */
export type BundleGatherParams = Omit<BundleBookInput, "book" | "chapters">;

/** The book as the writer's input, or `null` when the book is gone. */
export async function gatherBundleInput(
  bookId: BookId,
  params: BundleGatherParams
): Promise<BundleWriteInput | null> {
  const book = await getBook(bookId);
  if (!book) return null;
  const { chapters } = await resolveBookChapters(bookId);
  const gathered: BundleWriteInput["chapters"][number][] = [];
  for (const chapter of chapters) {
    const rows = await getSegmentsOfChapter(chapter.id);
    const segments: BundleWriteSegment[] = [];
    for (const row of rows) {
      const one = await gatherSegment(row.id);
      if (one) segments.push(one);
    }
    gathered.push({ chapter, segments });
  }
  return { ...params, book, chapters: gathered };
}
