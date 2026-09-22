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
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  fitMp3Decode,
  mp3GranuleCount,
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
} from "@/lib/audio/mp3-align";
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
  const end = Math.min(samples.length, from + count);
  if (end <= from) return 0;
  let sum = 0;
  for (let i = from; i < end; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (end - from));
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
  openDb,
  watchVersionChange,
};
