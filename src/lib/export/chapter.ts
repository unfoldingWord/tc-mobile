/**
 * Chapter export — concatenate a chapter's recorded segments into one MP3.
 *
 * The "recordings can leave the phone" path (#18 / B7 Share Chapter, A4). It
 * composes existing pieces: the ordered clip walk (`resolveChapterClipIds`), the
 * canonical-PCM join (`concat`, with a `silence` gap so segments don't run
 * together) and the encoder (`encodeMp3`). Deliberately free of the browser —
 * the `Blob` + `navigator.share` handoff is a thin hook layer on top — so the
 * whole gather-and-encode path is unit-tested in Node.
 *
 * `gatherChapterPcm` is split out from `exportChapterMp3` so the concatenation,
 * ordering and gap are asserted directly on samples, without decoding an MP3.
 */

import { concat, silence } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3, type EncodeMp3Options } from "@/lib/audio/mp3";
import { resolveChapterClipIds } from "@/lib/storage/books";
import { getClip } from "@/lib/storage/clips";
import type { ChapterId } from "@/types/domain";

/**
 * Silence between concatenated segments, in seconds. A chapter whose segments
 * ran together would be hard to follow; a short gap sets them apart. The exact
 * length is a product feel, not a constraint — flagged for Tim.
 */
export const SEGMENT_GAP_SECONDS = 0.5;

interface ChapterPcm {
  /** The chapter's segments concatenated in order, gaps between. */
  readonly samples: Int16Array;
  /** Segments that contributed audio, in order. */
  readonly segments: number;
  /** Segments whose audio could not be resolved and were skipped. */
  readonly missing: number;
}

interface ChapterExport {
  /** The encoded MP3 bytes, ready to wrap in a Blob for the share sheet. */
  readonly mp3: Uint8Array;
  readonly segments: number;
  readonly missing: number;
}

/**
 * Concatenate a chapter's recorded segments, in `chapter.segmentIds` order, into
 * one canonical PCM buffer with a `SEGMENT_GAP_SECONDS` gap between each.
 *
 * `resolveChapterClipIds` already drops segments with no resolvable audio (and
 * reports how many); a clip deleted between that walk and the read here is
 * skipped too, rather than crashing a share.
 */
export async function gatherChapterPcm(
  chapterId: ChapterId
): Promise<ChapterPcm> {
  const { clipIds, missing } = await resolveChapterClipIds(chapterId);

  const gap = silence(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);
  const parts: Int16Array[] = [];
  let segments = 0;
  for (const clipId of clipIds) {
    const clip = await getClip(clipId);
    if (!clip || clip.samples.length === 0) continue;
    if (segments > 0) parts.push(gap);
    parts.push(clip.samples);
    segments++;
  }

  return { samples: concat(parts), segments, missing };
}

/**
 * Encode a chapter's recorded segments, in order, as one MP3. Returns `null`
 * when the chapter has no resolvable audio — there is nothing to share.
 */
export async function exportChapterMp3(
  chapterId: ChapterId,
  options: EncodeMp3Options = {}
): Promise<ChapterExport | null> {
  const { samples, segments, missing } = await gatherChapterPcm(chapterId);
  if (segments === 0) return null;
  return { mp3: encodeMp3(samples, options), segments, missing };
}
