import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { strings } from "@/lib/strings";

import { stripCodeComments } from "./strip-code-comments";

/**
 * The count-varying labels, pinned at the wording they render.
 *
 * Written before `plural` replaced the `n === 1` ternaries behind them (#169)
 * and unchanged by that move: every sentence below is byte-for-byte what the
 * ternaries produced, which is the whole claim the refactor makes. Mutating
 * either side of any form — the singular or the plural — fails a case here.
 *
 * `shareMissing`, `shareBookPartial` and `shareBookMissingAndPartial` are
 * pinned in `tests/share-book-partial-copy.test.ts` instead, where the reasons
 * their wording is what it is already live (#400, #423). `shareItemsGoOut` is
 * pinned in `tests/share-progress-o4-render.test.ts`, beside the render that
 * carries it. The four here had no pin at all.
 */
describe("count-varying strings", () => {
  describe("bookRow", () => {
    it("agrees the chapter count with the noun", () => {
      expect(strings.bookRow("Mark", 1, false)).toBe(
        "Mark, 1 chapter, collapsed"
      );
      expect(strings.bookRow("Mark", 2, false)).toBe(
        "Mark, 2 chapters, collapsed"
      );
    });

    it("says 'chapters' for an empty book, not 'chapter'", () => {
      expect(strings.bookRow("Mark", 0, true)).toBe(
        "Mark, 0 chapters, expanded"
      );
    });
  });

  describe("shareBookMissing", () => {
    it("counts whole chapters left out of the zip", () => {
      expect(strings.shareBookMissing(1)).toBe(
        "1 chapter could not be included."
      );
      expect(strings.shareBookMissing(3)).toBe(
        "3 chapters could not be included."
      );
    });
  });

  describe("failuresMarker", () => {
    it("agrees the problem count with the noun", () => {
      expect(strings.failuresMarker(1)).toBe("1 problem recorded");
      expect(strings.failuresMarker(4)).toBe("4 problems recorded");
    });
  });

  describe("menuOpenWithFailures", () => {
    it("names the same count the marker does, in a sentence", () => {
      expect(strings.menuOpenWithFailures(1)).toBe(
        "Open menu. 1 problem recorded."
      );
      expect(strings.menuOpenWithFailures(4)).toBe(
        "Open menu. 4 problems recorded."
      );
    });

    /**
     * The two used to spell the phrase out separately — byte-identical, so a
     * later edit to one would have left the other saying something else about
     * the same number. Same defect class the strings gate in #600 exists to
     * catch, caught here by construction instead.
     */
    it("is the marker's own wording, not a second copy of it", () => {
      for (const n of [1, 2, 4]) {
        expect(strings.menuOpenWithFailures(n)).toBe(
          `Open menu. ${strings.failuresMarker(n)}.`
        );
      }
    });
  });
});

/**
 * No count in the table is split by an English ternary (#169).
 *
 * The cases above pin what each count-varying label SAYS; none of them can
 * see HOW it chooses. `shareBookMissingAndPartial`'s chapter clause kept a
 * `partialChapters > 1 ? ... : ...` split after the rest moved to `plural`,
 * with its wording pinned and green the whole time, because an English
 * ternary and `plural` agree in English. They stop agreeing in the first
 * locale with a third count form, which is what a second table is for.
 *
 * So this reads the source. A comparison against 1 (or `< 2` / `>= 2`, the
 * same split) directly ahead of `?` is the English one/other rule written at
 * a call site. A comparison against 0 is not — "is there anything" is not a
 * plural form — so `n > 0 ? ...` stays allowed. Comments are removed by the
 * parsing strip first, so prose that quotes the old shape (this repo's
 * docblocks do) neither trips the check nor could satisfy it.
 */
const COUNT_TERNARY = /(?:===|!==|<=|>)\s*1\b\s*\?|(?:<|>=)\s*2\b\s*\?/;

describe("the table splits no count by an English ternary (#169)", () => {
  const file = path.resolve(import.meta.dirname, "../src/lib/strings.ts");
  const code = stripCodeComments(readFileSync(file, "utf8"), file);

  it("reads the table's code", () => {
    // Floor: an empty or wrong read would pass the negated check below.
    expect(code).toContain("export const strings");
    expect(code).toContain("plural(");
  });

  it("has no one/other ternary left in lib/strings.ts", () => {
    expect(code.match(COUNT_TERNARY)?.[0] ?? null).toBeNull();
  });

  it("catches each spelling of the split, across a line break, and not a zero test", () => {
    for (const probe of [
      "n === 1 ? a : b",
      "n !== 1 ? a : b",
      "n > 1\n  ? a\n  : b",
      "n <= 1 ? a : b",
      "n < 2 ? a : b",
      "n >= 2 ? a : b",
    ]) {
      expect(probe, probe).toMatch(COUNT_TERNARY);
    }
    for (const probe of [
      "n > 0 ? a : b",
      "n === 10 ? a : b",
      "n > 12 ? a : b",
    ]) {
      expect(probe, probe).not.toMatch(COUNT_TERNARY);
    }
  });

  it("does not see a ternary that only a comment carries", () => {
    const probe = stripCodeComments(
      "// n === 1 ? a : b\nconst x = /* n > 1 ? a : b */ 0; // n < 2 ? a : b\n",
      "probe.ts"
    );
    expect(probe).toContain("const x");
    expect(probe).not.toMatch(COUNT_TERNARY);
  });
});

/**
 * "Exactly one" is not a plural category (#169, Frank's P2 on #1226).
 *
 * `strings.ts` is English-only, so no render-level case can show the
 * chapter clause misbehaving in Russian; the behaviour is pinned in
 * `tests/plural.test.ts` (the `"=1"` arm at 21/31/101 in ru, uk, lt). What this
 * pins is the table's side: the exact-1 wording sits under `"=1"`, and
 * the `one` key never carries it. The clause is a `plural` call with an
 * exact arm, not a ternary, so `COUNT_TERNARY` above needs no exemption.
 */
describe("the chapter clause keeps `exactly one` off the `one` category (#169)", () => {
  const file = path.resolve(import.meta.dirname, "../src/lib/strings.ts");
  const code = stripCodeComments(readFileSync(file, "utf8"), file);

  it("carries the exact-1 wording under `=1`", () => {
    expect(code).toMatch(/"=1":\s*"an included chapter"/);
  });

  it("does not key that wording off `one`", () => {
    expect(code).not.toMatch(/\bone:\s*"an included chapter"/);
  });
});
