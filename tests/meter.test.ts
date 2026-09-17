import { describe, expect, it } from "vitest";

import {
  METER_FLOOR_DBFS,
  METER_GREEN_MAX,
  METER_YELLOW_MAX,
  meterReadable,
  meterZone,
  rmsLevel,
  toDisplayLevel,
} from "@/lib/audio/meter";

/** A frame of `n` samples all equal to `v`. */
function constant(v: number, n = 512): Float32Array {
  return new Float32Array(n).fill(v);
}

/** One full period of a sine at amplitude `amp`. */
function sine(amp: number, n = 512): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * i) / n);
  }
  return out;
}

describe("rmsLevel", () => {
  it("is 0 for silence", () => {
    expect(rmsLevel(constant(0))).toBe(0);
  });

  it("is 0 for an empty frame", () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });

  it("is 1 for a full-scale DC frame", () => {
    // RMS of a constant |v| buffer is |v|; a constant-1 frame is the only
    // full-scale case that reaches 1 (a full-scale sine is ~0.707).
    expect(rmsLevel(constant(1))).toBeCloseTo(1, 6);
  });

  it("is ~0.707 for a full-scale sine (1/sqrt2)", () => {
    expect(rmsLevel(sine(1))).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("scales linearly with a constant frame's magnitude", () => {
    expect(rmsLevel(constant(0.25))).toBeCloseTo(0.25, 6);
    expect(rmsLevel(constant(-0.25))).toBeCloseTo(0.25, 6);
  });
});

describe("toDisplayLevel", () => {
  it("maps 0 dBFS (full scale) to 1", () => {
    expect(toDisplayLevel(1)).toBeCloseTo(1, 6);
  });

  it("maps the floor amplitude to 0", () => {
    const floorAmp = Math.pow(10, METER_FLOOR_DBFS / 20);
    expect(toDisplayLevel(floorAmp)).toBeCloseTo(0, 6);
  });

  it("maps silence (0) to 0 without producing NaN/-Infinity", () => {
    expect(toDisplayLevel(0)).toBe(0);
  });

  it("clamps everything below the floor to 0", () => {
    const belowFloor = Math.pow(10, (METER_FLOOR_DBFS - 10) / 20);
    expect(toDisplayLevel(belowFloor)).toBe(0);
  });

  it("clamps levels past full scale to 1", () => {
    expect(toDisplayLevel(1.5)).toBe(1);
  });

  it("treats negatives and NaN as silence", () => {
    expect(toDisplayLevel(-0.5)).toBe(0);
    expect(toDisplayLevel(Number.NaN)).toBe(0);
  });

  it("is monotonic and lands mid-range at half the dB span", () => {
    // Halfway up the dB span (floor/2) must map to 0.5, and be strictly
    // between the endpoints — proving the mapping is on dB, not amplitude.
    const halfSpanAmp = Math.pow(10, METER_FLOOR_DBFS / 2 / 20);
    expect(toDisplayLevel(halfSpanAmp)).toBeCloseTo(0.5, 6);
  });
});

describe("meterZone", () => {
  it("is green below the green ceiling", () => {
    expect(meterZone(METER_GREEN_MAX - 0.001)).toBe("green");
    expect(meterZone(0)).toBe("green");
  });

  it("turns yellow at the green ceiling", () => {
    expect(meterZone(METER_GREEN_MAX)).toBe("yellow");
    expect(meterZone(METER_GREEN_MAX + 0.001)).toBe("yellow");
  });

  it("stays yellow just below the yellow ceiling", () => {
    expect(meterZone(METER_YELLOW_MAX - 0.001)).toBe("yellow");
  });

  it("turns red at the yellow ceiling", () => {
    expect(meterZone(METER_YELLOW_MAX)).toBe("red");
    expect(meterZone(METER_YELLOW_MAX + 0.001)).toBe("red");
  });

  it("is red at full display level", () => {
    expect(meterZone(1)).toBe("red");
  });

  // Fixed literal probe points, independent of the constant names. The boundary
  // tests above express their inputs in terms of the constants, so a *retuned*
  // constant moves input and expectation together and passes — which would let a
  // wrong value (e.g. METER_YELLOW_MAX = 9.0, so red never fires in 0..1) ship
  // green. These pin the intended banding to concrete display levels instead.
  it("classifies fixed display levels into the intended bands", () => {
    expect(meterZone(0.5)).toBe("green");
    expect(meterZone(0.8)).toBe("yellow");
    expect(meterZone(0.95)).toBe("red");
  });
});

describe("meterReadable", () => {
  it("trusts a running context", () => {
    expect(meterReadable("running")).toBe(true);
  });

  it("does NOT trust a suspended context — reads zeros, not a dead mic (#76)", () => {
    // The regression this guards: a mid-take iOS backgrounding leaves the shared
    // context "suspended", the analyser reads zeros, and an empty strip is read
    // as a dead microphone. The meter must show unavailable instead.
    expect(meterReadable("suspended")).toBe(false);
  });

  it("does NOT trust an interrupted context — WebKit's fourth state (#76)", () => {
    expect(meterReadable("interrupted")).toBe(false);
  });

  it("does NOT trust a closed context — stricter than contextNeedsResume", () => {
    // contextNeedsResume("closed") is false (resume() would reject), but a closed
    // context is certainly not a readable meter source. The two predicates
    // deliberately diverge here.
    expect(meterReadable("closed")).toBe(false);
  });
});

// A retune tripwire, not an invariant: these values are meant to be tuned, but a
// change should be deliberate. Pinning them to the documented literals makes a
// stray edit fail here (forcing an update alongside the fixed-point anchors
// above) rather than silently altering what colour a live voice reads as.
describe("meter tuning constants (retune tripwire)", () => {
  it("holds the documented threshold and floor values", () => {
    expect(METER_GREEN_MAX).toBe(0.75);
    expect(METER_YELLOW_MAX).toBe(0.9);
    expect(METER_FLOOR_DBFS).toBe(-55);
  });

  it("maps a fixed amplitude to its documented display level (pins the floor)", () => {
    // -11 dBFS amplitude is 10^(-11/20) ≈ 0.28184. Under the -55 dBFS floor its
    // display level is (-11 - -55) / 55 = 0.8. A literal amplitude, so moving
    // METER_FLOOR_DBFS breaks this (the self-referential floor test does not).
    expect(toDisplayLevel(0.28184)).toBeCloseTo(0.8, 3);
  });
});
