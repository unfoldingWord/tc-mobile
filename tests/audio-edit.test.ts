import { describe, expect, it } from "vitest";

import {
  clampRange,
  concat,
  cut,
  insertAt,
  replaceRange,
  silence,
  sliceRange,
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

describe("cut then paste", () => {
  it("round-trips back to the original when pasted at the cut point", () => {
    const original = seq(20);
    const { remaining, removed } = cut(original, { start: 5, end: 12 });
    const restored = insertAt(remaining, removed, 5);
    expect(Array.from(restored)).toEqual(Array.from(original));
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
