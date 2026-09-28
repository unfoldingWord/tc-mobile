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
 *
 * A chapter whose every segment is Finished skips the codec altogether: its
 * stored MP3 frames are joined as they are (#1004, `lib/audio/mp3-join.ts`;
 * see `exportChapterMp3`).
 */

import { fitToFrames, silence } from "@/lib/audio/edit";
import { MP3_ENCODER_DELAY, fitMp3Decode } from "@/lib/audio/mp3-align";
import {
  type JoinPiece,
  joinMp3,
  parseJoinableMp3,
} from "@/lib/audio/mp3-join";
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

/**
 * Above this much PCM, Share Chapter streams (#1003 part b): the chapter is
 * fed to one continuing encode segment by segment and never held as one PCM
 * buffer. At or under it, the chapter is gathered whole and encoded once, as
 * it always was. 16-bit mono, so bytes are frames x 2, gaps included.
 *
 * DRI pick on the #1003(b) park, verbatim: "B: stream only long chapters
 * (Recommended)". Two paths because streaming costs the progress meter its
 * encode stretch (see `streamChapterMp3`), and that trade is only worth it
 * where holding the whole chapter is the risk.
 *
 * PROVISIONAL until #1003's phone measurement (the allocation ceiling on a
 * low-end phone) exists: the number is a starting point, not a measurement.
 */
export const STREAMING_PCM_THRESHOLD_BYTES = 48 * 1024 * 1024;

/**
 * A step count as the export path reports it (#986, #996): `done` of `total`
 * steps have really finished, and `skipped` of those `done` finished WITHOUT
 * contributing audio — a clip that vanished, a chapter with nothing recorded —
 * so a reader can draw them hollow while the count still completes.
 * `skipped <= done` always.
 *
 * `items` is how many of the `total` steps are ITEMS (segments, chapters),
 * when some of the total is not: Share Chapter's count ends with a stretch of
 * encode steps ({@link withEncodeSteps}), so it passes its segment count here
 * and a reader draws that many dots without knowing `ENCODE_STEPS` or which
 * share is running. Absent means every step is an item.
 *
 * Every export here calls this once per finished item, in item order, while
 * it walks the items. That is what lets the progress machine place each
 * skipped item at its own position (`share-progress.ts`): the item a report
 * newly skips is the one that report finished.
 *
 * `keys` names the counted items, in count order (#1044): a Share Chapter
 * segment by its clip id, a Share Book chapter by its chapter id. An export
 * leaves some items out BEFORE it fixes its count (a segment with no
 * resolvable audio, a clip with no metadata, a dangling chapter id), so a
 * reader cannot map count positions onto the items it holds by position
 * alone; it maps them through these keys. One per item (`items`, or `total`
 * when every step is an item), and the same list on every report of a run.
 *
 * `skipped`, `items` and `keys` are optional only so a caller that has
 * nothing to say about them can call `(done, total)`.
 */
export type StepReporter = (
  done: number,
  total: number,
  skipped?: number,
  items?: number,
  keys?: readonly string[]
) => void;

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
 *
 * Each call also carries `skipped` (#996): how many of the `done` segments
 * resolved to no audio (the clip gone, an empty decode, an overrun) — the same
 * segments this adds to `missing` in pass 2. A segment pass 1 already found
 * without audio is in `missing` but not in `total`, so it is not a step and
 * not `skipped`.
 */
export async function gatherChapterPcm(
  chapterId: ChapterId,
  codec: Pick<AudioCodec, "decodeMp3">,
  shouldContinue?: () => boolean,
  onStep?: StepReporter
): Promise<ChapterPcm | null> {
  return fillChapterPcm(
    await sizeChapter(chapterId),
    codec,
    shouldContinue,
    onStep
  );
}

/** Pass 1 of a chapter build: what there is to gather, read from metadata alone. */
interface ChapterPlan {
  /** Segments with audio to gather, in order, and each slot's frame count. */
  readonly present: ReadonlyArray<{
    readonly clipId: ClipId;
    readonly frames: number;
  }>;
  /** Every present clip's metadata says it is stored as MP3 (Finished). */
  readonly allMp3: boolean;
  /** Frames the joined PCM needs: every slot plus the gaps between them. */
  readonly capacity: number;
  /** Segments already known to have no audio. */
  readonly missing: number;
}

const GAP_FRAMES = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);

/**
 * Pass 1 — size from metadata. `resolveChapterClipIds` resolves through the
 * same metadata, so a meta absent here is the "halves apart" / erased-since
 * case and counts as no audio, exactly as the read in pass 2 does (Frank F3).
 * `frameCount` is the ORIGINAL PCM length whatever the clip's encoding, so an
 * MP3 clip sizes its slot the same way a PCM one does.
 */
async function sizeChapter(chapterId: ChapterId): Promise<ChapterPlan> {
  const { clipIds, missing } = await resolveChapterClipIds(chapterId);
  let missingAudio = missing;
  const present: Array<{ clipId: ClipId; frames: number }> = [];
  let capacity = 0;
  let allMp3 = true;
  for (const clipId of clipIds) {
    const meta = await getClipMeta(clipId);
    if (!meta || meta.frameCount === 0) {
      missingAudio++;
      continue;
    }
    if (present.length > 0) capacity += GAP_FRAMES;
    capacity += meta.frameCount;
    present.push({ clipId, frames: meta.frameCount });
    if (meta.encoding !== "mp3") allMp3 = false;
  }
  return { present, allMp3, capacity, missing: missingAudio };
}

/**
 * Pass 2 of the PCM build — see {@link gatherChapterPcm}.
 *
 * Two passes so only ONE chapter-sized PCM buffer is ever live. Building an
 * array of clip samples and then `concat`-ing it holds every clip AND the
 * joined result at once — ~2x peak, ~160 MB on a 15-minute chapter, enough to
 * kill the tab on a low-end phone (George R-B7). Pass 1 reads only metadata
 * (frame counts) to size the buffer; this pass copies each clip in and drops it.
 */
async function fillChapterPcm(
  plan: ChapterPlan,
  codec: Pick<AudioCodec, "decodeMp3">,
  shouldContinue?: () => boolean,
  onStep?: StepReporter
): Promise<ChapterPcm | null> {
  const { present, capacity } = plan;
  let missingAudio = plan.missing;
  if (present.length === 0)
    return { samples: new Int16Array(0), segments: 0, missing: missingAudio };

  // A clip erased in the window between the two passes returns nothing from
  // `getClip`: skip and count it, and trim the returned view to what was
  // actually written rather than leave a silent hole. An MP3 clip is decoded
  // here, one at a time, so at most one decoded segment is alive alongside the
  // output buffer.
  const gap = silence(GAP_FRAMES);
  const out = new Int16Array(capacity);
  let written = 0;
  let segments = 0;
  let done = 0;
  let skipped = 0;
  // The counted segments by clip id (#1044): pass 1 and the clip walk have
  // already left some out, so a count position is not a screen position.
  const keys = present.map((p) => p.clipId);
  onStep?.(done, present.length, skipped, undefined, keys);
  for (const { clipId, frames } of present) {
    if (shouldContinue && !shouldContinue()) return null;
    const fitted = await readSlot(clipId, frames, codec);
    // Re-checked after the await: a cancel that landed during this read or
    // decode must not report this segment's step (#986).
    if (shouldContinue && !shouldContinue()) return null;
    if (fitted === null) {
      missingAudio++;
      skipped++;
    } else {
      if (segments > 0) {
        out.set(gap, written);
        written += gap.length;
      }
      out.set(fitted, written);
      written += frames;
      segments++;
    }
    onStep?.(++done, present.length, skipped, undefined, keys);
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
 * either. To put the encode on the count, run this through
 * {@link withEncodeSteps}, which wraps both the codec and `onStep` (#996);
 * Share Book deliberately does not (it counts chapters).
 *
 * **A chapter whose every segment is Finished is joined, not re-encoded
 * (#1004).** Each such segment is already stored as an MP3 by this app's own
 * encoder, so its frames are copied into the chapter MP3 as they are, with
 * silent frames for the gaps (`lib/audio/mp3-join.ts`): no decode, no encode,
 * and no second lossy generation. The join reports the same per-segment steps
 * the gather does, after every clip is read and the joined bytes exist, then
 * calls `codec.onJoined` — so a count wrapped by {@link withEncodeSteps} still
 * ends at its total.
 *
 * Everything else takes the decode-and-encode path, unchanged: a chapter with
 * ANY segment still in PCM (a mixed chapter is decoded and encoded whole, as
 * before), and an all-Finished chapter where a stored MP3 is not one the join
 * can copy safely (another format, a tag it does not know, a stream that
 * disagrees with its recorded length, a clip turned back to PCM since pass 1).
 * That fallback is decided before any step is reported, so the count a reader
 * sees comes from one path only.
 *
 * **A chapter over `streamAbovePcmBytes` of PCM streams (#1003 part b)**
 * when the codec can open a stream: {@link streamChapterMp3}. Same MP3, byte
 * for byte, and the same `segments` and `missing`, without the chapter-sized
 * buffer; its count is coarser (see there). The default is
 * {@link STREAMING_PCM_THRESHOLD_BYTES}; tests pass a small one so a long
 * chapter can be a few seconds of audio. A codec without `openMp3Stream`
 * takes the single-buffer path at any size. An all-Finished chapter that
 * joins is never streamed: the join holds no PCM at all.
 */
export async function exportChapterMp3(
  chapterId: ChapterId,
  codec: ChapterCodec,
  shouldEncode?: () => boolean,
  onStep?: StepReporter,
  streamAbovePcmBytes: number = STREAMING_PCM_THRESHOLD_BYTES
): Promise<ChapterExport | null> {
  const plan = await sizeChapter(chapterId);
  if (plan.allMp3 && plan.present.length > 0) {
    const joined = await joinFinishedChapter(plan, shouldEncode, onStep);
    if (joined === "cancelled") return null;
    if (joined !== "not-joinable") {
      if (joined !== null) codec.onJoined?.();
      return joined;
    }
  }
  const openStream = codec.openMp3Stream;
  if (openStream && plan.capacity * 2 > streamAbovePcmBytes)
    return streamChapterMp3(plan, codec, openStream, shouldEncode, onStep);
  const gathered = await fillChapterPcm(plan, codec, shouldEncode, onStep);
  if (gathered === null) return null;
  const { samples, segments, missing } = gathered;
  if (segments === 0) return null;
  if (shouldEncode && !shouldEncode()) return null;
  return { mp3: await codec.encodeMp3(samples), segments, missing };
}

/**
 * A long chapter, encoded as it is read (#1003 part b): each segment is read
 * (and, if Finished, decoded) exactly as {@link fillChapterPcm} reads it,
 * then handed to one open encode — the gap first when it is not the first —
 * and dropped. The page holds one segment's PCM at a time, never the
 * chapter's; the browser codec transfers each write to the worker, which
 * keeps lamejs's own state between writes, not the PCM
 * (`createMp3StreamEncoder`). Because the encoder is fed the same samples in
 * the same order, the MP3 is byte-identical to encoding the gathered chapter
 * whole (`tests/chapter-stream.test.ts`).
 *
 * THE COUNT IS COARSER, and that is the trade the DRI picked (see
 * {@link STREAMING_PCM_THRESHOLD_BYTES}). `(0, n)` first, then each segment's
 * step once its PCM is IN THE ENCODER — the read, the decode and the encode
 * of that segment are all behind it — so no step waits on a later one and a
 * vanished clip is still placed at its own position. What is lost is the
 * encode stretch's fraction: there is no whole-chapter encode left to report
 * one, so a count wrapped by {@link withEncodeSteps} reads `n` of
 * `n + ENCODE_STEPS` once the last segment is in, then its total when
 * `finish` resolves and the MP3 exists. Same total, same items, same keys,
 * forward-only — only the encode stretch has no steps in between.
 *
 * Cancel: `shouldContinue` is checked before the stream opens, before and
 * after every read, after every write and before `finish`; a cancel returns
 * `null` with no further step. A write or `finish` that rejects (the worker
 * died, stalled or was aborted) rejects the export with that error, and
 * reports nothing after the last whole segment. Either way the stream is
 * cancelled on the way out unless `finish` produced the MP3.
 */
async function streamChapterMp3(
  plan: ChapterPlan,
  codec: Pick<AudioCodec, "decodeMp3">,
  openStream: NonNullable<AudioCodec["openMp3Stream"]>,
  shouldContinue?: () => boolean,
  onStep?: StepReporter
): Promise<ChapterExport | null> {
  const live = () => !shouldContinue || shouldContinue();
  if (!live()) return null;
  const stream = await openStream();
  let finished = false;
  try {
    const { present } = plan;
    let missing = plan.missing;
    let segments = 0;
    let done = 0;
    let skipped = 0;
    const keys = present.map((p) => p.clipId);
    onStep?.(done, present.length, skipped, undefined, keys);
    for (const { clipId, frames } of present) {
      if (!live()) return null;
      const fitted = await readSlot(clipId, frames, codec);
      if (!live()) return null;
      if (fitted === null) {
        missing++;
        skipped++;
      } else {
        if (segments > 0) await stream.write(silence(GAP_FRAMES));
        await stream.write(fitted);
        segments++;
        if (!live()) return null;
      }
      onStep?.(++done, present.length, skipped, undefined, keys);
    }
    if (segments === 0 || !live()) return null;
    const mp3 = await stream.finish();
    finished = true;
    return { mp3, segments, missing };
  } finally {
    if (!finished) stream.cancel();
  }
}

/**
 * The codec a chapter export takes: an {@link AudioCodec}, plus an optional
 * `onJoined` the export calls once when it has built the MP3 by joining
 * stored frames instead of calling `encodeMp3` (#1004). {@link withEncodeSteps}
 * fills it in so a joined chapter's count still reaches its total; a caller
 * that does not count (Share Book) passes a plain `AudioCodec`.
 */
export type ChapterCodec = AudioCodec & { readonly onJoined?: () => void };

/**
 * Build an all-Finished chapter's MP3 by joining its stored frames (#1004).
 *
 * Every present clip is read and checked (`parseJoinableMp3`) here, one at a
 * time, and joined (`joinMp3`) once every clip is in hand. **Nothing is
 * reported on `onStep` until ALL of that has happened AND `joinMp3` has
 * actually built the joined bytes** — only then is the per-clip step
 * sequence (`(0, n)`, then one step per clip, each carrying the running
 * `skipped` and the counted clips' ids as `keys`, #1044) reported, in one
 * pass over the already-known results.
 *
 * This was NOT always the design (#1004 residual 2 tried reporting each
 * clip's step live, as it was read, mirroring {@link gatherChapterPcm}) —
 * reverted at review bench round 2 on PR #1068 (Frank + George), because live
 * per-clip reporting here cannot be made sound against #1049's progress
 * machine (`withStep`, `hooks/share-progress.ts`), which fixes a run's
 * `total`/`keys` at its first step and infers a skip's POSITION from the
 * `done`/`skipped` delta between the reports it actually receives, not from
 * an explicit index:
 *
 * - **A clip already reported present here can vanish before the FALLBACK's
 *   own, independent re-read** (`fillChapterPcm`, called after this function
 *   returns `"not-joinable"`). Once this function's report for that clip has
 *   reached the reducer, it cannot be un-reported; the fallback's later,
 *   correct report that the clip is now missing either gets dropped by
 *   {@link withEncodeSteps}'s forward-only guard, or — worse — lands on a
 *   LATER `done` value and gets attributed to the wrong clip's position,
 *   because `placeHollow` has no notion of "which clip", only "how far the
 *   count has moved since the last skip." (`tests/share-carry-keys.test.ts`,
 *   "a later clip not joinable AND an earlier clip vanishing before the
 *   re-read".)
 * - **`joinMp3` itself can still fail after every clip has individually
 *   parsed** (mismatched format across pieces, or a piece whose granule
 *   count does not cover its own recorded length — `coversRecording`). Live
 *   per-clip reporting had already carried `done` up to this function's own
 *   total by the time that failure is discovered, so the FALLBACK's fresh
 *   per-clip reports — real, newly-happening decode work — arrive at `done`
 *   values the guard had already seen and are dropped outright: the visible
 *   count parks at wherever the doomed join attempt left it until the
 *   encoder's own fractional progress (if any) eventually pushes past it.
 *   (`tests/share-carry-keys.test.ts`, "joinMp3 refuses a chapter every clip
 *   individually parsed".)
 *
 * Both failures share one root cause: this function's own report for a given
 * clip is only ever correct if the chapter's join, as a WHOLE, succeeds — and
 * that cannot be known until every clip is read, parsed and actually joined.
 * Reporting speculatively, before that is known, risks reporting something
 * for a chapter this function is about to refuse — the one guarantee
 * `"not-joinable"` below exists to make. Given `hooks/share-progress.ts`'s
 * contract cannot be changed to carry an explicit per-clip index instead of
 * inferring one (out of scope here), holding every report until success is
 * confirmed is what keeps the reducer's inference sound: whichever pass
 * — this one, on success, or `fillChapterPcm`'s fallback, on failure —
 * ends up producing the file is the ONLY account the reducer ever sees, so
 * there is nothing for a later pass to contradict or a guard to swallow.
 * This does mean a chapter's read is silent on the ring until the join
 * succeeds or fails, same as before #1004 was first tried on this path —
 * `ENCODE_STEPS`'s docblock says the same thing from the caller's side.
 *
 * A clip gone since pass 1 is skipped and counted missing, as there, and
 * still gets its own step — it is a resolved clip, just one with nothing to
 * join.
 *
 * Returns:
 *
 * - `"not-joinable"` — some clip cannot be copied safely, or `joinMp3`
 *   refused the whole set: nothing was reported, and the caller builds the
 *   chapter by decode and encode instead.
 * - `"cancelled"` — `shouldContinue` went false; checked before every read
 *   and re-checked after it, and again once every clip is read. Nothing is
 *   reported either way, since nothing is reported before this point at all.
 * - `null` — every clip vanished: nothing to share.
 * - the joined MP3 otherwise.
 *
 * Memory: the chapter's stored MP3s and the joined result, ~1 MB a minute of
 * audio together, where the decode-and-encode path holds the chapter as PCM.
 */
async function joinFinishedChapter(
  plan: ChapterPlan,
  shouldContinue?: () => boolean,
  onStep?: StepReporter
): Promise<ChapterExport | "not-joinable" | "cancelled" | null> {
  const pieces: JoinPiece[] = [];
  /** Per present clip, in order: whether it was skipped (gone since pass 1). */
  const skippedAt: boolean[] = [];
  let missing = plan.missing;
  for (const { clipId, frames } of plan.present) {
    if (shouldContinue && !shouldContinue()) return "cancelled";
    const clip = await getClip(clipId);
    // Re-checked after the await: a cancel that landed during this read
    // stops here, before this clip is even added to `skippedAt` below.
    if (shouldContinue && !shouldContinue()) return "cancelled";
    if (!clip) {
      missing++;
      skippedAt.push(true);
      continue;
    }
    if (clip.encoding !== "mp3") return "not-joinable";
    const parsed = parseJoinableMp3(clip.mp3);
    if (parsed === null) return "not-joinable";
    pieces.push({ frames: parsed, recorded: frames });
    skippedAt.push(false);
  }
  if (shouldContinue && !shouldContinue()) return "cancelled";
  const mp3 =
    pieces.length === 0 ? null : joinMp3(pieces, GAP_FRAMES, MP3_ENCODER_DELAY);
  if (pieces.length > 0 && mp3 === null) return "not-joinable";

  // Only now — every clip read, every one either missing (counted) or
  // joinable, and (when there was anything to join) `joinMp3` itself
  // succeeded — report the steps. See the docblock for why nothing is
  // reported any earlier than this.
  const total = plan.present.length;
  // The counted segments by clip id (#1044), as the gather names them.
  const keys = plan.present.map((p) => p.clipId);
  let skipped = 0;
  onStep?.(0, total, skipped, undefined, keys);
  skippedAt.forEach((wasSkipped, i) => {
    if (wasSkipped) skipped++;
    onStep?.(i + 1, total, skipped, undefined, keys);
  });
  if (mp3 === null) return null;
  return { mp3, segments: pieces.length, missing };
}

/**
 * How many steps the encode adds to a counted Share Chapter (#996).
 *
 * A fixed stretch rather than one per segment: the encode is one pass over
 * the whole chapter, its progress arrives as a fraction, and a hundred steps
 * gives that fraction whole-percent resolution. It also sets the weight the
 * encode gets against the gather — for a chapter of `n` segments the gather
 * is `n / (n + 100)` of the count. That weighting is a judgment, not a
 * measurement of any phone: an indicative Node timing, with its harness, is
 * at https://github.com/unfoldingWord/tc-mobile/pull/998#issuecomment-5840566858
 * and the phone check on #974 is what can say whether the split
 * looks right. A chapter that mixes finished (MP3) and draft segments pays a
 * decode per finished segment in the gather, which gives the gather more real
 * weight than an all-PCM chapter. An all-Finished chapter is joined, not
 * encoded (#1004): its reads, per-clip validation and the join itself all
 * happen before its first step, and the count then runs from `0` to its
 * total at once, once the joined MP3 is confirmed to exist. This is
 * deliberate, not a residual gap — {@link joinFinishedChapter}'s own docblock
 * explains why reporting any earlier is unsound against #1049's progress
 * machine (review bench round 2 on PR #1068 reverted an earlier attempt at
 * live per-clip reporting here for exactly that reason).
 */
export const ENCODE_STEPS = 100;

/**
 * Put a chapter's MP3 encode on its step count (#996): wraps a build's codec
 * and `onStep` so the count the caller sees is ONE forward-only count with a
 * fixed total — the gather's segments, then `ENCODE_STEPS` for the encode.
 *
 * Why one count and not a second stretch with its own total: the progress
 * machine fixes a run's total at its first step and only moves forward
 * (`share-progress.ts`), and a ring that jumped back to zero for a second
 * stretch would read as work lost. So the total is fixed once, when the gather
 * first reports: `segments + ENCODE_STEPS`.
 *
 * - The gather's own `(done, n, skipped)` is re-scaled to `n + ENCODE_STEPS`,
 *   and every report names `n` as its `items`, so a reader can tell the
 *   segments from the encode stretch. The gather's `keys` (#1044) ride every
 *   report unchanged, the encode stretch's included.
 * - While the encode runs, the codec's `onProgress(fraction)` moves the count
 *   to `n + floor(fraction * ENCODE_STEPS)`, capped one short of the total:
 *   the encoder saying `1` is not the MP3 in hand.
 * - Only when `encodeMp3` RESOLVES — the MP3 exists — does the count read
 *   `total`. An encode that rejects (an abort terminates the worker, a stall,
 *   an encoder error) never gets there. The one other way there is the
 *   codec's `onJoined` (#1004): a build that joined stored MP3 frames instead
 *   of encoding calls it once the joined MP3 exists, and it moves the count to
 *   `total` exactly as a resolved encode does. A streamed chapter (#1003 part
 *   b) gets there when its stream's `finish` resolves; it reports no encode
 *   fraction, so its count goes from the last segment straight to `total`.
 * - Every report checks `shouldContinue` first, so nothing moves once a cancel
 *   is observable, and a report that would not move the count forward (a
 *   repeated, lower or non-numeric fraction) is dropped here rather than sent.
 *
 * If the build never reports a gather total (a chapter with nothing to
 * gather), the encode reports nothing either — there is no scale to put it on.
 * Pure: the codec and reporter are injected, so this is tested in Node.
 */
export function withEncodeSteps<T>(
  onStep: StepReporter,
  shouldContinue: () => boolean,
  build: (codec: ChapterCodec, onStep: StepReporter) => Promise<T>
): (codec: AudioCodec) => Promise<T> {
  return (encoder) => {
    /** The gather's segment count, fixed by its first report. */
    let segments: number | null = null;
    let skipped = 0;
    /** The gather's counted segments by key (#1044), forwarded unchanged. */
    let keys: readonly string[] | undefined;
    let last = -1;
    const report = (done: number, gatherSteps: number): void => {
      if (!(done > last) || !shouldContinue()) return;
      last = done;
      onStep(done, gatherSteps + ENCODE_STEPS, skipped, gatherSteps, keys);
    };
    const gathered: StepReporter = (done, total, skippedSoFar, _, keysOf) => {
      segments ??= total;
      if (skippedSoFar !== undefined) skipped = skippedSoFar;
      keys ??= keysOf;
      report(done, segments);
    };
    /** `into` encode steps past the gather; nothing if it never reported. */
    const encoded = (into: number): void => {
      if (segments !== null) report(segments + into, segments);
    };
    const openStream = encoder.openMp3Stream;
    const codec: ChapterCodec = {
      decodeMp3: encoder.decodeMp3,
      // A streamed chapter (#1003 part b) has no encode fraction to report;
      // its count reaches total when `finish` resolves, as a resolved
      // `encodeMp3` does, and never on a finish that rejects.
      ...(openStream && {
        openMp3Stream: async () => {
          const stream = await openStream();
          return {
            write: stream.write,
            cancel: stream.cancel,
            finish: async () => {
              const mp3 = await stream.finish();
              encoded(ENCODE_STEPS);
              return mp3;
            },
          };
        },
      }),
      // Joined instead of encoded (#1004): the MP3 exists all the same.
      onJoined: () => encoded(ENCODE_STEPS),
      encodeMp3: async (samples, onProgress) => {
        const mp3 = await encoder.encodeMp3(samples, (fraction) => {
          encoded(
            Math.min(ENCODE_STEPS - 1, Math.floor(fraction * ENCODE_STEPS))
          );
          // A build that listens to the encode itself still hears it.
          onProgress?.(fraction);
        });
        // The MP3 exists: the one place the count may reach its total.
        encoded(ENCODE_STEPS);
        return mp3;
      },
    };
    return build(codec, gathered);
  };
}
