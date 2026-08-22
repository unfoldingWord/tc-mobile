import { describe, expect, it } from "vitest";

import { computePeaks } from "@/lib/audio/peaks";

describe("computePeaks", () => {
  it("returns the requested number of buckets", () => {
    const peaks = computePeaks(new Int16Array(1000), 50);
    expect(peaks.min.length).toBe(50);
    expect(peaks.max.length).toBe(50);
  });

  it("captures the extremes within each bucket", () => {
    // Two buckets: first half peaks positive, second half peaks negative.
    const samples = new Int16Array(100);
    samples.fill(0);
    samples[10] = 32767;
    samples[70] = -32767;
    const peaks = computePeaks(samples, 2);
    expect(peaks.max[0]).toBeCloseTo(1, 5);
    expect(peaks.min[1]).toBeCloseTo(-1, 5);
  });

  it("handles an empty buffer without producing NaN", () => {
    const peaks = computePeaks(new Int16Array(0), 10);
    expect(Array.from(peaks.min).every((v) => v === 0)).toBe(true);
    expect(Array.from(peaks.max).every((v) => v === 0)).toBe(true);
  });

  it("does not emit NaN when there are more buckets than samples", () => {
    const peaks = computePeaks(Int16Array.from([32767, -32767, 0]), 16);
    expect(Array.from(peaks.min).every((v) => Number.isFinite(v))).toBe(true);
    expect(Array.from(peaks.max).every((v) => Number.isFinite(v))).toBe(true);
  });
});
