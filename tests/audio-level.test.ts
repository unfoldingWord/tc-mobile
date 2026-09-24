import { describe, expect, it } from "vitest";

import { INT16_MAX } from "@/lib/audio/format";
import { measureLevel } from "@/lib/audio/level";

/**
 * `measureLevel` is the arithmetic behind the stored-playback level probe
 * (#555, #612, #269): what a device reading reports as peak and RMS in dBFS.
 * A probe whose own arithmetic is wrong would send a device session after a
 * gain difference that is not there, so every figure here is derived by hand
 * from the input, never from the module.
 */

/** `periods` whole periods of a sine at `amp`, `n` samples. */
function sine(amp: number, n = 4_410, periods = 10): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * periods * i) / n);
  }
  return out;
}

function toInt16(values: Float64Array): Int16Array {
  return Int16Array.from(values, (v) => Math.round(v));
}

describe("measureLevel", () => {
  it("reads silence as -Infinity dBFS, not as a number", () => {
    const level = measureLevel(new Int16Array(1_000), INT16_MAX);
    expect(level.frames).toBe(1_000);
    expect(level.peak).toBe(0);
    expect(level.rms).toBe(0);
    expect(level.peakDbfs).toBe(-Infinity);
    expect(level.rmsDbfs).toBe(-Infinity);
    expect(level.clipped).toBe(0);
  });

  it("reads an empty buffer as zero frames of silence", () => {
    const level = measureLevel(new Int16Array(0), INT16_MAX);
    expect(level.frames).toBe(0);
    expect(level.rms).toBe(0);
    expect(level.rmsDbfs).toBe(-Infinity);
  });

  it("reads a constant full-scale buffer as 0 dBFS peak and RMS", () => {
    const level = measureLevel(new Int16Array(64).fill(INT16_MAX), INT16_MAX);
    expect(level.peakDbfs).toBeCloseTo(0, 10);
    expect(level.rmsDbfs).toBeCloseTo(0, 10);
  });

  it("puts a sine's RMS 3.01 dB under its peak", () => {
    // For amplitude 8000, 20·log10(8000/32767)
    // = -12.247 dBFS peak, and a sine's RMS is peak/√2, so -15.257 dBFS.
    const level = measureLevel(toInt16(sine(8_000)), INT16_MAX);
    expect(level.peakDbfs).toBeCloseTo(20 * Math.log10(8_000 / INT16_MAX), 2);
    expect(level.rmsDbfs).toBeCloseTo(
      20 * Math.log10(8_000 / Math.SQRT2 / INT16_MAX),
      2
    );
  });

  it("reads half amplitude as 6.02 dB down", () => {
    const full = measureLevel(Float32Array.from(sine(1)), 1);
    const half = measureLevel(Float32Array.from(sine(0.5)), 1);
    expect(full.rmsDbfs - half.rmsDbfs).toBeCloseTo(20 * Math.log10(2), 3);
    expect(full.peakDbfs - half.peakDbfs).toBeCloseTo(20 * Math.log10(2), 3);
  });

  it("takes the peak from either sign", () => {
    const samples = new Int16Array([0, 100, -9_000, 50]);
    expect(measureLevel(samples, INT16_MAX).peak).toBe(9_000);
  });

  it("counts samples at or beyond full scale as clipped, and nothing under it", () => {
    // Int16 is asymmetric: -32768 is beyond the positive full scale, and a
    // decoder overshoot pinned by `floatToInt16` lands exactly on either rail.
    const samples = new Int16Array([INT16_MAX, -32_768, INT16_MAX - 1, 0]);
    expect(measureLevel(samples, INT16_MAX).clipped).toBe(2);
    const floats = new Float32Array([1, -1, 1.2, 0.999]);
    expect(measureLevel(floats, 1).clipped).toBe(3);
  });

  it("measures a view as its own samples, not its backing store's", () => {
    // The edit-mode audition sounds `working.subarray(start, end)` (#612): a
    // silent view of a loud buffer must read silent.
    const backing = new Int16Array(2_000).fill(20_000);
    backing.fill(0, 500, 1_500);
    const level = measureLevel(backing.subarray(500, 1_500), INT16_MAX);
    expect(level.frames).toBe(1_000);
    expect(level.rmsDbfs).toBe(-Infinity);
  });
});
