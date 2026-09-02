/**
 * Chapter export — concatenate a chapter's recorded segments into one MP3.
 *
 * The "recordings can leave the phone" path (#18 / B7 Share Chapter, A4). It
 * composes existing pieces: the ordered clip walk (`resolveChapterClipIds`), the
 * canonical-PCM join (`concat`, with a `silence` gap so segments don't run
 * together) and the codec. Deliberately free of the browser — the `Blob` +
 * `navigator.share` handoff is a thin hook layer on top — so the whole
 * gather-and-encode path is unit-tested in Node.
 *
 * The codec is INJECTED (`AudioCodec`, B8). Encoding runs in a Web Worker and
 * decoding — a finished segment's audio is stored as MP3 (D3) — uses the
 * browser's decoder; both live in `hooks/`. Tests hand in the synchronous
 * encoder wrapped in a promise and a fake decoder, and the gather still asserts
 * order, gaps and fitting directly on samples.
 *
 * `gatherChapterPcm` is split out from `exportChapterMp3` so the concatenation,
 * ordering and gap are asserted directly on samples, without decoding an MP3.
 */

import { silence } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { resolveChapterClipIds } from "@/lib/storage/books";
import { getClip, getClipMeta } from "@/lib/storage/clips";
import type { AudioCodec } from "@/types/audio";
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
  readonly mp3: Uint8Array<ArrayBuffer>;
  readonly segments: number;
  readonly missing: number;
}

/**
 * Copy `decoded` into `out` at `at`, fitted to exactly `frames` — the frame
 * count the clip's metadata promised and the buffer was sized by.
 *
 * An MP3 decode does not come back sample-exact: the encoder pads the head and
 * tail of the stream (LAME's ~1.1k-sample delay plus a final part-frame), and
 * whether a decoder trims that padding again depends on whether it honours the
 * LAME info tag — Safari and Chrome do, others may not. So a decoded finished
 * segment can run a few dozen milliseconds long, or short. The slot is the
 * duration the translator recorded; a longer decode is trimmed to it, a shorter
 * one is padded with silence, so neither the chapter's timing nor the buffer
 * bounds move with the decoder the phone happens to have.
 */
function fitInto(
  out: Int16Array,
  at: number,
  decoded: Int16Array,
  frames: number
): void {
  const copy = Math.min(frames, decoded.length);
  out.set(decoded.subarray(0, copy), at);
  // The buffer is zero-filled at allocation, so a short decode's tail is
  // already silence; nothing to write for the padding.
}

/**
 * Concatenate a chapter's recorded segments, in `chapter.segmentIds` order, into
 * one canonical PCM buffer with a `SEGMENT_GAP_SECONDS` gap between each.
 *
 * `resolveChapterClipIds` already drops segments with no resolvable audio (and
 * reports how many); a clip deleted between that walk and the read here is
 * skipped too, rather than crashing a share. A finished segment's MP3 is
 * decoded through `codec.decodeMp3` and fitted to its original frame count.
 */
export async function gatherChapterPcm(
  chapterId: ChapterId,
  codec: Pick<AudioCodec, "decodeMp3">
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
  // `frameCount` is the ORIGINAL PCM length whatever the clip's encoding, so an
  // MP3 clip sizes its slot the same way a PCM one does.
  const gapFrames = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);
  const present: Array<{ clipId: ClipId; frames: number }> = [];
  let capacity = 0;
  for (const clipId of clipIds) {
    const meta = await getClipMeta(clipId);
    if (!meta || meta.frameCount === 0) {
      missingAudio++;
      continue;
    }
    if (present.length > 0) capacity += gapFrames;
    capacity += meta.frameCount;
    present.push({ clipId, frames: meta.frameCount });
  }
  if (present.length === 0)
    return { samples: new Int16Array(0), segments: 0, missing: missingAudio };

  // Pass 2 — fill the one buffer. A clip erased in the window between the two
  // passes returns nothing from `getClip`: skip and count it, and trim the
  // returned view to what was actually written rather than leave a silent hole.
  // An MP3 clip is decoded here, one at a time, so at most one decoded segment
  // is alive alongside the output buffer.
  const gap = silence(gapFrames);
  const out = new Int16Array(capacity);
  let written = 0;
  let segments = 0;
  for (const { clipId, frames } of present) {
    const clip = await getClip(clipId);
    if (!clip) {
      missingAudio++;
      continue;
    }
    const decoded =
      clip.encoding === "pcm" ? clip.samples : await codec.decodeMp3(clip.mp3);
    if (decoded.length === 0) {
      missingAudio++;
      continue;
    }
    if (segments > 0) {
      out.set(gap, written);
      written += gap.length;
    }
    fitInto(out, written, decoded, frames);
    written += frames;
    segments++;
  }

  return { samples: out.subarray(0, written), segments, missing: missingAudio };
}

/**
 * Encode a chapter's recorded segments, in order, as one MP3. Returns `null`
 * when the chapter has no resolvable audio — there is nothing to share.
 *
 * `shouldEncode` is checked after the gather and before the encode. The encode
 * now runs off-thread and is abortable through the codec the hook built, but the
 * check still earns its place: a caller cancelled during the gather skips
 * spinning up a worker for a share the user already dismissed.
 */
export async function exportChapterMp3(
  chapterId: ChapterId,
  codec: AudioCodec,
  shouldEncode?: () => boolean
): Promise<ChapterExport | null> {
  const { samples, segments, missing } = await gatherChapterPcm(
    chapterId,
    codec
  );
  if (segments === 0) return null;
  if (shouldEncode && !shouldEncode()) return null;
  return { mp3: await codec.encodeMp3(samples), segments, missing };
}
