import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  advanceColumnRate,
  buildCaptureContext,
  type ColumnRateClock,
  columnsRightOfHead,
  CONTEXT_BUCKET_SAMPLES,
  estimateColumnRate,
  foldContextSide,
  newColumnRateClock,
  NOMINAL_COLUMN_RATE,
  type ContextSide,
} from "@/lib/audio/capture-context";
import { displayGain } from "@/lib/audio/display-gain";
import { CANONICAL_SAMPLE_RATE, INT16_MAX } from "@/lib/audio/format";
import { computePeaks } from "@/lib/audio/peaks";

import { stripComments } from "./support";

/** A ramp: sample i holds i * 1000, so every bucket's extremes name its span. */
function ramp(n: number): Int16Array {
  return Int16Array.from({ length: n }, (_, i) => i * 1000);
}

/** A side's real buckets as [min, max] pairs in raw Int16 units. */
function pairs(s: ContextSide): [number, number][] {
  return Array.from({ length: s.count }, (_, b) => [
    Math.round(s.min[b]! * INT16_MAX),
    Math.round(s.max[b]! * INT16_MAX),
  ]);
}

describe("buildCaptureContext (#640)", () => {
  it("has nothing to show for a first take", () => {
    expect(buildCaptureContext(new Int16Array(0), 0, null)).toBeNull();
  });

  it("walks OUTWARD from the offset on both sides, nearest bucket first", () => {
    const ctx = buildCaptureContext(ramp(10), 4, null, 2, 1_000)!;
    // Before: samples 3,2 then 1,0 — the bucket touching the offset is index 0.
    expect(pairs(ctx.before)).toEqual([
      [2000, 3000],
      [0, 1000],
    ]);
    // After: samples 4,5 / 6,7 / 8,9.
    expect(pairs(ctx.after)).toEqual([
      [4000, 5000],
      [6000, 7000],
      [8000, 9000],
    ]);
    expect(ctx.samplesPerBucket).toBe(2);
  });

  it("leaves the left blank at the very start and the right blank at the end", () => {
    const atStart = buildCaptureContext(ramp(10), 0, null, 2, 1_000)!;
    expect(atStart.before.count).toBe(0);
    expect(atStart.after.count).toBe(5);
    const atEnd = buildCaptureContext(ramp(10), 10, null, 2, 1_000)!;
    expect(atEnd.before.count).toBe(5);
    expect(atEnd.after.count).toBe(0);
  });

  it("caps each side, with a short last bucket where the cap falls mid-bucket", () => {
    const ctx = buildCaptureContext(ramp(10), 5, null, 2, 3)!;
    // 3 samples before: 4,3 then 2 alone.
    expect(pairs(ctx.before)).toEqual([
      [3000, 4000],
      [2000, 2000],
    ]);
    expect(pairs(ctx.after)).toEqual([
      [5000, 6000],
      [7000, 7000],
    ]);
  });

  it("clamps an offset outside the buffer instead of indexing past it", () => {
    expect(
      buildCaptureContext(ramp(10), -5, null, 2, 1_000)!.before.count
    ).toBe(0);
    expect(buildCaptureContext(ramp(10), 99, null, 2, 1_000)!.after.count).toBe(
      0
    );
    expect(
      buildCaptureContext(ramp(10), NaN, null, 2, 1_000)!.before.count
    ).toBe(0);
    // Past the end reads as AT the end: the whole clip before it, real values.
    expect(
      pairs(buildCaptureContext(ramp(10), 99, null, 2, 1_000)!.before)
    ).toEqual(pairs(buildCaptureContext(ramp(10), 10, null, 2, 1_000)!.before));
  });

  it("keeps Int16's asymmetric floor inside [-1, 1], as computePeaks does", () => {
    const ctx = buildCaptureContext(
      Int16Array.of(-32768, 0),
      1,
      null,
      2,
      1_000
    )!;
    expect(ctx.before.min[0]).toBe(-1);
  });
});

describe("the context carries the committed clip's display gain (#1189)", () => {
  // A quiet clip, the #358 Moto G shape: every sample at ±5% of full scale.
  const quiet = Int16Array.from(
    { length: 4_000 },
    (_, i) => (i % 2 ? 1 : -1) * Math.round(0.05 * INT16_MAX)
  );

  it("is the gain the idle Waveform fits the same committed peaks to", () => {
    const peaks = computePeaks(quiet, 400);
    const ctx = buildCaptureContext(quiet, 2_000, peaks)!;
    expect(ctx.gain).toBe(displayGain(peaks, false));
    // Not trivially 1: the quiet clip is fitted up, which is what a Record
    // tap used to throw away.
    expect(ctx.gain).toBeGreaterThan(10);
  });

  it("is absolute (1) when there are no committed peaks to fit to", () => {
    expect(buildCaptureContext(quiet, 2_000, null)!.gain).toBe(1);
  });
});

describe("foldContextSide", () => {
  const side: ContextSide = {
    min: Float32Array.of(-0.1, -0.5, -0.2, -0.9, -0.3),
    max: Float32Array.of(0.1, 0.2, 0.7, 0.3, 0.4),
    count: 5,
  };

  it("folds whole buckets into each column's extremes, nearest-first", () => {
    const lo = new Float32Array(8);
    const hi = new Float32Array(8);
    expect(foldContextSide(side, 2, 8, lo, hi)).toBe(3);
    expect(Array.from(lo.subarray(0, 3))).toEqual(
      Array.from(Float32Array.of(-0.5, -0.9, -0.3))
    );
    expect(Array.from(hi.subarray(0, 3))).toEqual(
      Array.from(Float32Array.of(0.2, 0.7, 0.4))
    );
  });

  it("a fractional rate reads every bucket exactly once", () => {
    // 1.5 buckets per column → spans [0,1) [1,3) [3,4) [4,6→5): every bucket
    // reached, none twice — the extreme -0.9 at bucket 3 lands in column 2.
    const lo = new Float32Array(8);
    const hi = new Float32Array(8);
    expect(foldContextSide(side, 1.5, 8, lo, hi)).toBe(4);
    expect(lo[2]).toBeCloseTo(-0.9);
    // Column 0 is bucket 0 alone — a fold that rounded its end UP would pull
    // bucket 1's -0.5 in here and read it again in column 1.
    expect(lo[0]).toBeCloseTo(-0.1);
    expect(hi[0]).toBeCloseTo(0.1);
    expect(hi[1]).toBeCloseTo(0.7);
  });

  it("stops at the room it is given and at the buffer it writes into", () => {
    const lo = new Float32Array(2);
    const hi = new Float32Array(2);
    expect(foldContextSide(side, 1, 8, lo, hi)).toBe(2);
    expect(
      foldContextSide(side, 1, 1, new Float32Array(8), new Float32Array(8))
    ).toBe(1);
    expect(foldContextSide(side, 1, 0, lo, hi)).toBe(0);
  });

  it("folds nothing for a rate it cannot use", () => {
    const lo = new Float32Array(8);
    const hi = new Float32Array(8);
    expect(foldContextSide(side, 0, 8, lo, hi)).toBe(0);
    expect(foldContextSide(side, NaN, 8, lo, hi)).toBe(0);
    expect(foldContextSide(side, Infinity, 8, lo, hi)).toBe(0);
  });
});

describe("the context and the take share one time scale", () => {
  // The claim the whole composition rests on: at the column rate the scope
  // measured, a second of stored audio is as many columns as a second of the
  // take. The live scope computes `bucketsPerColumn` exactly like this.
  it.each([30, 60, 90, 120])("at %i columns a second", (rate) => {
    const seconds = 2;
    const ctx = buildCaptureContext(
      new Int16Array(seconds * CANONICAL_SAMPLE_RATE),
      seconds * CANONICAL_SAMPLE_RATE,
      null
    )!;
    expect(ctx.samplesPerBucket).toBe(CONTEXT_BUCKET_SAMPLES);
    const bucketsPerColumn =
      CANONICAL_SAMPLE_RATE / rate / ctx.samplesPerBucket;
    const room = 10_000;
    const n = foldContextSide(
      ctx.before,
      bucketsPerColumn,
      room,
      new Float32Array(room),
      new Float32Array(room)
    );
    expect(n).toBe(seconds * rate);
  });
});

describe("estimateColumnRate", () => {
  it("reports not-measured until it has something to measure", () => {
    expect(estimateColumnRate(0, 0)).toBeNull();
    expect(estimateColumnRate(100, 200)).toBeNull();
    expect(estimateColumnRate(5, 1_000)).toBeNull();
    expect(estimateColumnRate(20, NaN)).toBeNull();
  });

  it("measures columns over elapsed time", () => {
    expect(estimateColumnRate(120, 1_000)).toBe(120);
    expect(estimateColumnRate(45, 1_500)).toBe(30);
  });

  it("clamps a stalled or runaway frame clock", () => {
    expect(estimateColumnRate(10, 10_000)).toBe(15);
    expect(estimateColumnRate(1_000, 250)).toBe(240);
  });
});

describe("advanceColumnRate — the current cadence, not a lifetime average", () => {
  /** Tick `clock` `n` times at `hz`, starting `startMs`; returns the next time. */
  function run(clock: ColumnRateClock, hz: number, n: number, startMs: number) {
    for (let i = 0; i < n; i++)
      advanceColumnRate(clock, startMs + (i * 1000) / hz);
    return startMs + (n * 1000) / hz;
  }

  it("keeps the nominal prior until the first window can be measured", () => {
    const clock = newColumnRateClock();
    run(clock, 120, 5, 0);
    expect(clock.rate).toBe(NOMINAL_COLUMN_RATE);
    run(clock, 120, 60, 5000 / 120);
    expect(clock.rate).toBeCloseTo(120, 0);
  });

  it("a long gap (background, stall) does not drag the post-gap rate to the clamp", () => {
    const clock = newColumnRateClock();
    const end = run(clock, 60, 60, 0);
    // 60 s with no column, then the frame clock resumes at 60 Hz.
    run(clock, 60, 1, end + 60_000);
    expect(clock.rate).toBeCloseTo(60, 0);
    run(clock, 60, 60, end + 60_000 + 1000 / 60);
    expect(clock.rate).toBeCloseTo(60, 0);
  });

  it("a gap shorter than the window is discarded too, not averaged in", () => {
    const clock = newColumnRateClock();
    const end = run(clock, 60, 30, 0);
    run(clock, 60, 30, end + 800);
    expect(clock.rate).toBeCloseTo(60, 0);
  });

  it("keeps the last MEASURED rate across a gap, not the nominal prior", () => {
    const clock = newColumnRateClock();
    const end = run(clock, 120, 120, 0);
    run(clock, 120, 3, end + 5_000);
    expect(clock.rate).toBeCloseTo(120, 0);
  });

  it("follows a refresh-rate transition within a few seconds", () => {
    const clock = newColumnRateClock();
    const end = run(clock, 60, 600, 0);
    expect(clock.rate).toBeCloseTo(60, 0);
    run(clock, 120, 600, end);
    expect(clock.rate).toBeCloseTo(120, 0);
  });

  it("the live scope's tick feeds the clock rather than an inline average", () => {
    // Stripped first (#822): a comment quoting the call would otherwise
    // satisfy the positive match with the live tick averaging inline.
    const scope = stripComments(
      readFileSync(
        new URL("../src/components/live-scope.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(scope).toMatch(/advanceColumnRate\(\s*rateRef\.current,/);
    expect(scope).not.toMatch(/estimateColumnRate\(/);
  });
});

describe("columnsRightOfHead", () => {
  it("fills the half right of a centred head", () => {
    expect(columnsRightOfHead(180, 2)).toBe(180);
  });

  it("has no room right of a head at the right edge", () => {
    expect(columnsRightOfHead(180, 1)).toBe(0);
  });

  it("rounds up so the last column reaches the edge", () => {
    expect(columnsRightOfHead(10, 1 / 0.3)).toBe(24);
  });

  it("is zero for a scope it cannot place", () => {
    expect(columnsRightOfHead(0, 2)).toBe(0);
    expect(columnsRightOfHead(180, NaN)).toBe(0);
  });
});

/**
 * This suite does not mount the recorder (other suites do, through
 * `react-dom/client`); keeping it Node-pure is a scope choice, so the wiring
 * is pinned as source shape: the context is built from the SAME offset the
 * take splices at, on every path that starts the mic, and reaches the scope.
 */
describe("recorder wiring (#640)", () => {
  // Stripped first (#822): unstripped, a comment carrying the wiring could
  // satisfy each positive match below while the live code said otherwise.
  const src = stripComments(
    readFileSync(
      new URL("../src/components/recorder.tsx", import.meta.url),
      "utf8"
    )
  );

  it("the Record tap builds the context at the offset it locks, and its deps carry editor (#1201)", () => {
    // The pin runs THROUGH `onRecordButton`'s `useCallback` dependency list.
    // Dropping `editor` from that list is not a stale buffer today:
    // `useSegmentEditor` returns a fresh object every render, and
    // `commitTake`, which is still listed, lists `editor` itself, so the
    // callback is rebuilt on every render either way. The list is pinned
    // because that coupling is an implementation detail of `commitTake`, not
    // a contract of this callback. `react-hooks/exhaustive-deps` flags the
    // drop too; this is the second gate, for the #212 bail-out shape, as in
    // the Retry pin below.
    expect(src).toMatch(
      /insertionOffset\.current = win\.centerlineSample;\s*setCaptureContext\(\s*buildCaptureContext\(\s*editor\.working,\s*win\.centerlineSample,\s*editor\.peaks\s*\)\s*\);\s*audio\.startRecording\(\);\s*\},\s*\[recording,\s*view,\s*audio,\s*editor,\s*win\.centerlineSample,\s*commitTake\]\s*\);/
    );
  });

  it("the permission Retry builds it from the offset already locked, and its deps carry editor.peaks (#1201)", () => {
    // The pin runs THROUGH the `useCallback` dependency list, not just the
    // call. Dropping `editor.peaks` from that list is not a stale fit today:
    // `editor.peaks` is a `useMemo` over `working` (`use-segment-editor.ts`),
    // so it changes only when `editor.working` does, and `editor.working` is
    // still listed. The list is pinned because that coupling is an
    // implementation detail of the hook, not a contract of this callback.
    // `react-hooks/exhaustive-deps` flags the drop too; this is the second
    // gate, for the #212 bail-out shape that silences that rule for a whole
    // hook body without failing lint.
    expect(src).toMatch(
      /setCaptureContext\(\s*buildCaptureContext\(\s*editor\.working,\s*insertionOffset\.current,\s*editor\.peaks\s*\)\s*\);\s*audio\.startRecording\(\);\s*\},\s*\[audio,\s*editor\.working,\s*editor\.peaks\]\s*\);/
    );
  });

  it("every mic start is one of those two", () => {
    expect(src.match(/audio\.startRecording\(\);/g)).toHaveLength(2);
    expect(src.match(/setCaptureContext\(/g)).toHaveLength(2);
  });

  it("the live scope is handed the context", () => {
    const at = src.indexOf("<LiveScope");
    expect(at).toBeGreaterThan(-1);
    const tag = src.slice(at, src.indexOf("/>", at));
    expect(tag).toContain("context={captureContext}");
  });
});
