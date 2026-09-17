import { describe, expect, it } from "vitest";

import { strings } from "@/components/strings";

/**
 * #400 (George, PR #398 round 1 P3) — `shareBookPartial(n)` pluralized
 * "chapters" off a count that is actually segments (`partialSegments`, the
 * sum of every included chapter's own `exportChapterMp3` `missing`, not a
 * count of chapters — `src/lib/export/book.ts`). A book with ONE chapter and
 * two missing segments read "2 segments were left out of chapters that were
 * otherwise included," implying more than one chapter when there was only
 * one — `gatherChapterPcm` can return `missing > 1` for a single chapter
 * (`tests/chapter-export.test.ts:121-134`, `:153-163`).
 *
 * A first fix kept "chapters" as a supposedly uncounted, generic noun, but
 * Frank's diff review (PR #423) caught that bare "chapters" still reads as
 * "more than one chapter" even when the book had exactly one included
 * chapter — the same defect the fix existed to remove. The chapter reference
 * is dropped entirely: nothing here actually knows how many distinct chapters
 * the missing segments came from, so no wording may imply a count.
 */
describe("strings.shareBookPartial", () => {
  it("never mentions a chapter count — only segment(s) varies with n", () => {
    expect(strings.shareBookPartial(1)).toBe(
      "1 segment could not be included."
    );
    expect(strings.shareBookPartial(2)).toBe(
      "2 segments could not be included."
    );
  });

  it("never names 'chapter(s)' at all (regression guard, #400/#423)", () => {
    // The wrong reading named "chapter(s)" and pluralized it to match `n`,
    // which reads as "more than one chapter" even when a single chapter held
    // every missing segment. Guard against the word reappearing at all.
    expect(strings.shareBookPartial(1)).not.toMatch(/chapter/i);
    expect(strings.shareBookPartial(2)).not.toMatch(/chapter/i);
  });
});
