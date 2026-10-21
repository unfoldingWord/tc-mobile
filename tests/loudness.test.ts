import { describe, expect, it } from "vitest";

import {
  LoudnessMeter,
  LoudnessNormalizer,
  normalizationGainDb,
} from "@/lib/audio/loudness";
import { speechLikePcm } from "@/lib/phone-check/speech";

/**
 * #1568 (#1433 step 2) — the production loudness chain.
 *
 * Reference values are hand-computed from ITU-R BS.1770-4 itself, not from
 * a run of this code:
 *
 * - §2 / Annex 1: a 0 dBFS 1 kHz sine in one channel reads -3.01 LKFS, so a
 *   1 kHz sine with peak 0.1 (-20 dBFS) reads -23.01.
 * - §2.2-2.8: 400 ms blocks every 100 ms, block loudness
 *   -0.691 + 10 log10(mean square), an absolute gate at -70 LKFS and a
 *   relative gate 10 LU under the absolute-gated loudness. For a signal made
 *   of 1 kHz sections at known levels, every block's mean square is a known
 *   multiple of the -20 dBFS section's, so the gated result is
 *   -23.01 + 10 log10(mean of the passing blocks' multiples). The block
 *   tables are written out beside each test.
 *
 * Tolerance: ±0.1 LU. That figure is an ASSUMPTION carried from #1433's plan
 * ("to within 0.1 LU and 0.1 dB"), not a requirement the Recommendation sets
 * for a meter.
 */

const RATE = 44_100;
const TOLERANCE_LU = 0.1;

/** Concatenated 1 kHz sections, phase-continuous, full scale ±1. */
function sections(
  parts: ReadonlyArray<readonly [seconds: number, peak: number]>,
  sampleRate = RATE,
  hz = 1000
): Float32Array {
  const total = parts.reduce((n, [s]) => n + Math.round(s * sampleRate), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [seconds, peak] of parts) {
    const end = i + Math.round(seconds * sampleRate);
    for (; i < end; i++)
      out[i] = peak * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

const fromPcm = (pcm: Int16Array) => Float32Array.from(pcm, (v) => v / 32768);

/** Pass 1 over `input` in chunks of `chunk` samples. Leaves `input` untouched. */
function measure(input: Float32Array, sampleRate = RATE, chunk = sampleRate) {
  const meter = new LoudnessMeter(sampleRate, chunk);
  const work = new Float32Array(chunk);
  for (let from = 0; from < input.length; from += chunk) {
    const n = Math.min(chunk, input.length - from);
    work.set(input.subarray(from, from + n));
    meter.push(work, n);
  }
  return meter.finish();
}

/** Pass 2 over `input` in chunks of `chunk` samples; the joined output. */
function normalize(
  input: Float32Array,
  gainDb: number,
  chunk = RATE,
  ceilingDbtp?: number,
  flushSize = chunk
) {
  const normalizer = new LoudnessNormalizer({
    sampleRate: RATE,
    gainDb,
    ceilingDbtp,
  });
  const out = new Float32Array(input.length);
  let at = 0;
  const work = new Float32Array(chunk);
  for (let from = 0; from < input.length; from += chunk) {
    const n = Math.min(chunk, input.length - from);
    work.set(input.subarray(from, from + n));
    const kept = normalizer.process(work, n);
    out.set(work.subarray(0, kept), at);
    at += kept;
  }
  const tail = new Float32Array(flushSize);
  for (let kept = normalizer.flush(tail); kept > 0;) {
    out.set(tail.subarray(0, kept), at);
    at += kept;
    kept = normalizer.flush(tail);
  }
  return { out, written: at, normalizer };
}

/** -23.01 LUFS, BS.1770's reading of a -20 dBFS 1 kHz sine, plus `ratio` in dB. */
const referenceLufs = (ratio: number) => -23.01 + 10 * Math.log10(ratio);

describe("gated integrated loudness against hand-computed BS.1770 references", () => {
  it("reads a steady -20 dBFS 1 kHz sine as -23.01 LUFS at 48 and 44.1 kHz", () => {
    for (const rate of [48_000, 44_100]) {
      const m = measure(sections([[10, 0.1]], rate), rate);
      expect(m.integratedLufs).not.toBeNull();
      expect(Math.abs((m.integratedLufs ?? 0) - referenceLufs(1))).toBeLessThan(
        TOLERANCE_LU
      );
    }
  });

  it("applies both gates: loud 6 s, -20 dB quieter 6 s, then 108 s near silence", () => {
    // Sections, relative to the loud one's mean square (= 1):
    //   A  0-6 s     -20 dBFS  multiple 1
    //   M  6-12 s    -40 dBFS  multiple 0.01
    //   Q  12-120 s  -80 dBFS  multiple 0.000001
    // 100 ms sub-blocks 0..1199; 1197 blocks of four (j = 0..1196).
    //   57 blocks all A (j 0-56)                     1 each
    //   3 blocks A->M (j 57-59)  (3+.01)/4, (2+.02)/4, (1+.03)/4
    //                            = 0.7525, 0.505, 0.2575
    //   57 blocks all M (j 60-116)                   0.01 each
    //   3 blocks M->Q (j 117-119)                    ~0.0075, 0.005, 0.0025
    //   1077 blocks all Q                            ~1e-6: -83 LUFS, under
    //                                                the absolute gate
    // Absolute-gated mean = (57 + 1.515 + 0.57 + 0.015) / 120 = 0.4925,
    // so the relative gate sits at multiple 0.04925: A and A->M pass, M and
    // M->Q do not. Gated = (57 + 1.515) / 60.
    //
    // Without the relative gate the reading is referenceLufs(0.4925) = -26.09;
    // without the absolute gate the Q blocks drag the relative gate under M
    // and the reading is about -26.05. Each is ~3 LU off.
    const input = sections([
      [6, 0.1],
      [6, 0.01],
      [108, 0.0001],
    ]);
    const m = measure(input);
    expect(m.integratedLufs).not.toBeNull();
    expect(
      Math.abs((m.integratedLufs ?? 0) - referenceLufs(58.515 / 60))
    ).toBeLessThan(TOLERANCE_LU);
  });

  it("gates a tone followed by digital silence: the silent blocks do not count", () => {
    // A 0-5 s then silence to 20 s. Blocks: 47 all A, 3 A->silence at
    // 0.75, 0.5, 0.25 (all over the relative gate), the rest silent (-inf,
    // under the absolute gate). Gated = (47 + 1.5) / 50.
    const m = measure(
      sections([
        [5, 0.1],
        [15, 0],
      ])
    );
    expect(
      Math.abs((m.integratedLufs ?? 0) - referenceLufs(48.5 / 50))
    ).toBeLessThan(TOLERANCE_LU);
  });

  it("reads no loudness for silence or for a take shorter than one 400 ms block", () => {
    expect(measure(new Float32Array(RATE)).integratedLufs).toBeNull();
    expect(measure(sections([[0.39, 0.5]])).integratedLufs).toBeNull();
    expect(measure(sections([[0.4, 0.5]])).integratedLufs).not.toBeNull();
  });

  it("reads the true peak of a quarter-rate sine at 45 degrees (-6.02 dBTP), not its sample peak (-9.03)", () => {
    const n = 2 * RATE;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++)
      input[i] = 0.5 * Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const m = measure(input);
    expect(Math.abs((m.truePeakDbtp ?? 0) - -6.02)).toBeLessThan(0.1);
  });

  it("reads nothing at all for an empty take", () => {
    expect(measure(new Float32Array(0))).toEqual({
      integratedLufs: null,
      truePeakDbtp: null,
    });
  });

  it("reads no loudness for a take whose every block is under the absolute gate", () => {
    // -80 dBFS: every block reads about -83 LUFS, under -70. Not silence, so
    // the true peak is still read (the high-pass start-up adds a little).
    const m = measure(sections([[5, 0.0001]]));
    expect(m.integratedLufs).toBeNull();
    expect(m.truePeakDbtp).not.toBeNull();
    expect(m.truePeakDbtp ?? 0).toBeLessThan(-78);
  });

  it("reads a take louder than the histogram's range (+10 LUFS) at its own level", () => {
    // A float buffer may run over ±1, for example after a gain. Peak 100 is
    // +40 dBFS, so BS.1770 gives -3.01 + 40 = +36.99 LUFS, and its relative
    // gate (+26.99) sits above every bin but the open-ended top one.
    const m = measure(sections([[5, 100]]));
    expect(Math.abs((m.integratedLufs ?? 0) - 36.99)).toBeLessThan(
      TOLERANCE_LU
    );
  });

  it("reads a peak in the very last sample of the take", () => {
    const input = new Float32Array(1000);
    input[999] = 0.5;
    const m = measure(input);
    expect(m.truePeakDbtp).not.toBeNull();
    expect(m.truePeakDbtp ?? -Infinity).toBeGreaterThan(-6.5);
  });
});

describe("the capped static gain", () => {
  it("brings the loudness to the target, by default -19 LUFS", () => {
    expect(normalizationGainDb(-25)).toBeCloseTo(6, 12);
    expect(normalizationGainDb(-25, -23)).toBeCloseTo(2, 12);
  });

  it("raises a quiet take by at most the cap (20 dB by default) and never caps a cut", () => {
    expect(normalizationGainDb(-60)).toBe(20);
    expect(normalizationGainDb(-60, -19, 10)).toBe(10);
    expect(normalizationGainDb(-5)).toBeCloseTo(-14, 12);
  });

  it("applies no gain when nothing was measured", () => {
    expect(normalizationGainDb(null)).toBe(0);
  });
});

describe("the normalizer", () => {
  it("never lets a sample over the ceiling when the gain drives speech 12 dB past the target", () => {
    const input = fromPcm(speechLikePcm(20));
    const gainDb = normalizationGainDb(measure(input).integratedLufs, -19 + 12);
    expect(gainDb).toBeGreaterThan(12);
    for (const ceilingDbtp of [-1.5, -6]) {
      const { out, normalizer } = normalize(input, gainDb, RATE, ceilingDbtp);
      // The limiter did real work, so the ceiling below is not vacuous.
      expect(normalizer.limiterMaxReductionDb).toBeGreaterThan(3);
      let peak = 0;
      for (const v of out) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThanOrEqual(10 ** (ceilingDbtp / 20) * (1 + 1e-6));
    }
  });

  it("leaves the limiter idle on a take under the ceiling", () => {
    // A -20 dBFS tone with no gain is 18.5 dB under -1.5 dBTP.
    const { normalizer } = normalize(sections([[3, 0.1]]), 0);
    expect(normalizer.limiterMaxReductionDb).toBe(0);
  });

  it("gives byte-identical output for the whole buffer at once and for 1 s, 0.5 s and 37 ms chunks", () => {
    const input = fromPcm(speechLikePcm(10));
    const gainDb = normalizationGainDb(measure(input).integratedLufs, -10);
    const bytes = (chunk: number) =>
      new Uint8Array(normalize(input, gainDb, chunk).out.buffer);
    const whole = bytes(input.length);
    for (const seconds of [1, 0.5, 0.037]) {
      const chunked = bytes(Math.round(seconds * RATE));
      expect(Buffer.compare(chunked, whole)).toBe(0);
    }
  });

  it("measures the same loudness and peak for the whole buffer at once and for 37 ms chunks", () => {
    const input = fromPcm(speechLikePcm(10));
    expect(measure(input, RATE, Math.round(0.037 * RATE))).toEqual(
      measure(input, RATE, input.length)
    );
  });

  it.each(
    // The limiter's start-up latency at 44.1 kHz is 226 samples (a 221-sample
    // lookahead, less one, plus the detector's 6). Inputs and flush buffers
    // straddle it, because a flush buffer smaller than what the start-up
    // trim still has to drop is the boundary where "flush until 0" can stop
    // early.
    [0, 1, 10, 225, 226, 227, 500].flatMap((length) =>
      [1, 10, 225, 226, 227, 4096].map((flushSize) => [length, flushSize])
    )
  )(
    "flushes a %d-sample take completely through a %d-sample flush buffer",
    (length, flushSize) => {
      const input = fromPcm(speechLikePcm(1)).subarray(0, length);
      const reference = normalize(input, 6, 4096, undefined, 4096);
      const small = normalize(input, 6, 64, undefined, flushSize);
      expect(reference.written).toBe(length);
      expect(small.written).toBe(length);
      expect(
        Buffer.compare(
          new Uint8Array(small.out.buffer),
          new Uint8Array(reference.out.buffer)
        )
      ).toBe(0);
    }
  );

  it("emits exactly as many samples as it was given, aligned with the input", () => {
    // A 5 kHz tone: far enough above 80 Hz that the high-pass shifts its
    // phase by a small fraction of a sample, and short enough in period
    // (8.8 samples) that a one-sample misalignment is a large error.
    const input = sections([[3, 0.1]], RATE, 5000);
    const { written, out } = normalize(input, 0, 1000);
    expect(written).toBe(input.length);
    const error = (lag: number) => {
      const mid = Math.round(1.5 * RATE);
      let worst = 0;
      for (let i = mid; i < mid + 200; i++)
        worst = Math.max(
          worst,
          Math.abs((out[i + lag] ?? 0) - (input[i] ?? 0))
        );
      return worst;
    };
    expect(error(0)).toBeLessThan(0.01);
    expect(error(1)).toBeGreaterThan(0.03);
    expect(error(-1)).toBeGreaterThan(0.03);
  });

  it("takes at least 20 dB off a 20 Hz tone and under 0.5 dB off a 1 kHz tone", () => {
    const rmsDb = (x: Float32Array, from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += (x[i] ?? 0) ** 2;
      return 10 * Math.log10(s / (to - from));
    };
    const loss = (hz: number) => {
      const input = sections([[4, 0.01]], RATE, hz);
      const { out } = normalize(input, 0);
      return rmsDb(input, RATE, 3 * RATE) - rmsDb(out, RATE, 3 * RATE);
    };
    expect(loss(20)).toBeGreaterThanOrEqual(20);
    expect(Math.abs(loss(1000))).toBeLessThan(0.5);
  });
});

describe("the normalizer's contract", () => {
  it("refuses an empty flush buffer while the tail is pending, and reads 0 once it is out", () => {
    const normalizer = new LoudnessNormalizer({ sampleRate: RATE, gainDb: 0 });
    const work = new Float32Array(RATE).fill(0.1);
    expect(normalizer.process(work, RATE)).toBe(RATE - 226);
    // Without the guard an empty buffer could only ever answer 0, which a
    // caller reads as "done" with 226 samples still held.
    expect(() => normalizer.flush(new Float32Array(0))).toThrow(RangeError);
    expect(normalizer.flush(work)).toBe(226);
    expect(normalizer.flush(work)).toBe(0);
    expect(normalizer.flush(new Float32Array(0))).toBe(0);
  });
});

describe("the meter's contract", () => {
  it("refuses a chunk longer than it was sized for, and a push after finish", () => {
    const meter = new LoudnessMeter(RATE, 10);
    expect(() => meter.push(new Float32Array(11), 11)).toThrow(RangeError);
    meter.push(new Float32Array(10), 10);
    const first = meter.finish();
    expect(meter.finish()).toBe(first);
    expect(() => meter.push(new Float32Array(10), 10)).toThrow();
  });
});
