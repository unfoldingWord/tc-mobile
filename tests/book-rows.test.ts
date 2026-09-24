import { describe, expect, it } from "vitest";

import { hasReclaimableAudio } from "@/lib/view/book-rows";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * `hasReclaimableAudio` — #542 Part B (DRI decision, 2026-09-24): the
 * storage-pressure line's gate, strengthened from "the shelf holds at least
 * one book" (`hasContent`) to "at least one segment, anywhere on the shelf,
 * holds a recorded take". The predicate `storagePressureNotice` now retracts
 * the line on, replacing `hasContent` (`tests/storage-pressure-notice.test.ts`
 * pins the retraction itself; this file pins the predicate that feeds it).
 *
 * THE case that distinguishes the two predicates, and the one a reviewer
 * should check first: a book (and a chapter) that exist but hold zero
 * recordings. `books.length > 0` reads `true` there; `hasReclaimableAudio`
 * must read `false` (#542).
 */

const bookId = (n: number) => `book-${n}` as BookId;
const chapterId = (n: number) => `chapter-${n}` as ChapterId;

const chapter = (recordedCount: number, n = 1): ChapterRow => ({
  chapterId: chapterId(n),
  number: n,
  name: null,
  finishedCount: 0,
  totalCount: 1,
  recordedCount,
});

const book = (n: number, chapters: readonly ChapterRow[] = []): BookCard => ({
  bookId: bookId(n),
  name: `Book ${n}`,
  chapters,
});

describe("hasReclaimableAudio", () => {
  it("is false for an empty shelf", () => {
    expect(hasReclaimableAudio([])).toBe(false);
  });

  it("is false for a book with no chapters", () => {
    expect(hasReclaimableAudio([book(1, [])])).toBe(false);
  });

  it("is false for a book with a chapter that has never been recorded — the exact case `hasContent` (books.length > 0) could not distinguish", () => {
    expect(hasReclaimableAudio([book(1, [chapter(0)])])).toBe(false);
  });

  it("is false across MULTIPLE books and chapters, none of them recorded", () => {
    expect(
      hasReclaimableAudio([
        book(1, [chapter(0, 1), chapter(0, 2)]),
        book(2, [chapter(0, 3)]),
      ])
    ).toBe(false);
  });

  it("is true when exactly one segment, in one chapter, holds a recording", () => {
    expect(hasReclaimableAudio([book(1, [chapter(1)])])).toBe(true);
  });

  it("is true when the recorded chapter is not the shelf's first book or first chapter", () => {
    // Guards against a short-circuit that only checks the first book/chapter.
    expect(
      hasReclaimableAudio([
        book(1, [chapter(0, 1)]),
        book(2, [chapter(0, 2), chapter(3, 3)]),
      ])
    ).toBe(true);
  });

  it("is true for a recorded-but-unfinished ('draft') segment, not only a finished one", () => {
    // `recordedCount` counts `activeTakeId !== null`, independent of
    // `finishedCount` — a draft take has reclaimable bytes behind it.
    // `chapter()`'s `finishedCount: 0` fixture already models this; asserted
    // explicitly here so the distinction is not only implicit in the fixture.
    const draftChapter: ChapterRow = {
      ...chapter(1),
      finishedCount: 0,
    };
    expect(hasReclaimableAudio([book(1, [draftChapter])])).toBe(true);
  });
});
