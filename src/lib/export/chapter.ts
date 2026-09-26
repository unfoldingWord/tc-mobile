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

import { fitToFrames, silence } from "@/lib/audio/edit";
import { fitMp3Decode } from "@/lib/audio/mp3-align";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { resolveChapterClipIds } from "@/lib/storage/books";
import { getClip, getClipMeta } from "@/lib/storage/clips";
import type { AudioCodec } from "@/types/audio";
import type { ChapterId, ClipId } from "@/types/domain";

/**
 * Silence between concatenated segments, in seconds. A chapter whose segments
 * ran together would be hard to follow; a short gap sets them apart. The exact
 * length is a product feel, not a constraint — flagged for the requirements
 * owner.
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
 * Concatenate a chapter's recorded segments, in `chapter.segmentIds` order, into
 * one canonical PCM buffer with a `SEGMENT_GAP_SECONDS` gap between each.
 *
 * `resolveChapterClipIds` already drops segments with no resolvable audio (and
 * reports how many); a clip deleted between that walk and the read here is
 * skipped too, rather than crashing a share. A finished segment's MP3 is
 * decoded through `codec.decodeMp3` and aligned to its recording with
 * `fitMp3Decode`.
 *
 * `shouldContinue` is checked before every clip read and decode. The gather
 * used to be cheap reads; with finished segments it is one `decodeAudioData`
 * per MP3 clip, and the caller holds the app's single encoder lane for the
 * whole build — so a share the translator has already dismissed must let go
 * at the next clip, not after the last decode (round-2 George P2). Returns
 * `null` when cancelled; the partial buffer is dropped.
 *
 * `onStep` reports the gather's truthful progress (#986): `(0, total)` once
 * pass 1 has fixed `total` — the segments with audio to gather — and then
 * `(done, total)` after each of those segments is RESOLVED, whether it was
 * copied in or skipped and counted missing. `shouldContinue` is checked again
 * after each segment's read and decode, before its step: a cancel that lands
 * while a segment is in flight returns `null` without reporting that segment,
 * and one that lands between segments returns before the next. Either way no
 * step is reported after the cancel is observable. A throw unwinds before its
 * segment's step, so the count stops where it was. Not called for a chapter
 * with nothing to gather.
 */
export async function gatherChapterPcm(
  chapterId: ChapterId,
  codec: Pick<AudioCodec, "decodeMp3">,
  shouldContinue?: () => boolean,
  onStep?: (done: number, total: number) => void
): Promise<ChapterPcm | null> {
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
  let done = 0;
  onStep?.(done, present.length);
  for (const { clipId, frames } of present) {
    if (shouldContinue && !shouldContinue()) return null;
    const fitted = await readSlot(clipId, frames, codec);
    // Re-checked after the await: a cancel that landed during this read or
    // decode must not report this segment's step (#986).
    if (shouldContinue && !shouldContinue()) return null;
    if (fitted === null) {
      missingAudio++;
    } else {
      if (segments > 0) {
        out.set(gap, written);
        written += gap.length;
      }
      out.set(fitted, written);
      written += frames;
      segments++;
    }
    onStep?.(++done, present.length);
  }

  return { samples: out.subarray(0, written), segments, missing: missingAudio };
}

/**
 * One segment's audio, fitted to exactly the `frames` pass 1 reserved for it,
 * or `null` when there is none to use (the clip is gone, its decode is empty,
 * or it overran its slot) — the caller counts that missing.
 */
async function readSlot(
  clipId: ClipId,
  frames: number,
  codec: Pick<AudioCodec, "decodeMp3">
): Promise<Int16Array | null> {
  const clip = await getClip(clipId);
  if (!clip) return null;
  let fitted: Int16Array;
  if (clip.encoding === "pcm") {
    fitted = clip.samples;
  } else {
    const decoded = await codec.decodeMp3(clip.mp3);
    if (decoded.length === 0) return null;
    // Aligned to the recording (see `fitMp3Decode`): the decode carries the
    // encoder's priming at its head and granule padding at its tail, and
    // neither may land in the chapter or push the next segment off its slot.
    fitted = fitMp3Decode(decoded, clip.mp3, frames);
  }
  // `frames` is what pass 1 reserved this clip's slot from, read via
  // `getClipMeta` in a transaction separate from the `getClip` above.
  // `fitMp3Decode` always returns exactly `frames` (via `fitToFrames`), so
  // this only ever has work to do for a PCM clip's stored samples, used
  // as-is — nothing stops the two reads from disagreeing about a clip's
  // length. A clip that overran its slot is still counted missing: the
  // caller's unguarded `out.set` would throw (S-10, #163), and there is no
  // slot to safely fit it into. An empty buffer has no audio to recover
  // either way. A clip that fell SHORT of its slot is fitted up to
  // `frames` with `fitToFrames` — the same fit the MP3 path already runs
  // its decode through inside `fitMp3Decode` — so its audio is exported
  // and only the unused tail of the slot is left silent (DRI decision,
  // #163, PR #812), rather than dropping the clip's audio entirely.
  if (fitted.length === 0 || fitted.length > frames) return null;
  return fitted.length < frames ? fitToFrames(fitted, frames) : fitted;
}

/**
 * Encode a chapter's recorded segments, in order, as one MP3. Returns `null`
 * when the chapter has no resolvable audio — there is nothing to share.
 *
 * `shouldEncode` is threaded into the gather (checked before every clip read
 * and decode) and checked again before the encode, so a share the translator
 * has dismissed stops at the next clip and never spins up a worker.
 *
 * `onStep` is the gather's segment count (#986), threaded straight through.
 * The encode that follows the last segment is ONE worker call with no
 * per-item breakdown, so it adds no step: a count reading `N of N` means every
 * segment is gathered, not that the MP3 is already built. A caller may have
 * slow work of its own after this returns — Share's native route stages the
 * built file across the bridge (`share-flow.ts`) — and that adds no step
 * either.
 */
export async function exportChapterMp3(
  chapterId: ChapterId,
  codec: AudioCodec,
  shouldEncode?: () => boolean,
  onStep?: (done: number, total: number) => void
): Promise<ChapterExport | null> {
  const gathered = await gatherChapterPcm(
    chapterId,
    codec,
    shouldEncode,
    onStep
  );
  if (gathered === null) return null;
  const { samples, segments, missing } = gathered;
  if (segments === 0) return null;
  if (shouldEncode && !shouldEncode()) return null;
  return { mp3: await codec.encodeMp3(samples), segments, missing };
}
