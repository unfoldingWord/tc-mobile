import { describe, expect, it } from "vitest";

import { SPEECH_COMPRESSOR, SpeechCompressor } from "@/lib/audio/compressor";
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
    // 3 s at -10 dBFS: every envelope reaches 10 dB. 120 ms later the fast
    // path is at ≈ 4.01 dB (as above), but the slow envelope, falling straight
    // from 10 dB with τ = 600 ms, is at 10e^(-120/600) ≈ 8.19 dB and holds
    // the gain back.
    const long = 3 * RATE;
    const after = Math.round(0.12 * RATE);
    const input = steps([
      [3, -10],
      [0.3, -35],
    ]);
    const output = run(input);
    const want = 10 * Math.exp(-after / (0.6 * RATE));
    expect(want).toBeCloseTo(8.187, 2);
    expect(reductionAt(input, output, long + after - 1)).toBeCloseTo(want, 2);
  });
});

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
    ).toThrow(RangeError);
  });
});
