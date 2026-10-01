import { describe, expect, it } from "vitest";

import {
  CANONICAL_SAMPLE_RATE,
  floatToInt16,
  framesToMs,
  int16ToFloatInto,
  msToFrames,
} from "@/lib/audio/format";

/**
 * The whole-clip `int16ToFloat` is gone (#175): materialising a Float32 copy of
 * a whole clip was half of a Play tap's memory. `int16ToFloatInto` fills a
 * caller-owned window instead, so these round-trip and clamp properties are
 * driven through a full-length window — identical assertions, one allocation
 * the caller controls.
 */
function toFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  int16ToFloatInto(input, out, 0);
  return out;
}

describe("floatToInt16", () => {
  it("maps the normalised range onto 16-bit", () => {
    const out = floatToInt16(Float32Array.from([0, 1, -1]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32767);
  });

  it("rounds to the nearest step rather than truncating toward zero", () => {
    // Truncation would halve the precision of every sample that is not exactly
    // on a step, and the round-trip test below cannot see it: its tolerance is
    // one whole step, which truncation stays inside. 0.25 * 32767 is 8191.75,
    // so rounding answers 8192 and truncation 8191.
    expect(floatToInt16(Float32Array.from([0.25]))[0]).toBe(8192);
    expect(floatToInt16(Float32Array.from([-0.25]))[0]).toBe(-8192);
    // An exact half-step is not symmetric, and that is `Math.round`, not a
    // decision this module made: 0.5 * 32767 is 16383.5, which rounds up to
    // 16384, while -16383.5 rounds toward +Infinity to -16383. Pinned so the
    // asymmetry reads as observed behaviour rather than a bug to "fix".
    expect(floatToInt16(Float32Array.from([0.5]))[0]).toBe(16384);
    expect(floatToInt16(Float32Array.from([-0.5]))[0]).toBe(-16383);
  });

  it("clips rather than wrapping on out-of-range input", () => {
    const out = floatToInt16(Float32Array.from([2, -2]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });
});

describe("int16ToFloatInto round trip", () => {
  it("preserves samples to within one quantisation step", () => {
    const original = Float32Array.from([0, 0.5, -0.5, 0.25, -0.75]);
    const back = toFloat(floatToInt16(original));
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(back[i]! - original[i]!)).toBeLessThan(1 / 32767 + 1e-9);
    }
  });
});

describe("frame/ms conversion", () => {
  it("round-trips a whole second", () => {
    expect(framesToMs(CANONICAL_SAMPLE_RATE)).toBe(1000);
    expect(msToFrames(1000)).toBe(CANONICAL_SAMPLE_RATE);
  });
});

describe("int16ToFloatInto — the asymmetry of Int16", () => {
  it("keeps the most negative representable sample inside [-1, 1]", () => {
    // floatToInt16 stores -32768 for any input at or below -1, so a clipped
    // take round-trips through int16ToFloatInto on every play. -32768 / 32767 is
    // -1.0000305, and this feeds copyToChannel.
    const out = toFloat(Int16Array.of(-32768, 32767, 0));
    expect(out[0]).toBe(-1);
    expect(out[1]).toBeCloseTo(1, 5);
    expect(out[2]).toBe(0);
  });

  it("clamps a clipped round trip end to end", () => {
    const back = toFloat(floatToInt16(Float32Array.of(-2, 2)));
    expect(back[0]).toBeGreaterThanOrEqual(-1);
    expect(back[1]!).toBeLessThanOrEqual(1);
  });
});

describe("int16ToFloatInto — the window contract (#175)", () => {
  it("converts one window at a time and reports what it wrote", () => {
    const input = Int16Array.of(0, 32767, -32768, 16384, -16384);
    const window = new Float32Array(2);

    expect(int16ToFloatInto(input, window, 0)).toBe(2);
    expect(window[0]).toBe(0);
    expect(window[1]).toBeCloseTo(1, 5);

    expect(int16ToFloatInto(input, window, 2)).toBe(2);
    expect(window[0]).toBe(-1);
    expect(window[1]).toBeCloseTo(0.5, 4);
  });

  it("writes only the remainder on a short tail, leaving the rest of the window", () => {
    // The caller passes a `subarray` of exactly this count to `copyToChannel`,
    // so a stale value beyond it must never be mistaken for audio: the return
    // value is the whole contract for where the real samples stop.
    const input = Int16Array.of(0, 0, 0, 32767);
    const window = new Float32Array(3);
    window.fill(0.5);

    expect(int16ToFloatInto(input, window, 3)).toBe(1);
    expect(window[0]).toBeCloseTo(1, 5);
    // Untouched: proof the function does not clear or pad what it did not write.
    expect(window[1]).toBe(0.5);
    expect(window[2]).toBe(0.5);
  });

  it("writes nothing once the start is at or past the end", () => {
    const input = Int16Array.of(1, 2);
    const window = new Float32Array(4);
    window.fill(0.25);
    expect(int16ToFloatInto(input, window, 2)).toBe(0);
    expect(int16ToFloatInto(input, window, 99)).toBe(0);
    expect(Array.from(window)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("rejects a negative or fractional start rather than emitting NaN", () => {
    // Out of contract, and silence here is the dangerous answer: `count` stays
    // positive, `input[start + i]` misses every real index, and the window fills
    // with `undefined / INT16_MAX` — NaN handed to `copyToChannel`, whose
    // out-of-range behaviour is implementation-defined. No live caller does this
    // (`toAudioBuffer` steps by an integer window from 0), so this guards the
    // T1 primitive's contract, not a reachable bug. Throwing beats clamping: a
    // clamp would hide the future caller's defect instead of naming it.
    const input = Int16Array.of(1, 2, 3);
    const window = new Float32Array(2);

    expect(() => int16ToFloatInto(input, window, -1)).toThrow(RangeError);
    expect(() => int16ToFloatInto(input, window, 0.5)).toThrow(RangeError);
    expect(() => int16ToFloatInto(input, window, NaN)).toThrow(RangeError);
    expect(() => int16ToFloatInto(input, window, Infinity)).toThrow(RangeError);
    // Nothing was written on any of those paths.
    expect(Array.from(window)).toEqual([0, 0]);
  });

  it("still accepts every in-contract start, including the empty tail", () => {
    const input = Int16Array.of(1, 2, 3);
    const window = new Float32Array(2);
    expect(() => int16ToFloatInto(input, window, 0)).not.toThrow();
    expect(() => int16ToFloatInto(input, window, 3)).not.toThrow();
    expect(() => int16ToFloatInto(input, window, 99)).not.toThrow();
  });

  it("never writes past the window, however long the input is", () => {
    const input = new Int16Array(1_000).fill(32767);
    const window = new Float32Array(4);
    expect(int16ToFloatInto(input, window, 0)).toBe(4);
    expect(window).toHaveLength(4);
  });
});
