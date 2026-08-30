import { describe, expect, it } from "vitest";

import { createCapturePeaks, reduceFrame } from "@/lib/audio/capture-peaks";
import { captureWindow } from "@/lib/audio/viewport";

/** A frame whose extremes are exactly `min` and `max`. */
function col(min: number, max: number): Float32Array {
  return Float32Array.from([max, 0, min]);
}

describe("reduceFrame", () => {
  it("is a silent column for an empty frame (no Infinity from an unbounded reduce)", () => {
    expect(reduceFrame(new Float32Array(0))).toEqual({ min: 0, max: 0 });
  });

  it("captures both extremes of the frame", () => {
    // Float32 stores these as 32-bit approximations, so compare with a
    // tolerance — the repo convention for peak/meter values (audio-peaks.test).
    const c = reduceFrame(Float32Array.from([0.1, -0.4, 0.7, -0.2]));
    expect(c.min).toBeCloseTo(-0.4, 6);
    expect(c.max).toBeCloseTo(0.7, 6);
  });

  it("keeps min and max separate rather than collapsing to |amplitude|", () => {
    // A frame that is loud on one side only must not read as symmetric — the
    // asymmetry is what makes speech legible (peaks.ts' reason for min AND max).
    const c = reduceFrame(Float32Array.from([0.9, 0.8, 0.85]));
    expect(c.max).toBeCloseTo(0.9, 6);
    expect(c.min).toBeCloseTo(0.8, 6); // NOT -0.9
  });

  it("a constant frame has equal min and max", () => {
    const c = reduceFrame(new Float32Array(64).fill(0.3));
    expect(c.min).toBeCloseTo(0.3, 6);
    expect(c.max).toBeCloseTo(0.3, 6);
    expect(c.min).toBe(c.max);
  });

  it("clamps samples that stray outside [-1, 1] to the range Peaks promises", () => {
    // getFloatTimeDomainData can momentarily hand back a value a hair past the
    // range; the canvas maps [-1,1] to the stage height, so an unclamped 1.3
    // would draw past the top. Without the clamp this test reads 1.3 / -1.2.
    const c = reduceFrame(Float32Array.from([1.3, -1.2, 0.5]));
    expect(c.max).toBe(1);
    expect(c.min).toBe(-1);
  });

  it("keeps min <= max when the whole frame sits outside [-1, 1] on one side", () => {
    // Both extremes clamp to 1, so min == max == 1. Dropping the UPPER bound on
    // `min` (reasoning "a minimum can't exceed 1") leaves min = 1.2 while max
    // clamps to 1 — an inverted min > max column the canvas draws upside-down.
    const c = reduceFrame(Float32Array.from([1.5, 1.8, 1.2]));
    expect(c.min).toBe(1);
    expect(c.max).toBe(1);
    expect(c.min).toBeLessThanOrEqual(c.max);
  });

  it("ignores a lone NaN among finite samples and keeps min <= max", () => {
    // The hand-rolled `<`/`>` loop skips NaN (every comparison is false), so the
    // finite extremes stand. Rewriting it as `Math.min(lo, v)` / `Math.max(hi,
    // v)` — the tempting "cleanup" — would propagate NaN into both, which this
    // pins against.
    const c = reduceFrame(Float32Array.from([0.5, Number.NaN, -0.3]));
    expect(c.min).toBeCloseTo(-0.3, 6);
    expect(c.max).toBeCloseTo(0.5, 6);
    expect(c.min).toBeLessThanOrEqual(c.max);
  });

  it("is a silent column for an all-NaN frame, not an inverted {1, -1}", () => {
    // No finite sample moves the sentinels, so without the `lo === Infinity`
    // guard the clamp maps Infinity → 1 and -Infinity → -1: an inverted min >
    // max column. The guard returns the silent column instead (as computePeaks
    // does for an empty bucket).
    const c = reduceFrame(Float32Array.from([Number.NaN, Number.NaN]));
    expect(c).toEqual({ min: 0, max: 0 });
  });
});

describe("createCapturePeaks — ring behaviour", () => {
  it("floors capacity to at least 1 (a zero-column ring has nothing to draw)", () => {
    const ring = createCapturePeaks(0);
    expect(ring.capacity).toBe(1);
    expect(ring.toPeaks().min.length).toBe(1);
  });

  it("floors a non-finite capacity (NaN, ±Infinity) to 1, and never throws", () => {
    // `Math.floor(NaN)` is NaN → a zero-length ring; `Math.floor(Infinity)` is
    // Infinity → `new Float32Array(Infinity)` THROWS RangeError (Frank R1). The
    // isFinite short-circuit must catch both BEFORE the floor — `|| 0` did not,
    // since Infinity is truthy.
    for (const cap of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const ring = createCapturePeaks(cap);
      expect(ring.capacity).toBe(1);
      expect(ring.toPeaks().min.length).toBe(1);
      ring.push(col(0, 0.5));
      expect(ring.toPeaks().max[0]).toBeCloseTo(0.5, 6);
    }
  });

  it("renders exactly `capacity` columns regardless of how many were pushed", () => {
    const ring = createCapturePeaks(4);
    ring.push(col(-0.1, 0.1));
    expect(ring.toPeaks().max.length).toBe(4);
    expect(ring.toPeaks().min.length).toBe(4);
  });

  it("places the newest column at the last index (the record head, on the right)", () => {
    const ring = createCapturePeaks(3);
    ring.push(col(0, 0.5));
    // One column, filled=1: it must land at index capacity-1, not index 0.
    // If push wrote in forward order instead, this would be at max[0].
    expect(ring.toPeaks().max[2]).toBeCloseTo(0.5, 6);
    expect(ring.toPeaks().max[0]).toBe(0);
  });

  it("orders columns oldest-left to newest-right", () => {
    const ring = createCapturePeaks(3);
    ring.push(col(0, 0.1));
    ring.push(col(0, 0.2));
    ring.push(col(0, 0.3));
    // Full ring, newest (0.3) at the head, oldest (0.1) leftmost.
    expect(Array.from(ring.toPeaks().max)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
    ]);
  });

  it("zero-pads the front while fewer than `capacity` columns have arrived", () => {
    const ring = createCapturePeaks(3);
    ring.push(col(0, 0.1));
    ring.push(col(0, 0.2));
    // count=2 < capacity=3: newest at the head, one real column left of it, the
    // far-left a zero the audio has not yet grown into — NOT a stretched fill.
    expect(Array.from(ring.toPeaks().max)).toEqual([
      0,
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
    ]);
    expect(ring.count).toBe(2);
  });

  it("evicts the oldest column once full (the R→L scroll)", () => {
    const ring = createCapturePeaks(3);
    ring.push(col(0, 0.1));
    ring.push(col(0, 0.2));
    ring.push(col(0, 0.3));
    ring.push(col(0, 0.4)); // evicts 0.1
    expect(Array.from(ring.toPeaks().max)).toEqual([
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6),
    ]);
    expect(ring.count).toBe(3); // saturates, does not run past capacity
  });

  it("keeps evicting correctly across a full wrap of the ring", () => {
    // Push 2×capacity+1 columns so `head` wraps past 0 twice. A ring-index bug
    // that only shows after the write pointer laps would surface here but not in
    // the single-eviction case above.
    const ring = createCapturePeaks(3);
    for (let i = 1; i <= 7; i++) ring.push(col(0, i / 10));
    // Last three pushed were 0.5, 0.6, 0.7.
    expect(Array.from(ring.toPeaks().max)).toEqual([
      expect.closeTo(0.5, 6),
      expect.closeTo(0.6, 6),
      expect.closeTo(0.7, 6),
    ]);
  });

  it("reset returns to an empty, all-zero scope with no stale ring data", () => {
    const ring = createCapturePeaks(3);
    ring.push(col(-0.9, 0.9));
    ring.push(col(-0.8, 0.8));
    ring.reset();
    expect(ring.count).toBe(0);
    expect(Array.from(ring.toPeaks().max)).toEqual([0, 0, 0]);
    expect(Array.from(ring.toPeaks().min)).toEqual([0, 0, 0]);
    // And it accumulates cleanly again after reset.
    ring.push(col(0, 0.5));
    expect(ring.toPeaks().max[2]).toBeCloseTo(0.5, 6);
  });

  it("carries both min and max through the ring (not just max)", () => {
    const ring = createCapturePeaks(2);
    ring.push(col(-0.3, 0.2));
    ring.push(col(-0.6, 0.4));
    const peaks = ring.toPeaks();
    expect(Array.from(peaks.min)).toEqual([
      expect.closeTo(-0.3, 6),
      expect.closeTo(-0.6, 6),
    ]);
    expect(Array.from(peaks.max)).toEqual([
      expect.closeTo(0.2, 6),
      expect.closeTo(0.4, 6),
    ]);
  });

  it("reports samplesPerBucket 0 — a live column is a frame, not a sample span", () => {
    const ring = createCapturePeaks(4);
    ring.push(col(0, 0.5));
    expect(ring.toPeaks().samplesPerBucket).toBe(0);
  });

  it("snapshots the frame's values at push, not the caller's reused buffer", () => {
    // audio-io.ts hands the SAME analyser Float32Array back every tick, mutated
    // in place. push must fold the values in now (via reduceFrame), not retain
    // the reference — a lazy-reduce refactor would make every column read back
    // the latest frame. Every other test uses a distinct buffer, so only this
    // catches it.
    const ring = createCapturePeaks(3);
    const frame = Float32Array.from([0.5, 0, -0.5]);
    ring.push(frame);
    frame[0] = 0.9;
    frame[2] = -0.9;
    ring.push(frame);
    const p = ring.toPeaks();
    // The first column keeps the values it was pushed with, not the mutated ones.
    expect(p.max[1]).toBeCloseTo(0.5, 6);
    expect(p.min[1]).toBeCloseTo(-0.5, 6);
    expect(p.max[2]).toBeCloseTo(0.9, 6);
  });

  it("reuses the output buffers and overwrites them on the next toPeaks (#102)", () => {
    // The instinctive 'aliasing safety' fix — allocate a fresh Float32Array per
    // toPeaks — silently reintroduces the per-frame reallocation #102 forbids.
    // Value-equality alone can't see it; instance identity can.
    const ring = createCapturePeaks(3);
    ring.push(col(0, 0.1));
    const a = ring.toPeaks();
    const b = ring.toPeaks();
    expect(b.min).toBe(a.min); // same instance, not a fresh allocation
    expect(b.max).toBe(a.max);
    // A push alone does not touch the returned buffers; the NEXT toPeaks does.
    ring.push(col(0, 0.9));
    expect(a.max[2]).toBeCloseTo(0.1, 6);
    ring.toPeaks();
    expect(a.max[2]).toBeCloseTo(0.9, 6);
  });
});

describe("captureWindow — the R→L capture geometry", () => {
  // Mirror the exact x the Waveform view loop computes for bucket `i`
  // (waveform.tsx): `((i / buckets - startFraction) / span) * w`. Testing
  // against the real bucket mapping — not an invented clip fraction of 1 — is
  // Frank R1's correction: fraction 1 is never assigned to any bucket.
  function bucketX(
    i: number,
    buckets: number,
    win: ReturnType<typeof captureWindow>,
    w: number
  ): number {
    const span = win.endFraction - win.startFraction;
    return ((i / buckets - win.startFraction) / span) * w;
  }

  it("draws the oldest bucket at the left edge (x = 0)", () => {
    const win = captureWindow(0.5);
    expect(bucketX(0, 150, win, 300)).toBeCloseTo(0, 6);
  });

  it("draws the newest bucket just short of the head, within one bar of it", () => {
    // The loop maps bucket i at `i/buckets`, so the newest (i = buckets-1) lands
    // one bucket-width BELOW the head, not dead on it — the honest geometry
    // (Frank R1 / George R1). It approaches the head as capacity grows.
    const win = captureWindow(0.5);
    const buckets = 150;
    const w = 300;
    const head = 0.5 * w;
    const x = bucketX(buckets - 1, buckets, win, w);
    const barStep = w / buckets / (win.endFraction - win.startFraction);
    expect(x).toBeLessThan(head); // just short of the head, never past it
    expect(head - x).toBeLessThanOrEqual(barStep + 1e-9); // within one bucket-width
  });

  it("at a right-edge head (1.0) the scope spans the whole width", () => {
    // The deferred full-width variant: head at the right edge ⇒ span 1 ⇒ the
    // newest column lands at the far edge, not the middle.
    const win = captureWindow(1);
    expect(win.startFraction).toBe(0);
    expect(win.endFraction).toBe(1);
    expect(win.centerFraction).toBe(1);
  });

  it("derives endFraction as 1 / headFraction (history fills left of the head)", () => {
    expect(captureWindow(0.5).endFraction).toBeCloseTo(2, 6);
    expect(captureWindow(0.25).endFraction).toBeCloseTo(4, 6);
    expect(captureWindow(0.8).endFraction).toBeCloseTo(1.25, 6);
  });

  it("reports the head as centerFraction so the existing centerline draws on it", () => {
    expect(captureWindow(0.5).centerFraction).toBe(0.5);
  });

  it("guards a head at 0 against a divide-by-zero endFraction", () => {
    const win = captureWindow(0);
    expect(Number.isFinite(win.endFraction)).toBe(true);
  });

  it("guards a NaN or negative head to a finite window, not NaN", () => {
    // `Math.max(EPSILON, Math.min(1, NaN))` is NaN — the naive clamp lets NaN
    // through, and a NaN window renders the live scope silently blank. The
    // `!(head > 0)` form (meter.ts' guard) rejects NaN and negatives alike.
    for (const bad of [Number.NaN, -0.5, -1]) {
      const win = captureWindow(bad);
      expect(Number.isFinite(win.endFraction)).toBe(true);
      expect(Number.isFinite(win.centerFraction)).toBe(true);
    }
  });

  it("clamps a head past the right edge back to 1", () => {
    expect(captureWindow(1.5)).toEqual({
      startFraction: 0,
      endFraction: 1,
      centerFraction: 1,
    });
  });
});
