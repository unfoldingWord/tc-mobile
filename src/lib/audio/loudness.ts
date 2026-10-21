/**
 * The loudness chain for normalize-on-Finished (#1433 step 2, #1568).
 *
 * Two streaming passes over a take, in about one-second chunks, never the
 * whole take in memory:
 *
 * 1. {@link LoudnessMeter} — rumble high-pass at 80 Hz, then gated
 *    integrated loudness (ITU-R BS.1770) and true peak of the high-passed
 *    signal.
 * 2. {@link normalizationGainDb} turns that loudness into one static gain,
 *    capped so a near-silent take is not raised into hiss.
 * 3. {@link LoudnessNormalizer} — the same high-pass, the static gain, then a
 *    lookahead true-peak limiter. Its output is the evened-out audio.
 *
 * Filter and limiter state carries across chunk boundaries, so any chunking
 * of the same take gives byte-identical output. The phone check's benchmark
 * (`lib/phone-check/dsp-bench.ts`) times these classes, not a copy of them.
 *
 * Not wired into transcode yet: that is the next #1433 step. The target and
 * the ceiling are parameters whose defaults are the plan's proposals
 * (-19 LUFS, -1.5 dBTP), still open for the requirements owner.
 *
 * Written fresh from published specifications; no file is ported from
 * anywhere, so this file carries no separate licence notice:
 *
 * - ITU-R BS.1770-4, "Algorithms to measure audio programme loudness and
 *   true-peak audio level".
 *   - K-weighting (§2.1, Tables 1 and 2) as its two stages, a high shelf and
 *     the RLB high-pass. The Recommendation prints the filters for 48 kHz
 *     only; each stage here is redesigned for the actual rate by the bilinear
 *     transform of an analog prototype whose corner, Q and gain are fitted to
 *     that 48 kHz table, so 44.1 kHz needs no resample.
 *   - Gating (§2.2-2.8): 400 ms blocks overlapping by 75 % (a new block every
 *     100 ms), block loudness l = -0.691 + 10 log10(mean square), an
 *     absolute gate at -70 LKFS, then a relative gate 10 LU under the
 *     loudness of the blocks that passed the absolute gate. A block passes a
 *     gate when its loudness is strictly above it. A trailing part block is
 *     not measured.
 *   - True peak (Annex 2): 4x oversampling through a 48-tap interpolator,
 *     then the largest absolute value. The interpolator here is a
 *     Blackman-windowed sinc of that length (12 taps per phase), designed in
 *     code; it is not the Annex's example coefficient table.
 * - R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter
 *   coefficients": the 80 Hz high-pass, a second-order Butterworth (Q = 1/√2).
 * - The limiter is a textbook lookahead design: per-sample gain requirement
 *   from the true-peak detector, a sliding minimum over the lookahead, a box
 *   average of the same length (which keeps every sample at or under the
 *   ceiling), and a one-pole release.
 *
 * One approximation, so memory stays fixed however long the take: the
 * relative gate reads block loudness from a histogram of 0.01 LU bins, each
 * holding the exact energy sum and count of its blocks. Only blocks within
 * one bin of the relative gate can land on the wrong side of it; every other
 * block is gated exactly.
 *
 * Pure arithmetic: no DOM, Web Audio or Worker globals, and no clock.
 */

/** BS.1770's loudness offset, in dB. */
const LOUDNESS_OFFSET_DB = -0.691;
/** The rumble high-pass corner from the #1433 plan ("about 80 Hz"). */
const HIGH_PASS_HZ = 80;

/** BS.1770 gating. */
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const SUB_BLOCK_SECONDS = 0.1;
const SUB_BLOCKS_PER_BLOCK = 4;
/** The histogram the relative gate reads: 0.01 LU bins from the absolute gate up. */
const BIN_LU = 0.01;
const HISTOGRAM_TOP_LUFS = 10;

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

/** The stages a chunk passes through, in the names the phone check reports. */
type LoudnessStage = "highPass" | "kWeight" | "truePeak" | "gain" | "limiter";

/**
 * Called once a chunk has been through `stage`, so a benchmark can time each
 * stage with its own clock. The chain reads no clock itself.
 */
export type LoudnessLap = (stage: LoudnessStage) => void;

/** Counts the bytes of every typed array a class allocates. */
class Arena {
  bytes = 0;
  f32 = (n: number) => this.count(new Float32Array(n));
  f64 = (n: number) => this.count(new Float64Array(n));
  i32 = (n: number) => this.count(new Int32Array(n));
  u32 = (n: number) => this.count(new Uint32Array(n));
  private count<T extends ArrayBufferView>(array: T): T {
    this.bytes += array.byteLength;
    return array;
  }
}

type Coefficients = Readonly<Record<"b0" | "b1" | "b2" | "a1" | "a2", number>>;

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
      const v = x[i]!;
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

/** The 80 Hz rumble high-pass: a Bristow-Johnson cookbook Butterworth. */
function rumbleHighPass(sampleRate: number): Biquad {
  const w = (2 * Math.PI * HIGH_PASS_HZ) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return new Biquad({
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  });
}

/** BS.1770 stage 1, the high shelf, from its fitted analog prototype. */
function kShelf(sampleRate: number): Biquad {
  const gainDb = 3.99984385397;
  const q = 0.7071752369554193;
  const k = Math.tan((Math.PI * 1681.9744509555319) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return new Biquad({
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  });
}

/** BS.1770 stage 2, the RLB high-pass, from its fitted analog prototype. */
function kHighPass(sampleRate: number): Biquad {
  const q = 0.5003270373253953;
  const k = Math.tan((Math.PI * 38.13547087613982) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return new Biquad({
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  });
}

/** The 4x interpolator's taps, phase-major: TAPS[p * TAPS_PER_PHASE + j]. */
function interpolatorTaps(arena: Arena): Float64Array {
  const length = OVERSAMPLE * TAPS_PER_PHASE;
  const centre = (length - 1) / 2;
  const taps = arena.f64(length);
  for (let k = 0; k < length; k++) {
    const t = (k - centre) / OVERSAMPLE;
    // The tap count is even, so t is never 0 and the sinc needs no special case.
    const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
    const taper =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * k) / (length - 1)) +
      0.08 * Math.cos((4 * Math.PI * k) / (length - 1));
    const p = k % OVERSAMPLE;
    const j = (k - p) / OVERSAMPLE;
    taps[p * TAPS_PER_PHASE + j] = sinc * taper;
  }
  // Each phase sums to 1, so a constant reads as itself at every phase.
  for (let p = 0; p < OVERSAMPLE; p++) {
    const phase = taps.subarray(p * TAPS_PER_PHASE, (p + 1) * TAPS_PER_PHASE);
    const sum = phase.reduce((a, b) => a + b, 0);
    for (let j = 0; j < TAPS_PER_PHASE; j++) phase[j] = phase[j]! / sum;
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
  private readonly taps: Float64Array;
  private readonly history: Float64Array;
  private at = 0;
  constructor(arena: Arena) {
    this.taps = interpolatorTaps(arena);
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
        y += this.taps[base + j]! * h[idx]!;
        idx = idx === 0 ? TAPS_PER_PHASE - 1 : idx - 1;
      }
      const a = Math.abs(y);
      if (a > peak) peak = a;
    }
    const back =
      h[(this.at - DETECTOR_DELAY + TAPS_PER_PHASE) % TAPS_PER_PHASE]!;
    return Math.max(peak, Math.abs(back));
  }
}

/**
 * BS.1770 gated integrated loudness, streamed. Energy is summed per 100 ms
 * sub-block; every completed sub-block after the third closes a 400 ms block
 * (the last four sub-blocks), which is gated absolutely on the spot and
 * binned for the relative gate.
 */
class GatedLoudness {
  private readonly subLength: number;
  private readonly subs: Float64Array;
  private subAt = 0;
  private subsSeen = 0;
  private sum = 0;
  private count = 0;
  private readonly binEnergy: Float64Array;
  private readonly binBlocks: Uint32Array;
  private gatedEnergy = 0;
  private gatedBlocks = 0;

  constructor(arena: Arena, sampleRate: number) {
    this.subLength = Math.max(1, Math.round(SUB_BLOCK_SECONDS * sampleRate));
    this.subs = arena.f64(SUB_BLOCKS_PER_BLOCK);
    const bins = Math.ceil((HISTOGRAM_TOP_LUFS - ABSOLUTE_GATE_LUFS) / BIN_LU);
    this.binEnergy = arena.f64(bins);
    this.binBlocks = arena.u32(bins);
  }

  /** Adds the K-weighted samples `w[0..n)`. */
  add(w: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const v = w[i]!;
      this.sum += v * v;
      if (++this.count === this.subLength) this.closeSubBlock();
    }
  }

  private closeSubBlock(): void {
    this.subs[this.subAt] = this.sum;
    this.subAt = (this.subAt + 1) % SUB_BLOCKS_PER_BLOCK;
    this.sum = 0;
    this.count = 0;
    if (++this.subsSeen < SUB_BLOCKS_PER_BLOCK) return;
    // Oldest to newest, so the block's sum never depends on where it started.
    let energy = 0;
    for (let s = 0; s < SUB_BLOCKS_PER_BLOCK; s++)
      energy += this.subs[(this.subAt + s) % SUB_BLOCKS_PER_BLOCK]!;
    const meanSquare = energy / (SUB_BLOCKS_PER_BLOCK * this.subLength);
    const blockLufs = LOUDNESS_OFFSET_DB + 10 * Math.log10(meanSquare);
    if (!(blockLufs > ABSOLUTE_GATE_LUFS)) return;
    const bin = Math.min(
      this.binBlocks.length - 1,
      Math.floor((blockLufs - ABSOLUTE_GATE_LUFS) / BIN_LU)
    );
    this.binEnergy[bin]! += meanSquare;
    this.binBlocks[bin]! += 1;
    this.gatedEnergy += meanSquare;
    this.gatedBlocks += 1;
  }

  /** Integrated loudness in LUFS, or null when no block passes the gates. */
  integrated(): number | null {
    if (this.gatedBlocks === 0) return null;
    const relativeGate =
      LOUDNESS_OFFSET_DB +
      10 * Math.log10(this.gatedEnergy / this.gatedBlocks) +
      RELATIVE_GATE_LU;
    const last = this.binBlocks.length - 1;
    let energy = 0;
    let blocks = 0;
    for (let b = 0; b <= last; b++) {
      // A bin passes when its centre is above the gate. The top bin also
      // holds every block louder than the histogram's range, so it always
      // passes: it holds the loudest block, which is never under the gate.
      const centre = ABSOLUTE_GATE_LUFS + (b + 0.5) * BIN_LU;
      if (b < last && !(centre > relativeGate)) continue;
      energy += this.binEnergy[b]!;
      blocks += this.binBlocks[b]!;
    }
    // Never empty: the bin holding the loudest block sits at or above the
    // absolute-gated mean, so more than 10 LU over the relative gate.
    return LOUDNESS_OFFSET_DB + 10 * Math.log10(energy / blocks);
  }
}

export interface LoudnessMeasurement {
  /** Gated integrated loudness of the high-passed take, or null if nothing passed the gates. */
  readonly integratedLufs: number | null;
  /** True peak of the high-passed take, or null for silence. */
  readonly truePeakDbtp: number | null;
}

const toDb = (ratio: number) => 20 * Math.log10(ratio);

/**
 * Pass 1. Feed every chunk of the take in order with {@link push}, then read
 * {@link finish} once.
 */
export class LoudnessMeter {
  /** Bytes of every buffer this meter allocated; fixed for any take length. */
  readonly workingSetBytes: number;
  private readonly highPass: Biquad;
  private readonly shelf: Biquad;
  private readonly rlb: Biquad;
  private readonly gate: GatedLoudness;
  private readonly peak: TruePeakDetector;
  private readonly weighted: Float32Array;
  private truePeak = 0;
  private result: LoudnessMeasurement | null = null;

  /** `maxChunk` is the longest chunk {@link push} will be given, in samples. */
  constructor(sampleRate: number, maxChunk: number) {
    const arena = new Arena();
    this.highPass = rumbleHighPass(sampleRate);
    this.shelf = kShelf(sampleRate);
    this.rlb = kHighPass(sampleRate);
    this.gate = new GatedLoudness(arena, sampleRate);
    this.peak = new TruePeakDetector(arena);
    this.weighted = arena.f32(maxChunk);
    this.workingSetBytes = arena.bytes;
  }

  /**
   * Measures `x[0..n)`, the next samples of the take, full scale ±1.
   * High-passes `x` in place; the caller's buffer holds no take after this.
   */
  push(x: Float32Array, n: number, lap?: LoudnessLap): void {
    if (this.result !== null)
      throw new Error("LoudnessMeter: already finished");
    if (n > this.weighted.length)
      throw new RangeError("LoudnessMeter: chunk longer than maxChunk");
    this.highPass.process(x, n);
    lap?.("highPass");
    const w = this.weighted;
    w.set(x.subarray(0, n));
    this.shelf.process(w, n);
    this.rlb.process(w, n);
    this.gate.add(w, n);
    lap?.("kWeight");
    let peak = this.truePeak;
    for (let i = 0; i < n; i++) {
      const p = this.peak.step(x[i]!);
      if (p > peak) peak = p;
    }
    this.truePeak = peak;
    lap?.("truePeak");
  }

  /** The measurement; flushes the true-peak detector on the first call. */
  finish(): LoudnessMeasurement {
    if (this.result !== null) return this.result;
    for (let i = 0; i < TAPS_PER_PHASE; i++)
      this.truePeak = Math.max(this.truePeak, this.peak.step(0));
    this.result = {
      integratedLufs: this.gate.integrated(),
      truePeakDbtp: this.truePeak > 0 ? toDb(this.truePeak) : null,
    };
    return this.result;
  }
}

/**
 * The one static gain that brings `integratedLufs` to `targetLufs`, raised by
 * at most `maxGainDb`. A take with no measured loudness gets 0 dB.
 */
export function normalizationGainDb(
  integratedLufs: number | null,
  targetLufs = DEFAULT_TARGET_LUFS,
  maxGainDb = DEFAULT_MAX_GAIN_DB
): number {
  if (integratedLufs === null) return 0;
  return Math.min(maxGainDb, targetLufs - integratedLufs);
}

/**
 * Lookahead limiter. Every structure is a ring of fixed length, so its memory
 * does not grow with the take. Output lags input by `latency` samples.
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

  constructor(arena: Arena, sampleRate: number, ceilingDbtp: number) {
    this.lookahead = Math.max(
      1,
      Math.round(LIMITER_LOOKAHEAD_SECONDS * sampleRate)
    );
    this.latency = this.lookahead - 1 + DETECTOR_DELAY;
    this.ceiling = 10 ** (ceilingDbtp / 20);
    this.release = 1 - Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
    this.detector = new TruePeakDetector(arena);
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
      const v = x[i]!;
      const level = this.detector.step(v);
      const need = level > this.ceiling ? this.ceiling / level : 1;
      // Sliding minimum over the last L requirements: evict the one that
      // fell out of range first, so the ring never holds more than L.
      const k = this.index++;
      if (this.dqSize > 0 && this.dqIndex[this.dqHead]! <= k - L) {
        this.dqHead = (this.dqHead + 1) % L;
        this.dqSize -= 1;
      }
      while (this.dqSize > 0) {
        const tail = (this.dqHead + this.dqSize - 1) % L;
        if (this.dqValue[tail]! < need) break;
        this.dqSize -= 1;
      }
      const slot = (this.dqHead + this.dqSize) % L;
      this.dqValue[slot] = need;
      this.dqIndex[slot] = k;
      this.dqSize += 1;
      const held = this.dqValue[this.dqHead]!;
      // Box average of the held minimum: reaches the requirement by the time
      // the sample that set it leaves the delay line.
      this.boxSum += held - this.box[this.boxAt]!;
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
      const out = this.delay[(this.delayAt + 1) % size]!;
      this.delayAt = (this.delayAt + 1) % size;
      x[i] = out * this.gain;
    }
  }
}

export interface LoudnessNormalizerOptions {
  readonly sampleRate: number;
  /** From {@link normalizationGainDb}. */
  readonly gainDb: number;
  /** The limiter's true-peak ceiling; the plan's -1.5 dBTP by default. */
  readonly ceilingDbtp?: number;
}

/**
 * Pass 2. Feed every chunk of the take in order with {@link process}, then
 * call {@link flush} until it returns 0. The output, joined, is exactly as
 * long as the input and aligned with it: the limiter's latency is trimmed
 * from the front and flushed from the tail here, not by the caller.
 */
export class LoudnessNormalizer {
  /** Bytes of every buffer this normalizer allocated; fixed for any take length. */
  readonly workingSetBytes: number;
  private readonly highPass: Biquad;
  private readonly gain: number;
  private readonly limiter: Limiter;
  private toTrim: number;
  private tail: number;

  constructor(options: LoudnessNormalizerOptions) {
    const arena = new Arena();
    this.highPass = rumbleHighPass(options.sampleRate);
    this.gain = 10 ** (options.gainDb / 20);
    this.limiter = new Limiter(
      arena,
      options.sampleRate,
      options.ceilingDbtp ?? DEFAULT_CEILING_DBTP
    );
    this.toTrim = this.limiter.latency;
    this.tail = this.limiter.latency;
    this.workingSetBytes = arena.bytes;
  }

  /** The deepest gain reduction the limiter has applied so far, in dB (≥ 0). */
  get limiterMaxReductionDb(): number {
    return toDb(1 / this.limiter.maxReduction);
  }

  /**
   * Processes `x[0..n)` in place and returns how many output samples now sit
   * at the front of `x`, in order. That is `n` once the limiter's latency
   * has been trimmed, fewer before.
   */
  process(x: Float32Array, n: number, lap?: LoudnessLap): number {
    this.highPass.process(x, n);
    lap?.("highPass");
    const g = this.gain;
    for (let i = 0; i < n; i++) x[i] = x[i]! * g;
    lap?.("gain");
    this.limiter.process(x, n);
    const kept = this.trim(x, n);
    lap?.("limiter");
    return kept;
  }

  /**
   * Writes the next part of the take's tail into `x` and returns how many
   * samples it wrote; 0 once the tail is out.
   */
  flush(x: Float32Array, lap?: LoudnessLap): number {
    const n = Math.min(this.tail, x.length);
    if (n === 0) return 0;
    this.tail -= n;
    x.fill(0, 0, n);
    this.limiter.process(x, n);
    const kept = this.trim(x, n);
    lap?.("limiter");
    return kept;
  }

  /** Drops the limiter's start-up latency from the front of `x[0..n)`. */
  private trim(x: Float32Array, n: number): number {
    const skip = Math.min(this.toTrim, n);
    this.toTrim -= skip;
    if (skip > 0 && skip < n) x.copyWithin(0, skip, n);
    return n - skip;
  }
}
