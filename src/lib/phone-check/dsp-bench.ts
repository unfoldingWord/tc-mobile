/**
 * The phone check's DSP benchmark kernel (#1433, step 1, task T1).
 *
 * #1433 plans a loudness chain that runs on Finished, in the MP3 worker:
 * rumble high-pass, loudness measurement, one static gain, a true-peak
 * limiter. Its cost on a low-end phone is an estimate nobody has measured, and
 * step 1 exists to measure it. This module is the work that gets timed: the
 * planned chain, in the planned order and in the planned shape — two streaming
 * passes over about one-second chunks, state carried across chunk boundaries,
 * never the whole take in memory at once.
 *
 * It is a LOAD PROFILE, not the chain step 2 will ship. It does not claim
 * ITU-R BS.1770 conformance: the loudness it measures is ungated (no 400 ms
 * blocks, no absolute or relative gate), and the target and ceiling are the
 * plan's proposals, which are still open for the requirements owner.
 *
 * Written fresh from published specifications; no file is ported from
 * anywhere, so this file carries no separate licence notice:
 *
 * - ITU-R BS.1770-4, "Algorithms to measure audio programme loudness and
 *   true-peak audio level". K-weighting (§2.1, Tables 1 and 2) as its two
 *   stages — a high shelf and the RLB high-pass — and the loudness formula
 *   L = -0.691 + 10 log10(mean square). The Recommendation prints the
 *   filters for 48 kHz only; here each stage is redesigned for the actual
 *   rate by the bilinear transform of an analog prototype whose corner, Q and
 *   gain are fitted to that 48 kHz table, so 44.1 kHz needs no resample.
 *   `tests/dsp-bench.test.ts` checks the result against the table's own
 *   response at 48 kHz.
 * - BS.1770-4 Annex 2, true-peak: 4x oversampling through a 48-tap
 *   interpolator, then the largest absolute value. The interpolator here is
 *   a Blackman-windowed sinc of that length (12 taps per phase), designed in
 *   code; it is not the Annex's example coefficient table.
 * - R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter
 *   coefficients": the 80 Hz high-pass, a second-order Butterworth (Q = 1/√2).
 * - The limiter is a textbook lookahead design: per-sample gain requirement
 *   from the true-peak detector, a sliding minimum over the lookahead, a box
 *   average of the same length (which keeps every sample at or under the
 *   ceiling), and a one-pole release.
 *
 * Pure arithmetic over typed arrays: no DOM, Web Audio or Worker globals, and
 * no clock of its own — every time comes from the injected `now`, so Node can
 * pin the shape and only a phone can say how fast it is.
 */

/** BS.1770's loudness offset, in dB. */
const LOUDNESS_OFFSET_DB = -0.691;

/** The rumble high-pass corner from the #1433 plan ("about 80 Hz"). */
const HIGH_PASS_HZ = 80;

/** The plan's proposed defaults, open for the requirements owner. */
const DEFAULT_TARGET_LUFS = -19;
const DEFAULT_CEILING_DBTP = -1.5;
/** The most a quiet take is raised, so near-silence is not amplified into hiss. */
const DEFAULT_MAX_GAIN_DB = 20;

const LIMITER_LOOKAHEAD_SECONDS = 0.005;
const LIMITER_RELEASE_SECONDS = 0.05;

const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 12;
/**
 * The detector's output at input index n describes the stretch around index
 * n - 6 (the interpolator's group delay is 23.5 oversampled steps, about 5.9
 * input samples), so the limiter reads it this many samples late.
 */
const DETECTOR_DELAY = 6;

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

interface DspStageMs {
  /** Both passes' high-pass, including the Int16 to float conversion. */
  readonly highPass: number;
  /** K-weighting and the mean-square sum (measuring pass). */
  readonly kWeight: number;
  /** The true-peak measurement (measuring pass). */
  readonly truePeak: number;
  /** The static gain (apply pass). */
  readonly gain: number;
  /** The limiter, its detector and its flush (apply pass). */
  readonly limiter: number;
}

export interface DspBenchResult {
  readonly audioSeconds: number;
  /** Chunks per pass. */
  readonly chunks: number;
  readonly measureMs: number;
  readonly applyMs: number;
  readonly stageMs: DspStageMs;
  readonly slowestChunkMs: number;
  /**
   * Bytes of every buffer the kernel allocates, counted as it allocates them.
   * Analytic: the kernel's own buffers, not a measured process peak.
   */
  readonly workingSetBytes: number;
  /** A hash of the apply pass's output, so an engine cannot skip the work. */
  readonly checksum: number;
  /** Ungated K-weighted loudness, or null for silence. */
  readonly loudnessLufs: number | null;
  /** True peak of the high-passed input, or null for silence. */
  readonly truePeakDbtp: number | null;
  readonly gainDb: number;
  readonly limiterMaxReductionDb: number;
}

/** Counts the bytes of every typed array the kernel allocates. */
class Arena {
  bytes = 0;
  f32(n: number): Float32Array {
    this.bytes += n * Float32Array.BYTES_PER_ELEMENT;
    return new Float32Array(n);
  }
  f64(n: number): Float64Array {
    this.bytes += n * Float64Array.BYTES_PER_ELEMENT;
    return new Float64Array(n);
  }
  i32(n: number): Int32Array {
    this.bytes += n * Int32Array.BYTES_PER_ELEMENT;
    return new Int32Array(n);
  }
}

interface Coefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** A biquad in transposed direct form II; float64 state persists across chunks. */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(private readonly c: Coefficients) {}
  process(x: Float32Array, n: number): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < n; i++) {
      const v = x[i] ?? 0;
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

/** Bristow-Johnson cookbook high-pass. */
function highPass(
  cornerHz: number,
  q: number,
  sampleRate: number
): Coefficients {
  const w = (2 * Math.PI * cornerHz) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** BS.1770 stage 1, the high shelf, from its fitted analog prototype. */
function kShelf(sampleRate: number): Coefficients {
  const gainDb = 3.99984385397;
  const q = 0.7071752369554193;
  const k = Math.tan((Math.PI * 1681.9744509555319) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** BS.1770 stage 2, the RLB high-pass, from its fitted analog prototype. */
function kHighPass(sampleRate: number): Coefficients {
  const q = 0.5003270373253953;
  const k = Math.tan((Math.PI * 38.13547087613982) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** The 4x interpolator's taps, phase-major: TAPS[p * TAPS_PER_PHASE + j]. */
function interpolatorTaps(arena: Arena): Float64Array {
  const length = OVERSAMPLE * TAPS_PER_PHASE;
  const centre = (length - 1) / 2;
  const taps = arena.f64(length);
  for (let k = 0; k < length; k++) {
    const t = (k - centre) / OVERSAMPLE;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const window =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * k) / (length - 1)) +
      0.08 * Math.cos((4 * Math.PI * k) / (length - 1));
    const p = k % OVERSAMPLE;
    const j = (k - p) / OVERSAMPLE;
    taps[p * TAPS_PER_PHASE + j] = sinc * window;
  }
  // Each phase sums to 1, so a constant reads as itself at every phase.
  for (let p = 0; p < OVERSAMPLE; p++) {
    let sum = 0;
    for (let j = 0; j < TAPS_PER_PHASE; j++)
      sum += taps[p * TAPS_PER_PHASE + j] ?? 0;
    for (let j = 0; j < TAPS_PER_PHASE; j++) {
      const at = p * TAPS_PER_PHASE + j;
      taps[at] = (taps[at] ?? 0) / sum;
    }
  }
  return taps;
}

/**
 * Streaming 4x true-peak detector. `step(x)` takes the next input sample and
 * returns the largest absolute value among the four interpolated points it
 * completes and the sample DETECTOR_DELAY back, so the reading covers the
 * stretch on both sides of that sample.
 */
class TruePeakDetector {
  private readonly history: Float64Array;
  private at = 0;
  constructor(
    arena: Arena,
    private readonly taps: Float64Array
  ) {
    this.history = arena.f64(TAPS_PER_PHASE);
  }
  step(x: number): number {
    const h = this.history;
    this.at = (this.at + 1) % TAPS_PER_PHASE;
    h[this.at] = x;
    let peak = 0;
    for (let p = 0; p < OVERSAMPLE; p++) {
      let y = 0;
      let idx = this.at;
      const base = p * TAPS_PER_PHASE;
      for (let j = 0; j < TAPS_PER_PHASE; j++) {
        y += (this.taps[base + j] ?? 0) * (h[idx] ?? 0);
        idx = idx === 0 ? TAPS_PER_PHASE - 1 : idx - 1;
      }
      const a = Math.abs(y);
      if (a > peak) peak = a;
    }
    const back =
      h[(this.at - DETECTOR_DELAY + TAPS_PER_PHASE) % TAPS_PER_PHASE] ?? 0;
    return Math.max(peak, Math.abs(back));
  }
}

/**
 * Lookahead limiter. Every structure is a ring of fixed length, so its memory
 * does not grow with the take. Output lags input by `latency` samples; the
 * caller trims that from the front and `flush` emits the tail.
 */
class Limiter {
  readonly latency: number;
  maxReduction = 1;
  private readonly lookahead: number;
  private readonly ceiling: number;
  private readonly release: number;
  private readonly detector: TruePeakDetector;
  // Sliding-minimum deque of gain requirements: values and their indices.
  private readonly dqValue: Float64Array;
  private readonly dqIndex: Int32Array;
  private dqHead = 0;
  private dqSize = 0;
  // Box average over the held minimum.
  private readonly box: Float64Array;
  private boxAt = 0;
  private boxSum: number;
  // The delayed audio.
  private readonly delay: Float32Array;
  private delayAt = 0;
  private gain = 1;
  private index = 0;

  constructor(
    arena: Arena,
    taps: Float64Array,
    sampleRate: number,
    ceilingDbtp: number
  ) {
    this.lookahead = Math.max(
      1,
      Math.round(LIMITER_LOOKAHEAD_SECONDS * sampleRate)
    );
    this.latency = this.lookahead - 1 + DETECTOR_DELAY;
    this.ceiling = 10 ** (ceilingDbtp / 20);
    this.release = 1 - Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
    this.detector = new TruePeakDetector(arena, taps);
    this.dqValue = arena.f64(this.lookahead);
    this.dqIndex = arena.i32(this.lookahead);
    this.box = arena.f64(this.lookahead).fill(1);
    this.boxSum = this.lookahead;
    this.delay = arena.f32(this.latency + 1);
  }

  /** Limits `x[0..n)` in place, `latency` samples late. */
  process(x: Float32Array, n: number): void {
    const L = this.lookahead;
    for (let i = 0; i < n; i++) {
      const v = x[i] ?? 0;
      const level = this.detector.step(v);
      const need = level > this.ceiling ? this.ceiling / level : 1;
      // Sliding minimum over the last L requirements: drop the one that
      // left the window first, so the ring never holds more than L.
      const k = this.index++;
      if (this.dqSize > 0 && (this.dqIndex[this.dqHead] ?? 0) <= k - L) {
        this.dqHead = (this.dqHead + 1) % L;
        this.dqSize -= 1;
      }
      while (this.dqSize > 0) {
        const tail = (this.dqHead + this.dqSize - 1) % L;
        if ((this.dqValue[tail] ?? 1) < need) break;
        this.dqSize -= 1;
      }
      const slot = (this.dqHead + this.dqSize) % L;
      this.dqValue[slot] = need;
      this.dqIndex[slot] = k;
      this.dqSize += 1;
      const held = this.dqValue[this.dqHead] ?? 1;
      // Box average of the held minimum: reaches the requirement by the time
      // the sample that set it leaves the delay line.
      this.boxSum += held - (this.box[this.boxAt] ?? 1);
      this.box[this.boxAt] = held;
      this.boxAt = (this.boxAt + 1) % L;
      const target = Math.min(1, this.boxSum / L);
      // Attack follows the box; release rises with a one-pole.
      this.gain =
        target < this.gain
          ? target
          : this.gain + (target - this.gain) * this.release;
      if (this.gain < this.maxReduction) this.maxReduction = this.gain;
      // Delay line: write the new sample, read the one `latency` back.
      const size = this.latency + 1;
      this.delay[this.delayAt] = v;
      const out = this.delay[(this.delayAt + 1) % size] ?? 0;
      this.delayAt = (this.delayAt + 1) % size;
      x[i] = out * this.gain;
    }
  }
}

/** FNV-style rolling hash over the float32 bit patterns of the output. */
function hashInto(hash: number, bits: Uint32Array, n: number): number {
  let h = hash;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ (bits[i] ?? 0), 16_777_619);
  return h >>> 0;
}

function toFloat(
  input: Int16Array,
  from: number,
  out: Float32Array,
  n: number
): void {
  for (let i = 0; i < n; i++) out[i] = (input[from + i] ?? 0) / 32768;
}

const toDb = (ratio: number) => 20 * Math.log10(ratio);

/**
 * Runs the benchmark chain over `input` and reports what it cost.
 *
 * @pivotpending #1433 T2 — the MP3 worker's `dsp-bench` request calls this;
 * until it lands, only `tests/dsp-bench.test.ts` does.
 */
export function runDspBench(options: DspBenchOptions): DspBenchResult {
  const { input, sampleRate, now, onChunk, sink } = options;
  const targetLufs = options.targetLufs ?? DEFAULT_TARGET_LUFS;
  const ceilingDbtp = options.ceilingDbtp ?? DEFAULT_CEILING_DBTP;
  const maxGainDb = options.maxGainDb ?? DEFAULT_MAX_GAIN_DB;
  const chunkLength = Math.max(
    1,
    Math.round((options.chunkSeconds ?? 1) * sampleRate)
  );
  const total = input.length;
  const chunks = Math.ceil(total / chunkLength);

  const arena = new Arena();
  const work = arena.f32(chunkLength);
  const bits = new Uint32Array(work.buffer);
  const taps = interpolatorTaps(arena);
  const stage = { highPass: 0, kWeight: 0, truePeak: 0, gain: 0, limiter: 0 };
  let slowest = 0;

  // Pass 1 — measure: high-pass, K-weight + mean square, true peak.
  const measureStart = now();
  const hp1 = new Biquad(highPass(HIGH_PASS_HZ, Math.SQRT1_2, sampleRate));
  const shelf = new Biquad(kShelf(sampleRate));
  const rlb = new Biquad(kHighPass(sampleRate));
  const meter = new TruePeakDetector(arena, taps);
  const weighted = arena.f32(chunkLength);
  let sumSquares = 0;
  let truePeak = 0;
  for (let c = 0; c < chunks; c++) {
    const from = c * chunkLength;
    const n = Math.min(chunkLength, total - from);
    const t0 = now();
    toFloat(input, from, work, n);
    hp1.process(work, n);
    const t1 = now();
    weighted.set(work.subarray(0, n));
    shelf.process(weighted, n);
    rlb.process(weighted, n);
    for (let i = 0; i < n; i++) {
      const v = weighted[i] ?? 0;
      sumSquares += v * v;
    }
    const t2 = now();
    for (let i = 0; i < n; i++) {
      const p = meter.step(work[i] ?? 0);
      if (p > truePeak) truePeak = p;
    }
    const t3 = now();
    stage.highPass += t1 - t0;
    stage.kWeight += t2 - t1;
    stage.truePeak += t3 - t2;
    slowest = Math.max(slowest, t3 - t0);
    onChunk?.(1, c + 1, chunks);
  }
  // Flush the detector's history so a peak in the last samples is read.
  for (let i = 0; i < TAPS_PER_PHASE; i++) {
    const p = meter.step(0);
    if (p > truePeak) truePeak = p;
  }
  const loudnessLufs =
    sumSquares > 0
      ? LOUDNESS_OFFSET_DB + 10 * Math.log10(sumSquares / total)
      : null;
  const gainDb =
    loudnessLufs === null ? 0 : Math.min(maxGainDb, targetLufs - loudnessLufs);
  const gain = 10 ** (gainDb / 20);
  const measureMs = now() - measureStart;

  // Pass 2 — apply: high-pass, static gain, lookahead limiter.
  const applyStart = now();
  const hp2 = new Biquad(highPass(HIGH_PASS_HZ, Math.SQRT1_2, sampleRate));
  const limiter = new Limiter(arena, taps, sampleRate, ceilingDbtp);
  let toTrim = limiter.latency;
  let checksum = 0x811c9dc5;
  const emit = (n: number) => {
    const skip = Math.min(toTrim, n);
    toTrim -= skip;
    if (skip === n) return;
    // Move the kept samples to the front so the hash and sink see them in order.
    if (skip > 0) work.copyWithin(0, skip, n);
    checksum = hashInto(checksum, bits, n - skip);
    sink?.(work.subarray(0, n - skip));
  };
  for (let c = 0; c < chunks; c++) {
    const from = c * chunkLength;
    const n = Math.min(chunkLength, total - from);
    const t0 = now();
    toFloat(input, from, work, n);
    hp2.process(work, n);
    const t1 = now();
    for (let i = 0; i < n; i++) work[i] = (work[i] ?? 0) * gain;
    const t2 = now();
    limiter.process(work, n);
    emit(n);
    const t3 = now();
    stage.highPass += t1 - t0;
    stage.gain += t2 - t1;
    stage.limiter += t3 - t2;
    slowest = Math.max(slowest, t3 - t0);
    onChunk?.(2, c + 1, chunks);
  }
  // Flush: push the latency's worth of silence through to emit the tail.
  const t0 = now();
  let tail = limiter.latency;
  while (tail > 0) {
    const n = Math.min(tail, chunkLength);
    work.fill(0, 0, n);
    limiter.process(work, n);
    emit(n);
    tail -= n;
  }
  stage.limiter += now() - t0;
  const applyMs = now() - applyStart;

  return {
    audioSeconds: total / sampleRate,
    chunks,
    measureMs,
    applyMs,
    stageMs: stage,
    slowestChunkMs: slowest,
    workingSetBytes: arena.bytes,
    checksum,
    loudnessLufs,
    truePeakDbtp: truePeak > 0 ? toDb(truePeak) : null,
    gainDb,
    limiterMaxReductionDb: -toDb(limiter.maxReduction),
  };
}
