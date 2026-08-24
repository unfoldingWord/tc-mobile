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

  it("gives every bucket a real sample when the buffer is shorter than the bucket count", () => {
    // Finiteness alone does not catch this: an empty span falls through to the
    // `lo === Infinity` branch and reports 0/0, which is finite and draws as a
    // flat line through the middle of the waveform. The `Math.max(start + 1,
    // ...)` in peaks.ts:36 is what prevents it, and nothing above distinguishes
    // it from a buffer that really is silent there.
    const loud = Int16Array.from([32767, -32767, 20000]);
    const peaks = computePeaks(loud, 16);
    const flat = Array.from(peaks.min).filter(
      (lo, b) => lo === 0 && peaks.max[b] === 0
    );
    expect(flat).toHaveLength(0);
  });

  it("keeps at least one bucket when asked for none", () => {
    // `samples.length / 0` is Infinity, and a `samplesPerBucket` of Infinity
    // would travel out to whatever draws the waveform. The floor of one bucket
    // in peaks.ts:21 is the only thing stopping it.
    const peaks = computePeaks(Int16Array.from([100, -100]), 0);
    expect(peaks.min.length).toBe(1);
    expect(peaks.max.length).toBe(1);
    expect(Number.isFinite(peaks.samplesPerBucket)).toBe(true);
  });
});

describe("computePeaks — the asymmetry of Int16", () => {
  it("keeps the most negative representable sample inside [-1, 1]", () => {
    // INT16_MIN is -32768 while INT16_MAX is 32767, so normalising the floor
    // by INT16_MAX alone yields -1.0000305. `Peaks` documents [-1, 1].
    const peaks = computePeaks(Int16Array.from([-32768, 32767]), 1);
    expect(peaks.min[0]).toBe(-1);
    expect(peaks.max[0]).toBeCloseTo(1, 5);
    expect(peaks.min[0]!).toBeGreaterThanOrEqual(-1);
  });
});
