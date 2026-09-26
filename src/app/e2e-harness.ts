/**
 * Browser-only smoke-test harness for the Playwright suite (#251).
 *
 * NEVER shipped in a real build. `main.tsx` dynamically imports this module
 * behind `import.meta.env.MODE === "e2e"`, but that guard alone would not
 * keep it out of `dist/` — Rollup discovers a dynamic `import()` target from
 * the module graph regardless of a surrounding runtime condition. What
 * actually excludes it is `vite.config.ts`'s `build.rollupOptions.external`,
 * which marks this file external for every mode but `"e2e"`, so a plain
 * `npm run build` (what `staging`/`main` ship) never resolves or bundles it
 * at all — genuinely absent from `dist/`, not a dead branch shipped and
 * skipped. `npm run build:e2e` (`vite build --mode e2e`) is the only build
 * that includes it. `knip.json` lists this file under `entry` for the same
 * reason: a normal build's graph has no importer of it at all.
 *
 * Exposes the app's REAL browser-boundary modules on `window.__e2e` — the
 * encoder lane (`hooks/mp3-codec.ts`, the real Worker), the MP3 decode
 * (`hooks/audio-io.ts`'s `decodeAudioData`, via the same codec), and the
 * storage layer's `getDb` (`lib/storage/db.ts`, the real IndexedDB open) — so
 * Playwright can drive them directly. Deliberately NOT a UI walkthrough: the
 * issue is explicit that clicking through Books → Segments → Recorder proves
 * nothing here that calling the same functions the screens call doesn't, and
 * a fake-microphone UI flow would be far more brittle than this.
 */

import {
  ENCODER_READY_TIMEOUT_MS,
  ENCODER_SILENCE_TIMEOUT_MS,
  encoderSnapshotTaken,
  warmEncoder,
  withEncoder,
} from "@/hooks/mp3-codec";
import { decodeToCanonical } from "@/hooks/audio-io";
import { getDb, type TcMobileDb } from "@/lib/storage/db";
import { CANONICAL_SAMPLE_RATE, INT16_MAX } from "@/lib/audio/format";
import { measureLevel } from "@/lib/audio/level";
import {
  fitMp3Decode,
  mp3GranuleCount,
  MP3_ENCODER_DELAY,
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
} from "@/lib/audio/mp3-align";
import { computePeaks } from "@/lib/audio/peaks";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import { exportChapterMp3, SEGMENT_GAP_SECONDS } from "@/lib/export/chapter";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";
import type { IDBPDatabase } from "idb";

export interface EncodeDecodeResult {
  /** Bytes of the MP3 the worker returned. */
  readonly mp3Length: number;
  /**
   * The length `decodeAudioData` ACTUALLY returned, before `fitToFrames`
   * truncates or zero-pads it. This is the only number in this result that
   * says what the browser's decoder did; the fitted length below cannot,
   * because `fitToFrames` returns exactly `frames` in all three of its
   * branches (`lib/audio/edit.ts`).
   */
  readonly rawDecodedFrameCount: number;
  /**
   * `mp3GranuleCount(mp3) * MP3_GRANULE` — the length a decoder that trims
   * nothing returns, walked out of the real stream's own frame headers. The
   * reference `rawDecodedFrameCount` is measured against.
   */
  readonly emittedFrameCount: number;
  /** What `fitMp3Decode` returns — always `expectedFrameCount`, by construction. */
  readonly fittedFrameCount: number;
  /** The frame count fed in. */
  readonly expectedFrameCount: number;
  /** Samples each RMS below is taken over: the decoder priming, 1105 samples. */
  readonly rmsWindow: number;
  /** RMS of the fitted decode's FIRST `rmsWindow` samples. */
  readonly fittedHeadRms: number;
  /** RMS of the fitted decode's LAST `rmsWindow` samples. */
  readonly fittedTailRms: number;
  /** RMS of the same window of the PCM fed in — the scale to compare against. */
  readonly sourceRms: number;
  /** Best matching offset of the decoded chirp relative to its source. */
  readonly alignmentLag: number;
  /** Normalized correlation at that offset; gain changes do not affect it. */
  readonly alignmentCorrelation: number;
}

/** A synthetic tone, not silence — a real encoder path, not an all-zero edge case. */
function syntheticPcm(frameCount: number): Int16Array {
  const out = new Int16Array(frameCount);
  const freq = 440;
  for (let i = 0; i < frameCount; i++) {
    out[i] = Math.round(
      Math.sin((2 * Math.PI * freq * i) / CANONICAL_SAMPLE_RATE) * 8_000
    );
  }
  return out;
}

/** Root-mean-square of `count` samples starting at `from`. Silence reads ~0. */
function rms(samples: Int16Array, from: number, count: number): number {
  return measureLevel(samples.subarray(from, from + count), INT16_MAX).rms;
}

/** Find the chirp's position independently of the MP3 delay calculation. */
function measureAlignment(source: Int16Array, fitted: Int16Array) {
  // Stay clear of MP3 boundary transients, with one fixed source window for
  // every candidate lag. The chirp changes frequency so a cycle cannot alias
  // a genuine alignment, as it could with a stationary tone.
  const count = 16_384;
  const from = Math.floor((source.length - count) / 2);
  let sourceEnergy = 0;
  for (let i = from; i < from + count; i++) sourceEnergy += source[i]! ** 2;
  let alignmentLag = 0;
  let alignmentCorrelation = -1;
  for (let lag = -MP3_TOTAL_DELAY; lag <= MP3_TOTAL_DELAY; lag++) {
    let dot = 0;
    let fittedEnergy = 0;
    for (let i = from; i < from + count; i++) {
      const value = fitted[i + lag]!;
      dot += source[i]! * value;
      fittedEnergy += value ** 2;
    }
    const correlation = dot / Math.sqrt(sourceEnergy * fittedEnergy);
    if (correlation > alignmentCorrelation) {
      alignmentLag = lag;
      alignmentCorrelation = correlation;
    }
  }
  return { alignmentLag, alignmentCorrelation };
}

/**
 * Encode a chirp through the real worker, decode through decodeAudioData, and
 * measure alignment against the source as well as head/tail energy. Fitted
 * length alone cannot detect a wrong skip because fitToFrames enforces it.
 */
async function encodeAndDecode(
  frameCount: number
): Promise<EncodeDecodeResult> {
  const samples = new Int16Array(frameCount);
  const duration = frameCount / CANONICAL_SAMPLE_RATE;
  for (let i = 0; i < frameCount; i++) {
    const time = i / CANONICAL_SAMPLE_RATE;
    const phase =
      2 * Math.PI * (300 * time + (2_700 * time * time) / (2 * duration));
    samples[i] = Math.round(8_000 * Math.sin(phase));
  }
  // encodeMp3 transfers and detaches samples; retain an independent reference.
  const source = samples.slice();
  const window = MP3_TOTAL_DELAY;
  const sourceRms = rms(samples, 0, window);
  const mp3 = await withEncoder(undefined, (codec) => codec.encodeMp3(samples));
  const decoded = await withEncoder(undefined, (codec) => codec.decodeMp3(mp3));
  const rawDecodedFrameCount = decoded.length;
  const fitted = fitMp3Decode(decoded, mp3, frameCount);
  return {
    mp3Length: mp3.length,
    rawDecodedFrameCount,
    emittedFrameCount: mp3GranuleCount(mp3) * MP3_GRANULE,
    fittedFrameCount: fitted.length,
    expectedFrameCount: frameCount,
    rmsWindow: window,
    fittedHeadRms: rms(fitted, 0, window),
    fittedTailRms: rms(fitted, Math.max(0, fitted.length - window), window),
    sourceRms,
    ...measureAlignment(source, fitted),
  };
}

/** Synthetic stereo input only: no capture hardware or output route is measured. */
async function measureCanonicalise(
  right: "identical" | "decorrelated" | "silent"
) {
  const frames = CANONICAL_SAMPLE_RATE * 3;
  const left = syntheticPcm(frames);
  const bytes = new ArrayBuffer(44 + frames * 4);
  const wav = new DataView(bytes);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      wav.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF");
  wav.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 2, true);
  wav.setUint32(24, CANONICAL_SAMPLE_RATE, true);
  wav.setUint32(28, CANONICAL_SAMPLE_RATE * 4, true);
  wav.setUint16(32, 4, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    const second =
      right === "identical"
        ? left[i]!
        : right === "silent"
          ? 0
          : Math.round(
              Math.sin((2 * Math.PI * 631 * i) / CANONICAL_SAMPLE_RATE) * 8_000
            );
    wav.setInt16(44 + i * 4, left[i]!, true);
    wav.setInt16(46 + i * 4, second, true);
  }
  // This is the app's decode and single downmix/resample render, not a second
  // observer context. The non-identical rows distinguish render from channel-0 passthrough.
  const output = await decodeToCanonical(
    new Blob([bytes], { type: "audio/wav" })
  );
  const sourceRms = rms(left, 0, frames);
  const outputRms = rms(output, 0, output.length);
  return {
    sourceRms,
    outputRms,
    deltaDb: 20 * Math.log10(outputRms / sourceRms),
    inputFrames: frames,
    outputFrames: output.length,
  };
}

export interface HeartbeatResult {
  /** Audio fed to each encode, in samples. */
  readonly frameCount: number;
  /**
   * (a) The encode through the app's REAL lane — `withEncoder`, the shared
   * worker, the silence deadline armed — finished and returned bytes. A stall
   * rejects with `EncoderStalledError` and would surface here as `stalledName`.
   */
  readonly codecMp3Length: number;
  readonly codecEncodeMs: number;
  readonly stalledName: string | null;
  /** (b) How many `progress` messages the instrumented worker posted before `done`. */
  readonly progressCount: number;
  /** Wall-clock of the instrumented encode, request post to `done` receipt. */
  readonly directEncodeMs: number;
  /**
   * (c) The longest SILENCE the main thread saw while the worker was busy:
   * the largest gap between the request and the first message, between
   * consecutive `progress` messages, and between the last one and `done`.
   * This is the quantity `ENCODER_SILENCE_TIMEOUT_MS` is judged against.
   */
  readonly maxGapMs: number;
  /** The real `ENCODER_SILENCE_TIMEOUT_MS`, so the spec compares against it rather than a copy. */
  readonly deadlineMs: number;
}

/**
 * Does a BUSY worker's heartbeat actually reach the main thread in time
 * (George R4 residual 1, #166)?
 *
 * The silence deadline rests on it. `mp3.worker.ts` posts `progress` from
 * inside a synchronous encode loop; if the browser held those messages until
 * the worker's handler returned, a long, healthy encode would look silent for
 * its whole duration and be killed. No Node fake can say what Chromium does.
 *
 * Two encodes of the same length, because the codec keeps its worker private
 * and does not expose its message stream (and should not grow a test-only
 * seam for this):
 *
 *  1. through `withEncoder`, the app's real lane with the deadline armed —
 *     this is the claim that a long encode COMPLETES rather than stalls;
 *  2. through a second instance of the SAME worker script, built from the same
 *     module URL, with every message timestamped on receipt — this is where the
 *     heartbeat's count and gaps are measured. Same script, same browser, same
 *     idle main thread; only the observer differs.
 */
async function encodeWithHeartbeat(
  frameCount: number
): Promise<HeartbeatResult> {
  let codecMp3Length = 0;
  let stalledName: string | null = null;
  const codecStart = performance.now();
  try {
    const mp3 = await withEncoder(undefined, (codec) =>
      codec.encodeMp3(syntheticPcm(frameCount))
    );
    codecMp3Length = mp3.length;
  } catch (cause) {
    stalledName = cause instanceof Error ? cause.name : String(cause);
  }
  const codecEncodeMs = performance.now() - codecStart;

  const worker = new Worker(
    new URL("../hooks/mp3.worker.ts", import.meta.url),
    { type: "module" }
  );
  try {
    const samples = syntheticPcm(frameCount);
    const arrivals: number[] = [];
    const posted = performance.now();
    const outcome = await new Promise<{ kind: string; count: number }>(
      (resolve, reject) => {
        let count = 0;
        worker.onmessage = (event: MessageEvent<{ kind: string }>) => {
          // `ready` (#192) is posted once when the worker's script has run, and
          // belongs to no job: it arrives before this encode's request is even
          // answered, so counting it would put a gap in the measurement that is
          // about script load rather than about the heartbeat, and resolving on
          // it would end the encode before it started.
          if (event.data.kind === "ready") return;
          arrivals.push(performance.now());
          if (event.data.kind === "progress") {
            count += 1;
            return;
          }
          resolve({ kind: event.data.kind, count });
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage(
          {
            buffer: samples.buffer,
            byteOffset: samples.byteOffset,
            length: samples.length,
          },
          [samples.buffer]
        );
      }
    );
    if (outcome.kind !== "done") {
      throw new Error(`instrumented encode ended with ${outcome.kind}`);
    }
    let maxGapMs = 0;
    let previous = posted;
    for (const at of arrivals) {
      maxGapMs = Math.max(maxGapMs, at - previous);
      previous = at;
    }
    return {
      frameCount,
      codecMp3Length,
      codecEncodeMs,
      stalledName,
      progressCount: outcome.count,
      directEncodeMs: previous - posted,
      maxGapMs,
      deadlineMs: ENCODER_SILENCE_TIMEOUT_MS,
    };
  } finally {
    worker.terminate();
  }
}

/**
 * Force the abort-driven REBUILD of the encoder worker, then encode through it
 * (#192).
 *
 * This is the path #182 left exposed and #192 closes. A warm worker survives a
 * service-worker update because it holds its compiled script; an abort
 * `terminate()`s it — the only way to stop an in-flight encode — and the
 * rebuild that follows is what used to go back to the hashed chunk URL the
 * update had purged.
 *
 * The spec BLOCKS that chunk URL before calling this, which is the purge. So
 * the rebuilt worker can only have come from the blob snapshot taken at warmup,
 * and a returned MP3 is that blob worker actually running — the one claim the
 * Node tests cannot make, because they stub `fetch`, `Blob` and
 * `createObjectURL`.
 *
 * The abort must land while an encode is genuinely IN FLIGHT: an abort before
 * `withEncoder` reaches the codec rejects at the lane and never terminates
 * anything, which would leave the warm worker alive and this assertion green
 * for the wrong reason.
 *
 * A `setTimeout(0)` was not enough to guarantee that (George R1 P3-6). One
 * second of PCM encodes in a few milliseconds on this container — the heartbeat
 * spec needs ten MINUTES of audio to get a measurable encode — so `done` could
 * beat the abort and the spec would flake on `aborted`. The wait is now the
 * event itself rather than a guess at how long it takes: `encodeMp3` TRANSFERS
 * the PCM's `ArrayBuffer` to the worker, which detaches it on this thread, so
 * `byteLength === 0` is the exact moment the request has been posted. The clip
 * is also long enough that the encode cannot plausibly finish in the turn that
 * observation costs.
 */
async function encodeAfterAbortRebuild(frameCount: number): Promise<{
  transferred: boolean;
  aborted: boolean;
  chunkRequestsBefore: number;
  chunkRequestsAfter: number;
  mp3Length: number;
}> {
  // A first encode proves the warm worker is up and the lane is clear, so the
  // abort below cannot be rejected while merely waiting for a previous job.
  await withEncoder(undefined, (codec) =>
    codec.encodeMp3(syntheticPcm(MP3_GRANULE))
  );

  const chunkRequestsBefore = chunkRequestCount();

  const controller = new AbortController();
  const pcm = syntheticPcm(frameCount);
  const inFlight = withEncoder(controller.signal, (codec) =>
    codec.encodeMp3(pcm)
  );
  // Wait for the PCM to be TRANSFERRED — the detach is what says the worker has
  // the request and an encode is genuinely in flight. Bounded, so a failure to
  // post shows up as an assertion rather than a hung page.
  const deadline = performance.now() + 5_000;
  while (pcm.byteLength !== 0 && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 0));
  // REPORTED, never assumed (Frank R3 P2). If the deadline expired with the
  // buffer still attached, nothing was in flight, so the abort below terminated
  // nothing and the "rebuild" the spec goes on to measure is just the original
  // warm worker still running. The spec asserts on this, so that case is a
  // failure rather than a pass that proved nothing.
  const transferred = pcm.byteLength === 0;
  controller.abort();
  let aborted = false;
  try {
    await inFlight;
  } catch (cause) {
    // Only THIS signal's reason counts. A worker error, a stall, or an encode
    // failure also rejects here, and each of them leaves a different worker
    // state behind — classifying them all as "aborted" is how the assertion
    // below stops describing what happened.
    aborted = cause === controller.signal.reason;
  }

  // The abort re-warms; this encode runs on whatever that rebuild produced.
  warmEncoder();
  const mp3 = await withEncoder(undefined, (codec) =>
    codec.encodeMp3(syntheticPcm(frameCount))
  );
  return {
    transferred,
    aborted,
    chunkRequestsBefore,
    chunkRequestsAfter: chunkRequestCount(),
    mp3Length: mp3.length,
  };
}

/**
 * How many times this page has requested the hashed worker chunk, counted from
 * the page's OWN resource timeline.
 *
 * Both numbers the caller compares come from here, so the comparison never
 * straddles two measurement systems: Playwright's request events and this
 * timeline agree today, but a worker script load shows up here with
 * `initiatorType: "other"`, which is a Chromium detail and not a contract.
 */
function chunkRequestCount(): number {
  return performance
    .getEntriesByType("resource")
    .filter((entry) => /assets\/mp3\.worker-.*\.js$/.test(entry.name)).length;
}

/**
 * How long does a worker take to say `ready` (#192, George R2 P2)?
 *
 * `ENCODER_READY_TIMEOUT_MS` has to cover evaluation of the whole worker chunk,
 * lamejs included, because `ready` is posted at the FOOT of `mp3.worker.ts`. The
 * constant was chosen by reasoning about that; this measures it.
 *
 * What it measures precisely: a FRESH worker built from the same module URL the
 * codec's chunk path uses, from `new Worker` to the `ready` message, on this
 * browser. It is NOT the blob — the codec keeps its worker private and there is
 * no seam to borrow one — so it bounds the evaluation cost, not the blob's own
 * construction. And it is one engine: a phone may be an order of magnitude
 * slower, which is why the window is made freeze-aware and forgiving of one
 * expiry rather than merely long.
 */
async function measureWorkerReady(): Promise<{
  readyMs: number;
  deadlineMs: number;
}> {
  const worker = new Worker(
    new URL("../hooks/mp3.worker.ts", import.meta.url),
    {
      type: "module",
    }
  );
  try {
    const started = performance.now();
    const readyMs = await new Promise<number>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ kind: string }>) => {
        if (event.data.kind !== "ready") return;
        resolve(performance.now() - started);
      };
      worker.onerror = (event) => reject(new Error(event.message));
    });
    return { readyMs, deadlineMs: ENCODER_READY_TIMEOUT_MS };
  } finally {
    worker.terminate();
  }
}

/**
 * Does the blob snapshot EXIST yet?
 *
 * The spec waits on this before simulating the purge: blocking the chunk before
 * the snapshot exists would leave nothing to rebuild from and the assertion
 * would fail for the wrong reason.
 *
 * It used to ask the resource timeline whether a `fetch`-initiated request for
 * the chunk had landed, which is a PROXY and a lossy one (George R1 P3-5): that
 * entry appears when the response arrives, one `response.text()` and one
 * `createObjectURL` before `snapshotUrl` is assigned, and it cannot see a
 * non-ok response at all. This asks the codec for the state itself.
 */
function workerSnapshotReady(): boolean {
  return encoderSnapshotTaken();
}

// ── Joined chapter MP3, decoded for real (#1004 residual 4) ────────────────
//
// `lib/audio/mp3-join.ts` builds a chapter's MP3 by copying stored frames
// rather than decoding and re-encoding them. That module and
// `lib/export/chapter.ts` are unit-tested in Node against a FAKE decoder —
// nothing in the Node suite has ever handed the joined bytes to a real MP3
// decoder. This is that check: real Finished segments, built the same way the
// transcode sweep builds them (a real PCM take, encoded through the app's own
// worker lane, landed with the real `commitTranscode`), exported through the
// real `exportChapterMp3`, and decoded with the browser's own
// `AudioContext.decodeAudioData` — not the app's `decodeMp3ToCanonical`
// wrapper, so this stands on its own rather than re-exercising code the rest
// of the suite already covers.

/** 44100 / 441 — a whole number of samples, so a tone built from a multiple
 * of it starts and ends on the same rising zero crossing. Any click at a
 * segment's own edge is then attributable to the MP3 codec, not the PCM
 * fixture: the source itself has no discontinuity to find. */
const JOIN_TONE_FREQUENCY_HZ = 441;
const JOIN_TONE_PERIOD_FRAMES = CANONICAL_SAMPLE_RATE / JOIN_TONE_FREQUENCY_HZ;
/** Comfortably inside int16 headroom; RMS ≈ amplitude/√2 ≈ 0.13 of full scale
 * once normalised, well clear of the loud/quiet threshold below either way. */
const JOIN_TONE_AMPLITUDE = 6000;

/** A continuous tone, phase-aligned so `frames` (a multiple of the period)
 * starts and ends at the same point in its cycle. */
function periodicTone(frames: number): Int16Array {
  if (frames % JOIN_TONE_PERIOD_FRAMES !== 0) {
    throw new Error(
      `frame count must be a multiple of ${JOIN_TONE_PERIOD_FRAMES}`
    );
  }
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.round(
      JOIN_TONE_AMPLITUDE *
        Math.sin(
          (2 * Math.PI * JOIN_TONE_FREQUENCY_HZ * i) / CANONICAL_SAMPLE_RATE
        )
    );
  }
  return out;
}

/** RMS window for the loud/quiet envelope below. Small next to both a
 * segment (tens of thousands of samples) and a gap (`SEGMENT_GAP_SECONDS`,
 * ~22 050 samples), so it locates a transition to within one block. */
const ENVELOPE_BLOCK_FRAMES = 200;
/** The tone's RMS is ~0.13 of full scale; real silence should read far below
 * it. Set well between the two, not tuned to either. */
const LOUD_RMS_THRESHOLD = 0.03;

/** Per-block RMS of `channel`, non-overlapping, trailing partial block
 * dropped. */
function blockRms(channel: Float32Array): number[] {
  const blocks: number[] = [];
  for (
    let start = 0;
    start + ENVELOPE_BLOCK_FRAMES <= channel.length;
    start += ENVELOPE_BLOCK_FRAMES
  ) {
    let sumSq = 0;
    for (let i = start; i < start + ENVELOPE_BLOCK_FRAMES; i++) {
      sumSq += channel[i]! ** 2;
    }
    blocks.push(Math.sqrt(sumSq / ENVELOPE_BLOCK_FRAMES));
  }
  return blocks;
}

/** One quiet stretch of blocks, as block indices (`endBlock` exclusive). */
interface GapRun {
  readonly startBlock: number;
  readonly endBlock: number;
}

/**
 * Quiet runs strictly between the first and last loud block.
 *
 * The very start and end of the decode are near-silent too — the first
 * piece's own encoder priming at the head, and the last piece's own trailing
 * padding at the tail (see `mp3-join.ts`'s header) — and neither is one of
 * the deliberate gaps this chapter's segments were joined with. Restricting
 * the search to between the first and last loud block excludes both, so what
 * is left is exactly the `segments.length - 1` inserted gaps, however the
 * decoder trimmed (or did not trim) that leading and trailing silence.
 */
function findInternalGaps(blocks: readonly number[]): GapRun[] {
  const loud = blocks.map((rms) => rms > LOUD_RMS_THRESHOLD);
  const firstLoud = loud.indexOf(true);
  const lastLoud = loud.lastIndexOf(true);
  const gaps: GapRun[] = [];
  if (firstLoud === -1 || lastLoud <= firstLoud) return gaps;
  let runStart = -1;
  for (let i = firstLoud + 1; i <= lastLoud; i++) {
    if (!loud[i]) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      gaps.push({ startBlock: runStart, endBlock: i });
      runStart = -1;
    }
  }
  return gaps;
}

/** RMS of a gap's interior, a few blocks in from each edge so the loud/quiet
 * transition itself (and any decoder ringing right at it) is not counted. */
function gapInteriorRms(channel: Float32Array, gap: GapRun): number {
  const marginBlocks = 3;
  const from = Math.min(
    (gap.startBlock + marginBlocks) * ENVELOPE_BLOCK_FRAMES,
    channel.length
  );
  const to = Math.max(
    from,
    Math.min(
      (gap.endBlock - marginBlocks) * ENVELOPE_BLOCK_FRAMES,
      channel.length
    )
  );
  let sumSq = 0;
  let count = 0;
  for (let i = from; i < to; i++) {
    sumSq += channel[i]! ** 2;
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sumSq / count);
}

/** Samples either side of a detected transition to scan for a click. Wide
 * next to the ~200-sample block that located it, so the true edge — wherever
 * exactly the decoder put it — falls inside the window. */
const BOUNDARY_WINDOW_FRAMES = 300;

/** Largest sample-to-sample jump within `BOUNDARY_WINDOW_FRAMES` of
 * `sampleAt`, in the decoded [-1, 1] scale. */
function boundaryMaxAbsDelta(channel: Float32Array, sampleAt: number): number {
  const from = Math.max(1, sampleAt - BOUNDARY_WINDOW_FRAMES);
  const to = Math.min(channel.length, sampleAt + BOUNDARY_WINDOW_FRAMES);
  let max = 0;
  for (let i = from; i < to; i++) {
    max = Math.max(max, Math.abs(channel[i]! - channel[i - 1]!));
  }
  return max;
}

export interface JoinedChapterDecodeResult {
  /** Segments the export actually joined (`built.segments`). */
  readonly segments: number;
  /** Segments the export could not resolve (`built.missing`); 0 here. */
  readonly missing: number;
  /** Whether the export took the join path (`ChapterCodec.onJoined`) rather
   * than the decode-and-re-encode fallback. False means the fixture built an
   * all-Finished chapter that `parseJoinableMp3` still refused — this check's
   * premise — and everything below describes the fallback's output instead. */
  readonly joined: boolean;
  readonly mp3ByteLength: number;
  /** The decoding AudioContext's actual rate — `CANONICAL_SAMPLE_RATE` unless
   * the browser refused it, in which case the length comparisons below no
   * longer hold at face value. */
  readonly sampleRate: number;
  /** `decodeAudioData`'s own channel length: the browser decode under test. */
  readonly decodedLength: number;
  /** `MP3_ENCODER_DELAY + Σ(recorded) + (segments - 1) × the configured gap`,
   * rounded up to a whole `MP3_GRANULE` — what a single whole-chapter encode
   * of the same segments would decode to, the reference the join's own header
   * says it targets. */
  readonly expectedTotal: number;
  /** `MP3_GRANULE` — the tolerance assertion (b) is judged against, named
   * here so the spec need not re-import the constant to state its own claim. */
  readonly toleranceFrames: number;
  readonly expectedGapCount: number;
  /** Quiet runs actually found between the first and last loud block. */
  readonly gapCount: number;
  /** RMS of each gap's interior, in decode order. */
  readonly gapRms: readonly number[];
  /** Max abs sample-to-sample delta at each detected loud/quiet transition,
   * two per gap (entering it, leaving it), in decode order. */
  readonly boundaryMaxAbsDelta: readonly number[];
}

/**
 * Build a chapter of `segmentFrameCounts.length` Finished segments, export it
 * through the real join path, and decode the result with the browser's own
 * `AudioContext.decodeAudioData` — see the module note above.
 *
 * Each segment's PCM is a phase-aligned tone (`periodicTone`) at a distinct
 * length; `segmentFrameCounts.length` must be at least 2 for there to be a
 * gap to examine. `MP3_ENCODER_DELAY` and `SEGMENT_GAP_SECONDS` are the app's
 * own constants — not re-declared here — so `expectedTotal` moves with the
 * production code it is judged against, rather than a copy that can drift.
 */
async function buildAndDecodeJoinedChapter(
  segmentFrameCounts: readonly number[]
): Promise<JoinedChapterDecodeResult> {
  const book = await createBook("");
  const chapter = await addChapter(book.id);
  for (const frames of segmentFrameCounts) {
    const segment = await addSegment(chapter.id);
    const samples = periodicTone(frames);
    const clipId = newClipId();
    // The take first (copies `samples`), then peaks (reads them), then the
    // encode last — `encodeMp3` transfers and detaches its input.
    await saveTake(segment.id, clipId, samples, CANONICAL_SAMPLE_RATE, {
      finished: true,
    });
    const peaks = computePeaks(samples, ROW_PEAK_BUCKETS);
    const mp3 = await withEncoder(undefined, (codec) =>
      codec.encodeMp3(samples)
    );
    // The real storage write a Finished segment's transcode sweep makes
    // (`hooks/finish-transcode.ts`), not a hand-rolled IndexedDB seed.
    const outcome = await commitTranscode(segment.id, clipId, mp3, peaks);
    if (outcome !== "committed") {
      throw new Error(`commitTranscode did not commit: ${outcome}`);
    }
  }

  let joined = false;
  const built = await exportChapterMp3(chapter.id, {
    decodeMp3: (bytes) =>
      withEncoder(undefined, (codec) => codec.decodeMp3(bytes)),
    encodeMp3: (samples, onProgress) =>
      withEncoder(undefined, (codec) => codec.encodeMp3(samples, onProgress)),
    onJoined: () => {
      joined = true;
    },
  });
  if (!built)
    throw new Error("exportChapterMp3 returned null: nothing to share");

  const Ctor = window.AudioContext;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: CANONICAL_SAMPLE_RATE });
  } catch {
    // The rate was refused, not the context; see `audio-io.ts`'s own fallback.
    ctx = new Ctor();
  }
  const bytes = built.mp3;
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }
  const channel = decoded.getChannelData(0);

  const totalRecorded = segmentFrameCounts.reduce((sum, n) => sum + n, 0);
  const gapFrames = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);
  const expectedGapCount = segmentFrameCounts.length - 1;
  const expectedTotal =
    Math.ceil(
      (MP3_ENCODER_DELAY + totalRecorded + expectedGapCount * gapFrames) /
        MP3_GRANULE
    ) * MP3_GRANULE;

  const blocks = blockRms(channel);
  const gapsFound = findInternalGaps(blocks);
  const gapRms = gapsFound.map((gap) => gapInteriorRms(channel, gap));
  const boundaryMaxAbsDeltaList: number[] = [];
  for (const gap of gapsFound) {
    boundaryMaxAbsDeltaList.push(
      boundaryMaxAbsDelta(channel, gap.startBlock * ENVELOPE_BLOCK_FRAMES),
      boundaryMaxAbsDelta(channel, gap.endBlock * ENVELOPE_BLOCK_FRAMES)
    );
  }

  return {
    segments: built.segments,
    missing: built.missing,
    joined,
    mp3ByteLength: bytes.byteLength,
    sampleRate: decoded.sampleRate,
    decodedLength: channel.length,
    expectedTotal,
    toleranceFrames: MP3_GRANULE,
    expectedGapCount,
    gapCount: gapsFound.length,
    gapRms,
    boundaryMaxAbsDelta: boundaryMaxAbsDeltaList,
  };
}

/** Open the app's real IndexedDB connection through its real singleton. */
async function openDb(): Promise<{ name: string; version: number }> {
  const db = await getDb();
  window.__e2e!.db = db;
  return { name: db.name, version: db.version };
}

/** Has the real connection opened by `openDb()` seen a native `versionchange`? */
function watchVersionChange(): void {
  const db = window.__e2e?.db;
  if (!db) throw new Error("call openDb() before watchVersionChange()");
  window.__e2e!.versionChangeFired = false;
  db.addEventListener("versionchange", () => {
    window.__e2e!.versionChangeFired = true;
  });
}

declare global {
  interface Window {
    __e2e?: {
      measureCanonicalise: typeof measureCanonicalise;
      encodeAndDecode: typeof encodeAndDecode;
      encodeWithHeartbeat: typeof encodeWithHeartbeat;
      encodeAfterAbortRebuild: typeof encodeAfterAbortRebuild;
      measureWorkerReady: typeof measureWorkerReady;
      workerSnapshotReady: typeof workerSnapshotReady;
      buildAndDecodeJoinedChapter: typeof buildAndDecodeJoinedChapter;
      openDb: typeof openDb;
      watchVersionChange: typeof watchVersionChange;
      db?: IDBPDatabase<TcMobileDb>;
      versionChangeFired?: boolean;
    };
  }
}

window.__e2e = {
  measureCanonicalise,
  encodeAndDecode,
  encodeWithHeartbeat,
  encodeAfterAbortRebuild,
  measureWorkerReady,
  workerSnapshotReady,
  buildAndDecodeJoinedChapter,
  openDb,
  watchVersionChange,
};
