import { describe, expect, it } from "vitest";

import { strings } from "@/components/strings";

/**
 * #400 (George, PR #398 round 1 P3) — `shareBookPartial(n)` pluralized
 * "chapters" off a count that is actually segments (`partialSegments`, the
 * sum of every included chapter's own `exportChapterMp3` `missing`, not a
 * count of chapters — `src/lib/export/book.ts`). A book with ONE chapter and
 * two missing segments reported "2 segments were left out of chapters that
 * were otherwise included," implying more than one chapter when there was
 * only one — `gatherChapterPcm` can return `missing > 1` for a single
 * chapter (`tests/chapter-export.test.ts:121-134`, `:153-163`).
 *
 * `chapter(s)` is a generic, uncounted reference to the set of included
 * chapters and must never vary with `n` — only `segment(s)` does.
 */
describe("strings.shareBookPartial", () => {
  it("keeps 'chapters' constant regardless of n — only segment(s) varies", () => {
    expect(strings.shareBookPartial(1)).toBe(
      "1 segment was left out of chapters that were otherwise included."
    );
    expect(strings.shareBookPartial(2)).toBe(
      "2 segments were left out of chapters that were otherwise included."
    );
  });

  it("never asserts a specific number of chapters (regression guard, #400)", () => {
    // The wrong reading pluralized "chapter" to match `n`, which reads as
    // "more than one chapter" even when a single chapter held every missing
    // segment. Guard against any digit-qualified "chapter(s)" appearing.
    expect(strings.shareBookPartial(1)).not.toMatch(/\d+ chapters?/);
    expect(strings.shareBookPartial(2)).not.toMatch(/\d+ chapters?/);
  });
});
