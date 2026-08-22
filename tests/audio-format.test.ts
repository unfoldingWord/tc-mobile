import { describe, expect, it } from "vitest";

import {
  CANONICAL_SAMPLE_RATE,
  floatToInt16,
  framesToMs,
  int16ToFloat,
  msToFrames,
} from "@/lib/audio/format";

describe("floatToInt16", () => {
  it("maps the normalised range onto 16-bit", () => {
    const out = floatToInt16(Float32Array.from([0, 1, -1]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32767);
  });

  it("clips rather than wrapping on out-of-range input", () => {
    const out = floatToInt16(Float32Array.from([2, -2]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });
});

describe("int16ToFloat round trip", () => {
  it("preserves samples to within one quantisation step", () => {
    const original = Float32Array.from([0, 0.5, -0.5, 0.25, -0.75]);
    const back = int16ToFloat(floatToInt16(original));
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
