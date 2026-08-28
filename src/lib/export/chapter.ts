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

import { silence } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3, type EncodeMp3Options } from "@/lib/audio/mp3";
import { resolveChapterClipIds } from "@/lib/storage/books";
import { getClip, getClipMeta } from "@/lib/storage/clips";
import type { ChapterId, ClipId } from "@/types/domain";

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
  let missingAudio = missing;

  // Two passes so only ONE chapter-sized PCM buffer is ever live. Building an
  // array of clip samples and then `concat`-ing it holds every clip AND the
  // joined result at once — ~2x peak, ~160 MB on a 15-minute chapter, enough to
  // kill the tab on a low-end phone (George R-B7). Pass 1 reads only metadata
  // (frame counts) to size the buffer; pass 2 copies each clip in and drops it.

  // Pass 1 — size from metadata. `resolveChapterClipIds` resolves through the
  // same metadata, so a meta absent here is the "halves apart" / erased-since
  // case and counts as no audio, exactly as the read below does (Frank F3).
  const gapFrames = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);
  const present: ClipId[] = [];
  let capacity = 0;
  for (const clipId of clipIds) {
    const meta = await getClipMeta(clipId);
    if (!meta || meta.frameCount === 0) {
      missingAudio++;
      continue;
    }
    if (present.length > 0) capacity += gapFrames;
    capacity += meta.frameCount;
    present.push(clipId);
  }
  if (present.length === 0)
    return { samples: new Int16Array(0), segments: 0, missing: missingAudio };

  // Pass 2 — fill the one buffer. A clip erased in the window between the two
  // passes returns nothing from `getClip`: skip and count it, and trim the
  // returned view to what was actually written rather than leave a silent hole.
  const gap = silence(gapFrames);
  const out = new Int16Array(capacity);
  let written = 0;
  let segments = 0;
  for (const clipId of present) {
    const clip = await getClip(clipId);
    if (!clip || clip.samples.length === 0) {
      missingAudio++;
      continue;
    }
    if (segments > 0) {
      out.set(gap, written);
      written += gap.length;
    }
    out.set(clip.samples, written);
    written += clip.samples.length;
    segments++;
  }

  return { samples: out.subarray(0, written), segments, missing: missingAudio };
}

/**
 * Encode a chapter's recorded segments, in order, as one MP3. Returns `null`
 * when the chapter has no resolvable audio — there is nothing to share.
 *
 * `shouldEncode` is checked after the gather and before the encode: the gather
 * awaits per clip (cancellable), but `encodeMp3` is one synchronous main-thread
 * pass with no abort until B8 (#34) moves it to a worker. A caller that was
 * cancelled during the gather returns `false` to skip that blocking pass rather
 * than freeze the UI for a share the user already dismissed (George R-B7).
 */
export async function exportChapterMp3(
  chapterId: ChapterId,
  options: EncodeMp3Options = {},
  shouldEncode?: () => boolean
): Promise<ChapterExport | null> {
  const { samples, segments, missing } = await gatherChapterPcm(chapterId);
  if (segments === 0) return null;
  if (shouldEncode && !shouldEncode()) return null;
  return { mp3: encodeMp3(samples, options), segments, missing };
}
