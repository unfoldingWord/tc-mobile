import { describe, expect, it } from "vitest";

import {
  headingNumber,
  highestSlot,
  slotOf,
  templateChapterNumber,
  withSlots,
} from "@/lib/chapter-slot";
import type { ChapterId } from "@/types/domain";

/**
 * #1272 B: a chapter's slot is its 1-based place among its book's resolvable
 * chapters. The chapters here are the scope's `[1, 4, 2, 3]` case: a moved
 * book whose stored numbers no longer equal its slots.
 */
const moved = [
  { id: "a" as ChapterId, number: 1 },
  { id: "d" as ChapterId, number: 4 },
  { id: "b" as ChapterId, number: 2 },
  { id: "c" as ChapterId, number: 3 },
];

describe("the chapter slot (#1272)", () => {
  it("numbers the chapters 1..N in book order, whatever they store", () => {
    expect(
      withSlots(moved).map(({ chapter, slot }) => [chapter.id, slot])
    ).toEqual([
      ["a", 1],
      ["d", 2],
      ["b", 3],
      ["c", 4],
    ]);
  });

  it("finds one chapter's slot, and none for a chapter the book does not list", () => {
    expect(slotOf(moved, "d" as ChapterId)).toBe(2);
    expect(slotOf(moved, "gone" as ChapterId)).toBeNull();
  });

  it("takes the highest slot from the count, not from a stored number", () => {
    expect(highestSlot([...moved, { id: "e" as ChapterId, number: 120 }])).toBe(
      5
    );
    expect(highestSlot([])).toBe(0);
  });

  it("reads the stored number only as a template's", () => {
    expect(templateChapterNumber({ number: 7, templateKey: "07" })).toBe(7);
    expect(templateChapterNumber({ number: 7, templateKey: null })).toBeNull();
  });
});

describe("headingNumber: the number in an unnamed chapter's title (#1272, Q1 (b))", () => {
  it("is the slot for a chapter added by hand", () => {
    expect(headingNumber(2, null, false)).toBe(2);
  });

  it("is the template's number for a template chapter, wherever it sits", () => {
    expect(headingNumber(2, 7, false)).toBe(7);
  });

  it("is the slot for every chapter with Always show chapter numbers on (S12)", () => {
    expect(headingNumber(2, 7, true)).toBe(2);
    expect(headingNumber(2, null, true)).toBe(2);
  });
});
