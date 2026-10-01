import { describe, expect, it } from "vitest";

import {
  clampRange,
  concat,
  cut,
  fitToFrames,
  insertAt,
  mergeTake,
  replaceRange,
  silence,
  sliceRange,
  spansWholeSample,
  wholeSampleRange,
} from "@/lib/audio/edit";

const seq = (n: number, from = 0): Int16Array =>
  Int16Array.from({ length: n }, (_, i) => i + from);

describe("clampRange", () => {
  it("normalises reversed ranges", () => {
    expect(clampRange({ start: 8, end: 3 }, 10)).toEqual({ start: 3, end: 8 });
  });

  it("clamps to the buffer bounds", () => {
    expect(clampRange({ start: -5, end: 999 }, 10)).toEqual({
      start: 0,
      end: 10,
    });
  });
});

/**
 * The one predicate behind "is anything actually selected?".
 *
 * Selection edges are floats — pointer geometry, and a keyboard nudge of
 * `visibleSamples / 400` — while every consumer of a range TRUNCATES: `slice`
 * for a cut, `subarray` for an audition. So "start !== end" is the wrong
 * question, and asking it let two controls disagree with each other and with
 * the audio: Play went inert on a sub-sample span while Cut stayed live and
 * applied an empty cut, which advances the undo log and REPLACES the
 * chapter-wide clipboard with an empty buffer (Frank R3). This is the question
 * all of them ask now, so they cannot drift apart again.
 *
 * It takes an already-normalised range — every call site clamps with
 * `clampRange` first, which is also what orders a reversed span.
 */
describe("spansWholeSample", () => {
  it("is true for a span containing whole samples", () => {
    expect(spansWholeSample({ start: 10, end: 11 })).toBe(true);
    expect(spansWholeSample({ start: 0, end: 4410 })).toBe(true);
  });

  it("is true for a fractional span that straddles a sample boundary", () => {
    // `slice(10.2, 11.1)` is `slice(10, 11)` — one sample is taken.
    expect(spansWholeSample({ start: 10.2, end: 11.1 })).toBe(true);
  });

  it("is false for a span living inside one sample", () => {
    // `slice(10.2, 10.9)` is `slice(10, 10)` — nothing is taken, so nothing
    // may act as though something were.
    expect(spansWholeSample({ start: 10.2, end: 10.9 })).toBe(false);
  });

  it("is false for a zero-length span", () => {
    expect(spansWholeSample({ start: 250, end: 250 })).toBe(false);
  });

  it("is false for a non-finite edge", () => {
    // `NaN === NaN` is false, so an equality test called this "selected".
    expect(spansWholeSample({ start: Number.NaN, end: 400 })).toBe(false);
    expect(spansWholeSample({ start: 100, end: Number.NaN })).toBe(false);
  });
});

/**
 * The ONE place an `EditOp` cut range (or any other fractional selection)
 * becomes the whole-sample bounds a buffer edit actually acts on — folding
 * round 2's `removedSampleCount` (a length) into a range, so `cut`/
 * `sliceRange` and every position-reading caller (`recorder-stage.ts`'s pan
 * arithmetic) share one normalisation instead of two (#473 round 3, Frank P2).
 */
describe("wholeSampleRange", () => {
  it("truncates both edges toward zero, matching Int16Array.slice's own coercion", () => {
    expect(wholeSampleRange({ start: 4_000.4, end: 8_000.7 })).toEqual({
      start: 4_000,
      end: 8_000,
    });
  });

  it("normalises a reversed range", () => {
    expect(wholeSampleRange({ start: 8_000.7, end: 4_000.4 })).toEqual({
      start: 4_000,
      end: 8_000,
    });
  });

  it("is idempotent on an already-integer range", () => {
    expect(wholeSampleRange({ start: 3, end: 9 })).toEqual({
      start: 3,
      end: 9,
    });
  });
});

describe("sliceRange", () => {
  it("copies the samples inside the range", () => {
    expect(Array.from(sliceRange(seq(10), { start: 2, end: 5 }))).toEqual([
      2, 3, 4,
    ]);
  });

  it("does not alias the source buffer", () => {
    const source = seq(10);
    const slice = sliceRange(source, { start: 0, end: 3 });
    slice[0] = 999;
    expect(source[0]).toBe(0);
  });

  it("truncates a fractional range exactly like its already-truncated equivalent — proving the wholeSampleRange refactor is a no-op (#473 round 3)", () => {
    expect(Array.from(sliceRange(seq(10), { start: 2.9, end: 6.1 }))).toEqual(
      Array.from(sliceRange(seq(10), { start: 2, end: 6 }))
    );
  });
});

describe("cut", () => {
  it("removes the range and returns what was removed", () => {
    const { remaining, removed } = cut(seq(10), { start: 3, end: 6 });
    expect(Array.from(remaining)).toEqual([0, 1, 2, 6, 7, 8, 9]);
    expect(Array.from(removed)).toEqual([3, 4, 5]);
  });

  it("is a no-op for an empty range", () => {
    const { remaining, removed } = cut(seq(4), { start: 2, end: 2 });
    expect(Array.from(remaining)).toEqual([0, 1, 2, 3]);
    expect(removed.length).toBe(0);
  });

  it("conserves total length", () => {
    const { remaining, removed } = cut(seq(100), { start: 10, end: 90 });
    expect(remaining.length + removed.length).toBe(100);
  });

  it("truncates a fractional range exactly like its already-truncated equivalent — proving the wholeSampleRange refactor is a no-op (#473 round 3)", () => {
    const fractional = cut(seq(10), { start: 2.9, end: 6.1 });
    const truncated = cut(seq(10), { start: 2, end: 6 });
    expect(Array.from(fractional.remaining)).toEqual(
      Array.from(truncated.remaining)
    );
    expect(Array.from(fractional.removed)).toEqual(
      Array.from(truncated.removed)
    );
  });
});

describe("insertAt", () => {
  it("splices audio into the middle", () => {
    const out = insertAt(seq(4), Int16Array.from([90, 91]), 2);
    expect(Array.from(out)).toEqual([0, 1, 90, 91, 2, 3]);
  });

  it("appends when the position is past the end", () => {
    const out = insertAt(seq(3), Int16Array.from([7]), 99);
    expect(Array.from(out)).toEqual([0, 1, 2, 7]);
  });

  it("prepends at position zero", () => {
    const out = insertAt(seq(2), Int16Array.from([7]), 0);
    expect(Array.from(out)).toEqual([7, 0, 1]);
  });
});

describe("insertAt as the record-at-centerline splice", () => {
  // B4 records at the centerline: the insertion offset is the sample under the
  // fixed line, and `insertAt(existing, recorded, offset)` is the whole commit.
  // Offset in the middle inserts; offset at/after the end appends. These are
  // the two branches the recorder depends on, named so a mutation that forces
  // one is a named death rather than a coincidence.
  const existing = seq(10);
  const recorded = Int16Array.from([80, 81, 82]);

  it("inserts the recording mid-clip when the centerline is inside the audio", () => {
    const out = insertAt(existing, recorded, 4);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 80, 81, 82, 4, 5, 6, 7, 8, 9]);
  });

  it("appends when the centerline is at the end", () => {
    const out = insertAt(existing, recorded, existing.length);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 80, 81, 82]);
  });

  it("is the first take when the segment is empty (offset 0, empty base)", () => {
    const out = insertAt(new Int16Array(0), recorded, 0);
    expect(Array.from(out)).toEqual([80, 81, 82]);
  });
});

describe("cut then paste", () => {
  it("round-trips back to the original when pasted at the cut point", () => {
    const original = seq(20);
    const { remaining, removed } = cut(original, { start: 5, end: 12 });
    const restored = insertAt(remaining, removed, 5);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});

describe("mergeTake", () => {
  it("splices a recording into the existing audio at the offset", () => {
    const out = mergeTake(seq(6), Int16Array.from([90, 91]), 3);
    expect(Array.from(out)).toEqual([0, 1, 2, 90, 91, 3, 4, 5]);
  });

  it("appends when the offset is at the end", () => {
    const out = mergeTake(seq(3), Int16Array.from([9]), 3);
    expect(Array.from(out)).toEqual([0, 1, 2, 9]);
  });

  it("returns the existing buffer itself when nothing was recorded (edit-only)", () => {
    // B5: `existing` is already the whole flattened edited buffer, so there is
    // no splice and no copy — the same reference comes back, not an equal copy.
    const existing = seq(4);
    const out = mergeTake(existing, new Int16Array(0), 0);
    expect(out).toBe(existing);
  });

  it("is a first take from an empty base and an empty recording", () => {
    // The offset is irrelevant when there is nothing to merge into or from.
    const out = mergeTake(new Int16Array(0), new Int16Array(0), 0);
    expect(out.length).toBe(0);
  });
});

describe("replaceRange", () => {
  it("swaps a span for new audio of a different length", () => {
    const out = replaceRange(
      seq(6),
      { start: 1, end: 4 },
      Int16Array.from([9])
    );
    expect(Array.from(out)).toEqual([0, 9, 4, 5]);
  });

  /**
   * #512 George R1 P3: `wholeSampleRange` was not actually "the ONE place" —
   * `replaceRange` still inserted at `clampRange`'s rounded (not truncated)
   * start after `cut()` had already truncated. `cut([2.6, 5))` removes
   * indices [2, 5) (`Int16Array.slice` truncates), leaving the replacement's
   * correct insertion point at 2 — but the pre-fix code inserted at
   * `Math.round(2.6) = 3`, landing the replacement one sample late.
   */
  it("inserts at the cut's TRUNCATED start, not `Math.round` of the raw fractional one (#512 George R1 P3)", () => {
    // seq(8) = [0,1,2,3,4,5,6,7]. cut([2.6,5)) truncates to [2,5), removing
    // 2,3,4 and leaving [0,1,5,6,7]. The replacement must land at index 2 —
    // right after 1, before the surviving 5 — not at index 3 (after 5).
    const out = replaceRange(
      seq(8),
      { start: 2.6, end: 5 },
      Int16Array.from([90])
    );
    expect(Array.from(out)).toEqual([0, 1, 90, 5, 6, 7]);
  });
});

describe("concat", () => {
  it("joins buffers end to end", () => {
    const out = concat([seq(2), seq(2, 10), seq(1, 20)]);
    expect(Array.from(out)).toEqual([0, 1, 10, 11, 20]);
  });

  it("returns an empty buffer for no inputs", () => {
    expect(concat([]).length).toBe(0);
  });
});

describe("silence", () => {
  it("is all zeroes", () => {
    const s = silence(5);
    expect(s.length).toBe(5);
    expect(Array.from(s).every((v) => v === 0)).toBe(true);
  });
});

/**
 * B8: every consumer of an MP3 decode fits it to the clip's recorded
 * `frameCount` (round-1 Frank F1 / George G3). A decoder that keeps LAME's
 * padding hands back ~1.1k extra samples; one that trims aggressively could hand
 * back fewer. Neither may change a segment's length.
 */
describe("fitToFrames", () => {
  const seq = (n: number) => Int16Array.from({ length: n }, (_, i) => i + 1);

  it("returns the same buffer when the length already matches", () => {
    const s = seq(5);
    expect(fitToFrames(s, 5)).toBe(s);
  });

  it("trims a longer decode to the first `frames` samples", () => {
    const fitted = fitToFrames(seq(1152 + 5), 5);
    expect(Array.from(fitted)).toEqual([1, 2, 3, 4, 5]);
  });

  it("pads a shorter decode with silence to `frames`", () => {
    const fitted = fitToFrames(seq(3), 5);
    expect(Array.from(fitted)).toEqual([1, 2, 3, 0, 0]);
  });

  it("fits to zero frames", () => {
    expect(fitToFrames(seq(3), 0).length).toBe(0);
  });

  it("rejects a non-integer or negative frame count", () => {
    expect(() => fitToFrames(seq(3), -1)).toThrow(RangeError);
    expect(() => fitToFrames(seq(3), 2.5)).toThrow(RangeError);
    expect(() => fitToFrames(seq(3), Number.NaN)).toThrow(RangeError);
  });
});
