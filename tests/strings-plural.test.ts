import { describe, expect, it } from "vitest";

import { strings } from "@/components/strings";

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
 * their wording is what it is already live (#400, #423). The four here had no
 * pin at all.
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
