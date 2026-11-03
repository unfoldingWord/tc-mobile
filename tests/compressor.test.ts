import { describe, expect, it } from "vitest";

import {
  CompressorRangeError,
  SPEECH_COMPRESSOR,
  SpeechCompressor,
} from "@/lib/audio/compressor";
import { speechLikePcm } from "@/lib/phone-check/speech";

/**
 * #1433 — the speech compressor kernel, unwired.
 *
 * Fixtures are the reference speech settings (3:1, 6 dB soft knee, -25 dB
 * threshold, 10 ms attack, 120 ms release) and values hand-derived from them
 * with the standard soft-knee curve and one-pole envelopes, not read off a
 * run of this code. Each derivation is written beside its test.
 */

const RATE = 44_100;
const T = SPEECH_COMPRESSOR.thresholdDb;
const dbToAmp = (db: number) => 10 ** (db / 20);
const ampToDb = (a: number) => 20 * Math.log10(a);

/** Concatenated constant sections: [seconds, level in dBFS (or null for 0)]. */
function steps(
  parts: ReadonlyArray<readonly [seconds: number, db: number | null]>
): Float32Array {
  const total = parts.reduce((n, [s]) => n + Math.round(s * RATE), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [seconds, db] of parts) {
    const end = i + Math.round(seconds * RATE);
    out.fill(db === null ? 0 : dbToAmp(db), i, end);
    i = end;
  }
  return out;
}

/** Runs `input` through a fresh compressor in chunks of `chunk`; returns a copy. */
function run(input: Float32Array, chunk = input.length || 1): Float32Array {
  const c = new SpeechCompressor(RATE);
  const out = Float32Array.from(input);
  for (let from = 0; from < out.length; from += chunk) {
    const n = Math.min(chunk, out.length - from);
    const work = out.slice(from, from + n);
    c.process(work, n);
    out.set(work, from);
  }
  return out;
}

/** Gain reduction in dB applied to sample `i`, from output over input. */
const reductionAt = (input: Float32Array, output: Float32Array, i: number) =>
  ampToDb(input[i]! / output[i]!);

describe("SpeechCompressor static curve (reference settings)", () => {
  // Soft knee, W = 6, R = 3, slope 1/R - 1 = -2/3:
  //   over ≤ -3:        0
  //   -3 < over < 3:    (2/3)(over + 3)² / 12
  //   over ≥ 3:         (2/3) over
  const c = new SpeechCompressor(RATE);
  it.each([
    [-10, 0],
    [-3, 0],
    [-1.5, ((2 / 3) * 2.25) / 12],
    [0, 0.5],
    [3, 2],
    [15, 10],
    [30, 20],
  ])("over the threshold by %d dB, turns down by %f dB", (over, want) => {
    expect(c.reductionDb(T + over)).toBeCloseTo(want, 9);
  });

  it("is continuous at both knee edges", () => {
    expect(c.reductionDb(T + 3 - 1e-9)).toBeCloseTo(c.reductionDb(T + 3), 6);
    expect(c.reductionDb(T - 3 + 1e-9)).toBeCloseTo(0, 6);
  });

  it("with a 0 dB knee is a hard knee and does not divide by zero", () => {
    const hard = new SpeechCompressor(RATE, {
      ...SPEECH_COMPRESSOR,
      kneeDb: 0,
    });
    expect(hard.reductionDb(T)).toBe(0);
    expect(hard.reductionDb(T + 3)).toBeCloseTo(2, 9);
  });
});

describe("SpeechCompressor envelopes", () => {
  it("a sustained level over the threshold settles to the curve's gain", () => {
    // 3 s of a -10 dBFS level: 15 dB over, so 10 dB down once settled. Both
    // envelopes approach 10 dB from below; after 3 s the slow one is within
    // 10·e^-10 dB of it, and the fast one has long arrived.
    const input = steps([[3, -10]]);
    const output = run(input);
    expect(reductionAt(input, output, input.length - 1)).toBeCloseTo(10, 3);
  });

  it("a sustained 1 kHz tone at -10 dBFS peak comes out near -20 dBFS peak", () => {
    const n = 3 * RATE;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++)
      input[i] = dbToAmp(-10) * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    const output = run(input);
    let peak = 0;
    for (let i = n - Math.round(0.01 * RATE); i < n; i++)
      peak = Math.max(peak, Math.abs(output[i]!));
    expect(Math.abs(ampToDb(peak) - -20)).toBeLessThan(0.5);
  });

  it("rises with the 10 ms attack", () => {
    // Silence, then -10 dBFS (target 10 dB). After 441 samples (10 ms) the
    // fast envelope is 10(1 - e^-1) = 6.3212 dB; the slow one is only
    // 10(1 - e^(-10/300)) ≈ 0.33 dB, so the fast one is what is applied.
    const onset = Math.round(0.1 * RATE);
    const input = steps([
      [0.1, null],
      [0.1, -10],
    ]);
    const output = run(input);
    const want = 10 * (1 - Math.exp(-1));
    expect(reductionAt(input, output, onset + 440)).toBeCloseTo(want, 2);
  });

  it("recovers with the 120 ms release after a brief peak", () => {
    // 50 ms at -10 dBFS, then -35 dBFS (under the knee, so the target is 0).
    // The held peak G = 10 dB falls as G e^(-t/τR) (τR = 120 ms), and the
    // applied reduction follows it through the τA = 10 ms attack pole. From
    // f(0) = F, the two cascaded poles give
    //   f(t) = G τR/(τR - τA) e^(-t/τR) + (F - G τR/(τR - τA)) e^(-t/τA),
    // with F = 10(1 - e^-5) after the 50 ms burst. At t = 120 ms that is
    // 10 (120/110) e^-1 ≈ 4.013 dB (the second term is under 1e-5). The slow
    // envelope is then 10(1 - e^(-50/300)) e^(-120/600) ≈ 1.257 dB, so the
    // fast path is what is applied. Continuous time; the per-sample poles
    // differ from it by far less than the tolerance.
    const burst = Math.round(0.05 * RATE);
    const after = Math.round(0.12 * RATE);
    const input = steps([
      [0.05, -10],
      [0.3, -35],
    ]);
    const output = run(input);
    const want = 10 * (120 / 110) * Math.exp(-1);
    expect(want).toBeCloseTo(4.013, 3);
    expect(reductionAt(input, output, burst + after - 1)).toBeCloseTo(want, 2);
  });

  it("recovers more slowly after a long loud stretch (program-dependent release)", () => {
    // 3 s at -10 dBFS: every envelope reaches 10 dB. After the drop the held
    // peak falls as h(t) = 10 e^(-t/τR) (τR = 120 ms), and the slow envelope
    // follows the held peak down through its own τS = 600 ms pole (#1873: it
    // follows the held reduction, not the raw sample). From s(0) = 10:
    //   s(t) = 10 τR/(τR - τS) e^(-t/τR) + (10 - 10 τR/(τR - τS)) e^(-t/τS)
    //        = -2.5 e^(-t/τR) + 12.5 e^(-t/τS)
    // so at t = 120 ms, 12.5 e^-0.2 - 2.5 e^-1 ≈ 9.314 dB, which holds the
    // gain back; the fast path alone is ≈ 4.01 dB there.
    const long = 3 * RATE;
    const after = Math.round(0.12 * RATE);
    const input = steps([
      [3, -10],
      [0.3, -35],
    ]);
    const output = run(input);
    const want = slowAfterLongStretch(0.12);
    expect(want).toBeCloseTo(9.314, 3);
    expect(reductionAt(input, output, long + after - 1)).toBeCloseTo(want, 2);
  });

  // George's #1872 finding 1: the DC case above cannot tell whether the slow
  // envelope sees a signal that crosses zero. On a tone every zero crossing
  // reads as -Infinity dB, so a slow envelope fed the raw sample averages a
  // spiky curve and settles well under the crest's 10 dB; fed the held
  // reduction, it sits at the crest. The expected values are the DC
  // derivation: the held peak on a 1 kHz tone at 44.1 kHz ripples by under
  // 0.1 dB between crests (one 1 ms period against the 120 ms release), and
  // the sampled crest is within 0.03 dB of the true one. The 300 ms / 600 ms
  // pair is this port's own tuning, not a reference value.
  describe("program-dependent release on a tone: burst, pause, burst", () => {
    const tone = (parts: ReadonlyArray<readonly [number, number]>) => {
      const total = parts.reduce((n, [s]) => n + Math.round(s * RATE), 0);
      const out = new Float32Array(total);
      let i = 0;
      for (const [seconds, db] of parts) {
        const end = i + Math.round(seconds * RATE);
        for (; i < end; i++)
          out[i] = dbToAmp(db) * Math.sin((2 * Math.PI * 1000 * i) / RATE);
      }
      return out;
    };
    const input = tone([
      [3, -10],
      [0.3, -35],
      [0.2, -10],
    ]);
    const output = run(input);
    /** The reduction at the loudest input sample within ±0.5 ms of `at`. */
    const crestReduction = (
      x: Float32Array,
      y: Float32Array,
      at: number
    ): number => {
      let best = at;
      for (let i = at - 22; i <= at + 22; i++)
        if (Math.abs(x[i]!) > Math.abs(x[best]!)) best = i;
      return reductionAt(x, y, best);
    };

    it("after a long burst, the pause is held back as on DC (≈ 9.31 dB at 120 ms)", () => {
      const at = 3 * RATE + Math.round(0.12 * RATE);
      const got = crestReduction(input, output, at);
      expect(Math.abs(got - slowAfterLongStretch(0.12))).toBeLessThan(0.1);
    });

    it("after a brief burst, the pause recovers on the fast path (≈ 4.01 dB at 120 ms)", () => {
      const brief = tone([
        [0.05, -10],
        [0.3, -35],
      ]);
      const at = Math.round(0.05 * RATE) + Math.round(0.12 * RATE);
      const got = crestReduction(brief, run(brief), at);
      expect(Math.abs(got - 10 * (120 / 110) * Math.exp(-1))).toBeLessThan(0.1);
    });

    it("the second burst starts already held back (≈ 7.38 dB)", () => {
      // At the end of the 300 ms pause the slow envelope is
      // 12.5 e^-0.5 - 2.5 e^-2.5 ≈ 7.376 dB and the fast one under 1 dB; the
      // second burst's first crest, a quarter period in, adds under 0.01 dB
      // through the 300 ms rise.
      const crest = Math.round(3.3 * RATE) + Math.round(0.00025 * RATE);
      const got = crestReduction(input, output, crest);
      expect(Math.abs(got - slowAfterLongStretch(0.3))).toBeLessThan(0.1);
    });
  });

  // George's #1872 finding 2: on a long pause the envelopes decay toward 0
  // and, unflushed, reach subnormal doubles after about 85 s (the 120 ms held
  // peak needs about 711 time constants to fall under 1e-308). Each is
  // flushed to exactly 0 under 1e-4 dB, a gain error of about 1e-5 relative.
  describe("envelope flush on a long pause", () => {
    type Envelopes = { held: number; fast: number; slow: number };
    // The three envelopes are private state, read here rather than exported.
    const envelopes = (c: SpeechCompressor): Envelopes =>
      c as unknown as Envelopes;

    it("every envelope is exactly 0 after a pause, not a decaying tail", () => {
      // After 10 s the slowest (600 ms) would still be about
      // 12.5 e^(-10/0.6) ≈ 7e-7 dB unflushed: positive, so this fails
      // without the flush.
      const c = new SpeechCompressor(RATE);
      const loud = steps([[0.5, -3]]);
      c.process(loud, loud.length);
      const pause = new Float32Array(10 * RATE);
      c.process(pause, pause.length);
      const { held, fast, slow } = envelopes(c);
      expect([held, fast, slow]).toEqual([0, 0, 0]);
    });

    it("an audible tail is not flushed early (≈ 3e-3 dB at 5 s)", () => {
      // 5 s after a 3 s stretch the slow envelope is 12.5 e^(-5/0.6)
      // ≈ 3.0e-3 dB, thirty times the flush level: still applied.
      const input = steps([
        [3, -10],
        [5.1, -35],
      ]);
      const output = run(input);
      const at = 3 * RATE + 5 * RATE - 1;
      expect(slowAfterLongStretch(5)).toBeGreaterThan(2e-3);
      expect(reductionAt(input, output, at)).toBeCloseTo(
        slowAfterLongStretch(5),
        4
      );
    });
  });
});

/** The slow envelope `t` s after a long stretch at 10 dB (derived above). */
function slowAfterLongStretch(t: number): number {
  return -2.5 * Math.exp(-t / 0.12) + 12.5 * Math.exp(-t / 0.6);
}

describe("SpeechCompressor streaming", () => {
  const speech = Float32Array.from(speechLikePcm(4, RATE), (v) => v / 32768);

  it("compresses the synthetic speech (so the chunk test is not vacuous)", () => {
    const c = new SpeechCompressor(RATE);
    c.process(Float32Array.from(speech), speech.length);
    expect(c.maxReductionDb).toBeGreaterThan(3);
  });

  it.each([1, 37, 4410, RATE])(
    "gives identical output whole or in %d-sample chunks",
    (chunk) => {
      // First differing index, not toEqual: a failing toEqual on 176 400
      // floats builds a diff that takes minutes.
      const whole = run(speech);
      const chunked = run(speech, chunk);
      expect(chunked.length).toBe(whole.length);
      expect(whole.findIndex((v, i) => !Object.is(v, chunked[i]))).toBe(-1);
    }
  );

  it("never makes a sample louder", () => {
    const output = run(speech);
    const louder = speech.findIndex(
      (v, i) => Math.abs(output[i]!) > Math.abs(v)
    );
    expect(louder).toBe(-1);
  });

  it("accepts an empty chunk", () => {
    const c = new SpeechCompressor(RATE);
    expect(() => c.process(new Float32Array(4), 0)).not.toThrow();
    expect(c.maxReductionDb).toBe(0);
  });
});

describe("SpeechCompressor edge input", () => {
  it("silence in gives silence out, with no reduction", () => {
    const c = new SpeechCompressor(RATE);
    const x = new Float32Array(RATE);
    c.process(x, x.length);
    expect(x.every((v) => v === 0)).toBe(true);
    expect(c.maxReductionDb).toBe(0);
  });

  it("silence after a loud stretch stays exactly silent", () => {
    const output = run(
      steps([
        [0.5, -3],
        [0.5, null],
      ])
    );
    expect(output.subarray(Math.round(0.5 * RATE)).every((v) => v === 0)).toBe(
      true
    );
  });

  it("gives finite output on full scale, square waves and tiny values", () => {
    const n = RATE;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i % 5;
      input[i] =
        k === 0 ? 1 : k === 1 ? -1 : k === 2 ? 1e-30 : k === 3 ? -1e-9 : 3.5;
    }
    const output = run(input, 101);
    expect(output.findIndex((v) => !Number.isFinite(v))).toBe(-1);
    expect(output.findIndex((v, i) => Math.abs(v) > Math.abs(input[i]!))).toBe(
      -1
    );
  });

  it.each([NaN, Infinity, -Infinity])(
    "refuses a %f sample before touching the chunk",
    (bad) => {
      const c = new SpeechCompressor(RATE);
      const x = Float32Array.of(0.9, 0.9, bad);
      // Its own type, so the worker can name the compressor as what refused
      // (#1873), and still a RangeError.
      expect(() => c.process(x, 3)).toThrow(CompressorRangeError);
      expect(() => c.process(x, 3)).toThrow(RangeError);
      expect(x[0]).toBeCloseTo(0.9, 6);
      expect(c.maxReductionDb).toBe(0);
    }
  );

  it("refuses a chunk length outside the buffer", () => {
    const c = new SpeechCompressor(RATE);
    expect(() => c.process(new Float32Array(4), 5)).toThrow(RangeError);
    expect(() => c.process(new Float32Array(4), -1)).toThrow(RangeError);
  });

  it.each([
    ["sampleRate", 0, {}],
    ["sampleRate", NaN, {}],
    ["ratio", RATE, { ratio: 0.5 }],
    ["ratio", RATE, { ratio: NaN }],
    ["ratio", RATE, { ratio: Infinity }],
    ["kneeDb", RATE, { kneeDb: -1 }],
    ["thresholdDb", RATE, { thresholdDb: NaN }],
    ["attackSeconds", RATE, { attackSeconds: 0 }],
    ["releaseSeconds", RATE, { releaseSeconds: -0.1 }],
  ] as const)("refuses a bad %s", (_name, rate, override) => {
    expect(
      () => new SpeechCompressor(rate, { ...SPEECH_COMPRESSOR, ...override })
    ).toThrow(CompressorRangeError);
  });
});
