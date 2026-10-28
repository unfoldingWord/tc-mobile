/**
 * The phone check's DSP benchmark (#1433, step 1).
 *
 * #1433 plans a loudness chain that runs on Finished, in the MP3 worker:
 * rumble high-pass, gated loudness measurement, one static gain, a true-peak
 * limiter. Its cost on a low-end phone is an estimate nobody has measured,
 * and step 1 exists to measure it.
 *
 * Since #1568 this times the production chain itself, `lib/audio/loudness.ts`
 * — the same `LoudnessMeter` and `LoudnessNormalizer` the Finished step will
 * run — in two streaming passes over about one-second chunks, never the whole
 * take in memory at once. No filter lives here; this file only feeds chunks,
 * reads the injected clock between the chain's stages, and hashes the output.
 *
 * It is still a load profile, not a conformance test: the target and ceiling
 * are the plan's proposals, which are still open for the requirements owner.
 *
 * Pure arithmetic: no DOM, Web Audio or Worker globals, and no clock of its
 * own — every time comes from the injected `now`. Only a phone can say how
 * fast it is.
 */

import {
  LoudnessMeter,
  LoudnessNormalizer,
  normalizationGainDb,
  type LoudnessLap,
} from "@/lib/audio/loudness";
import type { DspBenchResult } from "@/types/audio";

export interface DspBenchOptions {
  /** Mono 16-bit PCM. Held by the caller, standing in for chunks read from storage. */
  readonly input: Int16Array;
  readonly sampleRate: number;
  /** Chunk length in seconds; the plan's "about one second" by default. */
  readonly chunkSeconds?: number;
  /** The only clock the kernel reads, in milliseconds. */
  readonly now: () => number;
  /** Called after every chunk of either pass, for the worker's heartbeat. */
  readonly onChunk?: (pass: 1 | 2, done: number, total: number) => void;
  /** Receives each processed chunk of the apply pass, in order. Reused buffer. */
  readonly sink?: (chunk: Float32Array) => void;
  readonly targetLufs?: number;
  readonly ceilingDbtp?: number;
  readonly maxGainDb?: number;
}

/** FNV-style rolling hash over the float32 bit patterns of the output. */
function hashInto(hash: number, bits: Uint32Array, n: number): number {
  let h = hash;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ (bits[i] ?? 0), 16_777_619);
  return h >>> 0;
}

/**
 * Runs the benchmark chain over `input` and reports what it cost.
 *
 * The MP3 worker's `dsp-bench` request calls this (`hooks/mp3.worker.ts`).
 */
export function runDspBench(options: DspBenchOptions): DspBenchResult {
  const { input, sampleRate, now, onChunk, sink } = options;
  const chunkLength = Math.max(
    1,
    Math.round((options.chunkSeconds ?? 1) * sampleRate)
  );
  const total = input.length;
  const chunks = Math.ceil(total / chunkLength);

  const work = new Float32Array(chunkLength);
  const bits = new Uint32Array(work.buffer);
  const load = (from: number, n: number) => {
    for (let i = 0; i < n; i++) work[i] = (input[from + i] ?? 0) / 32768;
  };
  const stage = { highPass: 0, kWeight: 0, truePeak: 0, gain: 0, limiter: 0 };
  let slowest = 0;
  // Each lap charges the time since the previous mark to the stage just done.
  let mark = 0;
  const lap: LoudnessLap = (name) => {
    const t = now();
    stage[name] += t - mark;
    mark = t;
  };

  // Pass 1 — measure: high-pass, K-weight + gated loudness, true peak. The
  // chunk's load is charged to the high-pass, as it is in pass 2.
  const measureStart = now();
  const meter = new LoudnessMeter(sampleRate, chunkLength);
  for (let c = 0; c < chunks; c++) {
    const from = c * chunkLength;
    const n = Math.min(chunkLength, total - from);
    const t0 = now();
    mark = t0;
    load(from, n);
    meter.push(work, n, lap);
    slowest = Math.max(slowest, mark - t0);
    onChunk?.(1, c + 1, chunks);
  }
  const { integratedLufs, truePeakDbtp } = meter.finish();
  const gainDb = normalizationGainDb(
    integratedLufs,
    options.targetLufs,
    options.maxGainDb
  );
  const measureMs = now() - measureStart;

  // Pass 2 — apply: high-pass, static gain, lookahead limiter.
  const applyStart = now();
  const normalizer = new LoudnessNormalizer({
    sampleRate,
    gainDb,
    ceilingDbtp: options.ceilingDbtp,
  });
  let checksum = 0x811c9dc5;
  const emit = (n: number) => {
    if (n === 0) return;
    checksum = hashInto(checksum, bits, n);
    sink?.(work.subarray(0, n));
  };
  for (let c = 0; c < chunks; c++) {
    const from = c * chunkLength;
    const n = Math.min(chunkLength, total - from);
    const t0 = now();
    mark = t0;
    load(from, n);
    emit(normalizer.process(work, n, lap));
    slowest = Math.max(slowest, mark - t0);
    onChunk?.(2, c + 1, chunks);
  }
  // Flush the limiter's latency to emit the tail.
  mark = now();
  for (
    let n = normalizer.flush(work, lap);
    n > 0;
    n = normalizer.flush(work, lap)
  )
    emit(n);
  const applyMs = now() - applyStart;

  return {
    audioSeconds: total / sampleRate,
    chunks,
    measureMs,
    applyMs,
    stageMs: stage,
    slowestChunkMs: slowest,
    workingSetBytes:
      work.byteLength + meter.workingSetBytes + normalizer.workingSetBytes,
    checksum,
    loudnessLufs: integratedLufs,
    truePeakDbtp,
    gainDb,
    limiterMaxReductionDb: normalizer.limiterMaxReductionDb,
  };
}
