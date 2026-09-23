import { describe, expect, it } from "vitest";

import { strings } from "@/components/strings";

/**
 * #400 (George, PR #398 round 1 P3) — `shareBookPartial(n)` pluralized
 * "chapters" off a count that is actually segments (`partialSegments`, the
 * sum of every included chapter's own `exportChapterMp3` `missing`, not a
 * count of chapters — `src/lib/export/book.ts`). A book with ONE chapter and
 * two missing segments read "2 segments were left out of chapters that were
 * otherwise included," implying more than one chapter when there was only
 * one — `gatherChapterPcm` can return `missing > 1` for a single chapter,
 * the exact grain `tests/book-export.test.ts:238-254` pins (one chapter, two
 * never-recorded segments, `partialSegments === 2`) — George round 3 (#423
 * P3-4) caught that this comment used to point at `chapter-export.test.ts`
 * cases that are the wrong counter (a single `missing === 1` case, and a
 * whole-chapter miss, the opposite of `partialSegments`).
 *
 * A first fix kept "chapters" as a supposedly uncounted, generic noun, but
 * Frank's diff review (PR #423) caught that bare "chapters" still reads as
 * "more than one chapter" even when the book had exactly one included
 * chapter — the same defect the fix existed to remove. The chapter reference
 * is dropped entirely: nothing here actually knows how many distinct chapters
 * the missing segments came from, so no wording may imply a count.
 *
 * George round 2 (#423) then flagged that a second, standalone function
 * duplicating `shareMissing`'s wording byte-for-byte can drift on the next
 * copy edit (only one of the two would get pinned and updated). Fixed by
 * making `shareBookPartial` an alias of `shareMissing` so both grains stay
 * one wording, pinned by equality rather than by a duplicated literal.
 */
describe("strings.shareBookPartial", () => {
  it("is the same wording as shareMissing — one wording, not a duplicate", () => {
    expect(strings.shareBookPartial(1)).toBe(strings.shareMissing(1));
    expect(strings.shareBookPartial(2)).toBe(strings.shareMissing(2));
  });

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

/**
 * George (#423 round 1 P3) — once `shareBookPartial` became the `shareMissing`
 * twin, the combined composer's plain concatenation lost the export invariant
 * that a chapter counts toward at most one of `missing` and `partialSegments`
 * (`src/lib/export/book.ts`). "1 chapter could not be included. 1 segment
 * could not be included." reads as either double-counting the omitted
 * chapter's own gap, or as an unrelated, under-counted hole.
 *
 * George round 2 then found the round-1 fix's `segments === 1` clause used
 * maintainer vocabulary that collides with unchanged contracts: "shipped"
 * reads as past-tense send on a menu that is only `ready` and still shows
 * "Share now" (`shareSend`), and "was left out" implies a deliberate omit,
 * against `shareMissing`'s cause-neutrality comment (the counts also include
 * dangling takes and half-missing clips, never a translator's choice to
 * omit). Fixed by keeping the chapter-scope disambiguation (one missing
 * segment is always exactly one included chapter) but switching to the
 * table's own verbs — "could not be included" — rather than "shipped" /
 * "was left out".
 *
 * George round 2 also found the `segments > 1` clause still concatenates two
 * identically-shaped "could not be included" sentences — the exact ambiguity
 * the n===1 clause exists to prevent. Fixed with "additional".
 *
 * George round 3 (#423 P2) then found "additional" alone still drops the
 * producer invariant `book.ts` guarantees: `partialSegments` only ever comes
 * from chapters that DID make it into the zip. A book with one chapter
 * partial (two never-recorded segments) and a second chapter never recorded
 * at all reports `missing === 1`, `partialSegments === 2`; "2 additional
 * segments could not be included" does not say those two segments sit in a
 * chapter that shipped, so a translator could read both facts as about the
 * one omitted chapter and never look at the one that has holes. Fixed with
 * an uncounted locator, "of included audio", that cannot pluralize "chapter"
 * off `n` — mirroring the n===1 clause's own disambiguation without naming a
 * count nothing here tracked.
 *
 * #446 then gave the producer that count: `exportBookZip` reports
 * `partialChapters`, the distinct included chapters holding the gaps, and
 * the clause names it ("of an included chapter" / "of N included chapters").
 * "additional" is dropped with the hedge: the counted locator already keeps
 * the second sentence from reading as a restatement of the first.
 */
describe("strings.shareBookMissingAndPartial", () => {
  it("scopes the n===1 partial segment to an included chapter, in cause-neutral wording", () => {
    expect(strings.shareBookMissingAndPartial(1, 1, 1)).toBe(
      "1 chapter could not be included. 1 segment of an included chapter could not be included."
    );
  });

  it("does not use maintainer vocabulary ('shipped', 'left out') anywhere in the combined string", () => {
    // "shipped" reads as past-tense send while the share menu is only `ready`
    // (Share now hasn't been tapped); "left out" implies a deliberate omit,
    // against `shareMissing`'s cause-neutrality contract (George R2 P2).
    for (const [c, s, p] of [
      [1, 1, 1],
      [1, 2, 1],
      [1, 2, 2],
    ] as const) {
      const text = strings.shareBookMissingAndPartial(c, s, p);
      expect(text).not.toMatch(/shipped/i);
      expect(text).not.toMatch(/left out/i);
    }
  });

  /**
   * #446 — the `n > 1` clause names the chapters that hold the gaps from the
   * producer's own `partialChapters` count. Before it existed the clause
   * hedged with "of included audio", because `(chapters, segments)` alone
   * cannot say whether two gaps sit in one chapter or two.
   */
  it("names ONE included chapter when every gap sits in one, whatever the segment count (#446)", () => {
    expect(strings.shareBookMissingAndPartial(1, 2, 1)).toBe(
      "1 chapter could not be included. 2 segments of an included chapter could not be included."
    );
    expect(strings.shareBookMissingAndPartial(2, 5, 1)).toBe(
      "2 chapters could not be included. 5 segments of an included chapter could not be included."
    );
  });

  it("names how many included chapters hold the gaps when there are several (#446)", () => {
    expect(strings.shareBookMissingAndPartial(1, 2, 2)).toBe(
      "1 chapter could not be included. 2 segments of 2 included chapters could not be included."
    );
    expect(strings.shareBookMissingAndPartial(2, 5, 3)).toBe(
      "2 chapters could not be included. 5 segments of 3 included chapters could not be included."
    );
  });

  it("counts chapters off partialChapters, never off the segment sum (regression guard, #400/#423)", () => {
    // The #400 bug pluralized "chapter" off `segments`. The second clause is
    // asserted directly: its chapter wording must follow `partialChapters`
    // and ignore `segments`, including the bare-plural form "of included
    // chapters" that the old `/\d+ chapters? of/` guard could not see.
    const second = (c: number, s: number, p: number) =>
      strings
        .shareBookMissingAndPartial(c, s, p)
        .slice(strings.shareBookMissing(c).length + 1);
    expect(second(1, 3, 1)).not.toMatch(/chapters/i);
    expect(second(1, 3, 1)).toMatch(/of an included chapter /);
    expect(second(1, 3, 2)).toMatch(/of 2 included chapters /);
    expect(second(1, 3, 2)).not.toMatch(/\b3 included/);
  });
});

/**
 * #446 (folded in from George #423 round 4): the empty shelf's teaching line
 * shows on a first launch and on an origin that emptied its shelf after
 * `persist()` was granted, so it must stay vocabulary-only — no durability
 * claim (#406 item 3 removed "unless space runs low").
 */
describe("strings.booksEmptyTeach", () => {
  it("makes no durability or offline claim", () => {
    expect(strings.booksEmptyTeach).not.toMatch(
      /stay|phone|offline|space runs low/i
    );
  });
});
