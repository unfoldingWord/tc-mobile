import { describe, expect, it } from "vitest";

import { formatScope, isValidScope, parseScope } from "./scope";

describe("parseScope", () => {
  it("treats the empty scope as the whole book", () => {
    expect(parseScope("")).toBeNull();
    expect(parseScope("   ")).toBeNull();
  });

  it("parses a whole chapter", () => {
    expect(parseScope("2")).toEqual({
      startChapter: 2,
      startVerse: null,
      endChapter: 2,
      endVerse: null,
    });
  });

  it("parses a chapter range", () => {
    expect(parseScope("2-4")).toEqual({
      startChapter: 2,
      startVerse: null,
      endChapter: 4,
      endVerse: null,
    });
  });

  it("parses a single verse", () => {
    expect(parseScope("2:1")).toEqual({
      startChapter: 2,
      startVerse: 1,
      endChapter: 2,
      endVerse: 1,
    });
  });

  it("reads a bare number after the dash as a verse, not a chapter", () => {
    // "2:1-13" is Ruth 2:1-13, not Ruth 2:1 through chapter 13.
    expect(parseScope("2:1-13")).toEqual({
      startChapter: 2,
      startVerse: 1,
      endChapter: 2,
      endVerse: 13,
    });
  });

  it("parses a cross-chapter span", () => {
    expect(parseScope("1:5-2:3")).toEqual({
      startChapter: 1,
      startVerse: 5,
      endChapter: 2,
      endVerse: 3,
    });
  });

  it("throws rather than guessing at malformed input", () => {
    for (const bad of ["x", "2:", "-3", "1-2-3", "2:a", "1:2-3:4-5"]) {
      expect(() => parseScope(bad), bad).toThrow();
    }
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => parseScope("4-2")).toThrow(/ends before/);
    expect(() => parseScope("2:10-3")).toThrow(/ends before/);
  });
});

describe("isValidScope", () => {
  it("accepts the real-world APM scopes", () => {
    for (const good of ["", "2:1-13", "2:14-22", "1", "1-3", "1:5-2:3"]) {
      expect(isValidScope(good), good).toBe(true);
    }
  });

  it("rejects nonsense without throwing", () => {
    expect(isValidScope("nope")).toBe(false);
  });
});

describe("formatScope round trip", () => {
  it("returns the canonical string for every supported form", () => {
    for (const scope of ["", "2", "2-4", "2:1", "2:1-13", "1:5-2:3"]) {
      expect(formatScope(parseScope(scope)), scope).toBe(scope);
    }
  });
});
