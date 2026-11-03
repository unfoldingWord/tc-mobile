/**
 * A gentle speech compressor, the optional stage of the Finished chain
 * (#1433). Not wired in yet: running it behind the Settings switch, which
 * starts off (the requirements owner's pick on #1433, 2026-11-02), is a
 * later change, and a listening check on a phone comes before it goes live.
 *
 * Ported from Seth Stoll's DSP research, with the DRI's permission on #1433
 * (2026-11-03). The settings in {@link SPEECH_COMPRESSOR} are that research's
 * speech settings; the tests hold them as fixtures. Licence of the port:
 *
 *   MIT License
 *
 *   Copyright (c) 2026 Seth Stoll
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *
 *   The above copyright notice and this permission notice shall be included
 *   in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 *   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 *   USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * How it works, per sample:
 *
 * 1. Detector: the sample's absolute value (sample peak), in dBFS. Speech
 *    does not need an oversampled true-peak detector here; the limiter after
 *    the static gain already reads true peak.
 * 2. Gain computer: a soft-knee curve. Below the knee nothing happens; above
 *    it, each dB over the threshold comes out as 1/ratio dB. Inside the knee
 *    (threshold ± knee/2) a quadratic joins the two, so there is no corner.
 * 3. Smoothing, on the gain reduction in dB, as the smooth decoupled peak
 *    detector of Giannoulis, Massberg and Reiss, "Digital Dynamic Range
 *    Compressor Design — A Tutorial and Analysis" (JAES, 2012): the wanted
 *    reduction is held as a peak that falls with the release time, and the
 *    applied reduction follows that peak with the attack time. Holding the
 *    peak is what lets a sample-peak detector settle on a steady tone instead
 *    of sagging between its crests.
 * 4. Program-dependent release: a second, slower envelope follows the wanted
 *    reduction and only builds up when reduction is sustained; the applied
 *    reduction is the larger of the two. A brief peak recovers at the release
 *    time; after a long loud stretch the slow envelope holds the gain back
 *    and recovery is gentler. The slow envelope's two times are this port's
 *    own tuning, not reference values.
 *
 * No makeup gain: the static loudness gain after this stage does that job,
 * so this stage only ever turns audio down.
 *
 * The state is four numbers that carry across chunks, and every sample sees
 * the same arithmetic wherever a chunk boundary falls, so any chunking of a
 * take gives identical output. No lookahead, so no latency and no flush.
 *
 * Pure arithmetic: no DOM, Web Audio or Worker globals, and no clock.
 */

export interface CompressorSettings {
  /** Where the knee is centred, in dBFS of the sample-peak detector. */
  readonly thresholdDb: number;
  /** dB in for each dB out, above the knee; 1 means no compression. */
  readonly ratio: number;
  /** Width of the soft knee in dB; 0 gives a hard knee. */
  readonly kneeDb: number;
  /** Time constant for gain reduction to rise. */
  readonly attackSeconds: number;
  /** Time constant for gain reduction to fall after a brief peak. */
  readonly releaseSeconds: number;
}

/**
 * The speech settings from Seth Stoll's research: 3:1 with a 6 dB soft knee,
 * a -25 dB threshold (the default when no speaker profile exists), 10 ms
 * attack and 120 ms release. The threshold is read here against the sample
 * peak in dBFS; whether that reading is the right level for speech is for
 * the listening check to say (inference, not measured).
 */
export const SPEECH_COMPRESSOR: CompressorSettings = {
  thresholdDb: -25,
  ratio: 3,
  kneeDb: 6,
  attackSeconds: 0.01,
  releaseSeconds: 0.12,
};

/** The slow envelope behind program-dependent release (this port's tuning). */
const SLOW_RISE_SECONDS = 0.3;
const SLOW_RELEASE_SECONDS = 0.6;

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`compressor: ${name} must be positive and finite`);
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value))
    throw new RangeError(`compressor: ${name} must be finite`);
}

/** One-pole smoothing coefficient for a time constant at `sampleRate`. */
const pole = (seconds: number, sampleRate: number) =>
  Math.exp(-1 / (seconds * sampleRate));

/**
 * Streams one take through the compressor. Feed every chunk in order with
 * {@link process}; output is in place, aligned with the input, with no
 * latency.
 */
export class SpeechCompressor {
  private readonly threshold: number;
  private readonly slope: number;
  private readonly knee: number;
  private readonly attack: number;
  private readonly release: number;
  private readonly slowRise: number;
  private readonly slowRelease: number;
  /** Gain reduction in dB (≥ 0), carried across chunks. */
  private held = 0;
  private fast = 0;
  private slow = 0;
  private deepest = 0;

  constructor(
    sampleRate: number,
    settings: CompressorSettings = SPEECH_COMPRESSOR
  ) {
    requirePositive("sampleRate", sampleRate);
    requireFinite("thresholdDb", settings.thresholdDb);
    requireFinite("kneeDb", settings.kneeDb);
    if (!(settings.ratio >= 1) || !Number.isFinite(settings.ratio))
      throw new RangeError("compressor: ratio must be at least 1 and finite");
    if (settings.kneeDb < 0)
      throw new RangeError("compressor: kneeDb must not be negative");
    requirePositive("attackSeconds", settings.attackSeconds);
    requirePositive("releaseSeconds", settings.releaseSeconds);
    this.threshold = settings.thresholdDb;
    this.slope = 1 / settings.ratio - 1;
    this.knee = settings.kneeDb;
    this.attack = pole(settings.attackSeconds, sampleRate);
    this.release = pole(settings.releaseSeconds, sampleRate);
    this.slowRise = pole(SLOW_RISE_SECONDS, sampleRate);
    this.slowRelease = pole(SLOW_RELEASE_SECONDS, sampleRate);
  }

  /** The deepest gain reduction applied so far, in dB (≥ 0). */
  get maxReductionDb(): number {
    return this.deepest;
  }

  /**
   * The static curve: how many dB a steady level of `levelDb` is turned down
   * once the envelopes have settled. Always ≥ 0.
   */
  reductionDb(levelDb: number): number {
    const over = levelDb - this.threshold;
    const half = this.knee / 2;
    if (over <= -half) return 0;
    if (over < half) {
      const into = over + half;
      return (-this.slope * into * into) / (2 * this.knee);
    }
    return -this.slope * over;
  }

  /**
   * Compresses `x[0..n)`, the next samples of the take, full scale ±1, in
   * place. Refuses a chunk holding a NaN or infinite sample before touching
   * it, since one would stick in the envelopes and ruin every later sample.
   */
  process(x: Float32Array, n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > x.length)
      throw new RangeError("compressor: n must be a whole count within x");
    for (let i = 0; i < n; i++)
      if (!Number.isFinite(x[i]!))
        throw new RangeError("compressor: chunk holds a non-finite sample");
    const { attack, release } = this;
    let held = this.held;
    let fast = this.fast;
    let slow = this.slow;
    let deepest = this.deepest;
    for (let i = 0; i < n; i++) {
      const v = x[i]!;
      const a = Math.abs(v);
      // A zero sample reads as -Infinity dB, which is under the knee: 0 dB.
      const want = this.reductionDb(20 * Math.log10(a));
      held = Math.max(want, release * held + (1 - release) * want);
      fast = attack * fast + (1 - attack) * held;
      const ks = want > slow ? this.slowRise : this.slowRelease;
      slow = ks * slow + (1 - ks) * want;
      const applied = fast > slow ? fast : slow;
      if (applied > deepest) deepest = applied;
      x[i] = v * 10 ** (-applied / 20);
    }
    this.held = held;
    this.fast = fast;
    this.slow = slow;
    this.deepest = deepest;
  }
}
