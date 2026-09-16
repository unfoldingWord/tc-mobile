import { describe, expect, it, vi } from "vitest";

import {
  canStartAddChapter,
  dropBookCard,
  isLoadCurrent,
  patchNewChapter,
  reportUnlessStale,
} from "@/hooks/use-books";
import type { BookId, Chapter, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * `reportUnlessStale` is the plain-async decision `renameBook`/`addChapter`'s
 * catch blocks call before reporting a failure: is this a stale race with an
 * unrelated, already-successful delete (`isStaleBookFailure`, PR #344 round 8),
 * or a genuine failure the screen must speak? It takes its store read as an
 * injected `checkPresent` — the same seam this repo already uses to test the
 * encoder boundary (`AudioCodec`) — so its own failure path (Frank's round-9
 * finding: an unguarded second IndexedDB read could turn a HANDLED mutation
 * failure into an unhandled rejection) can be pinned here without a failing
 * IndexedDB. This is the whole of the decision; the React state (`report`'s
 * actual `setFailure` wiring, and the caller's `reload()` on a swallow) is
 * review + on-device surface, as with `use-erase-segment.test.ts`.
 *
 * The `{ swallowed }` return (round 10) is what lets a caller `reload()` when
 * this suppresses a stale race: George, PR #344 round 9 — a swallow means
 * IndexedDB has already moved (an unrelated delete, possibly from a second
 * tab or a pre-`autoUpdate` page, `db.ts`'s designed-for two-copy shape), and
 * leaving `books` untouched treats React state as the source of truth instead
 * of IndexedDB's cache of it. Before this, the flag did not exist and no
 * caller could tell a swallow from a report.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;

describe("reportUnlessStale", () => {
  it("reports the ORIGINAL mutation failure, and resolves, when the stale-check read itself fails", async () => {
    // Frank, PR #344 round 9: before this guard, a rejecting `checkPresent`
    // propagated out of `reportUnlessStale` — the mutation's own catch never
    // got to `report` at all, and `addChapter`/`renameBook` rejected instead
    // of resolving to `null`. Both halves are asserted: the call resolves
    // (as a REPORT, not a swallow — a caller must not reload on this path),
    // and it reports the mutation's cause, not the read's.
    const cause = new Error("addChapter failed: quota exceeded");
    const report = vi.fn();
    const checkPresent = vi
      .fn()
      .mockRejectedValue(new Error("IDB unavailable"));

    await expect(
      reportUnlessStale(cause, bookId, report, checkPresent)
    ).resolves.toEqual({ swallowed: false });

    expect(report).toHaveBeenCalledExactlyOnceWith(cause);
  });

  it("reports as-is when the book is still present, and signals NOT swallowed", () => {
    const cause = new Error(`No such book: ${bookId}`);
    const report = vi.fn();
    const checkPresent = vi.fn().mockResolvedValue(true);

    return reportUnlessStale(cause, bookId, report, checkPresent).then(
      (result) => {
        expect(result).toEqual({ swallowed: false });
        expect(report).toHaveBeenCalledExactlyOnceWith(cause);
      }
    );
  });

  it("suppresses the exact stale race AND signals the swallow, so the caller reloads (George #344 R9)", async () => {
    // The round-9 finding, as data: swallowing without signalling left
    // `books` unreconciled after a second tab or a pre-`autoUpdate` page
    // deleted this exact book. The caller (`addChapter`/`renameBook` in
    // `use-books.ts`) reloads on `swallowed: true` — that half is DOM/React
    // wiring this Node suite cannot drive, but the flag it decides on is
    // asserted here, and reverting it to a bare swallow-with-no-signal is
    // exactly the regression this case exists to catch.
    const cause = new Error(`No such book: ${bookId}`);
    const report = vi.fn();
    const checkPresent = vi.fn().mockResolvedValue(false);

    const result = await reportUnlessStale(cause, bookId, report, checkPresent);

    expect(result).toEqual({ swallowed: true });
    expect(report).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated failure just because the book is gone", async () => {
    const cause = new Error("quota exceeded");
    const report = vi.fn();
    const checkPresent = vi.fn().mockResolvedValue(false);

    const result = await reportUnlessStale(cause, bookId, report, checkPresent);

    expect(result).toEqual({ swallowed: false });
    expect(report).toHaveBeenCalledExactlyOnceWith(cause);
  });
});

const card = (id: string, name = id): BookCard => ({
  bookId: id as BookId,
  name,
  chapters: [],
});

/**
 * `dropBookCard` is the "next books" decision `addChapter`/`renameBook`'s
 * catch blocks now apply to `books` state on a `reportUnlessStale` swallow
 * (PR #344 round 11, George round 10 P2-1): `reload()` alone left the ghost
 * row tappable until the async `loadBookCards` read landed, and a chapter tap
 * into it reached the unchanged Segments loader, which throws `No such
 * chapter`. `deleteBook`'s own success path already patched `books` this way
 * for exactly that reason; this pins the shared decision in plain Node,
 * since the `setBooks` wiring around it is React state a Node suite cannot
 * drive (see the file-level comment above).
 */
describe("dropBookCard", () => {
  it("removes exactly the named book's card, keeping the others and their order", () => {
    const books = [card("book-a"), card("book-b"), card("book-c")];

    expect(dropBookCard(books, "book-b" as BookId)).toEqual([
      card("book-a"),
      card("book-c"),
    ]);
  });

  it("is a no-op when the id is not on the shelf", () => {
    const books = [card("book-a")];

    expect(dropBookCard(books, "book-x" as BookId)).toEqual(books);
  });

  it("empties the shelf when it names the only book", () => {
    expect(dropBookCard([card("book-a")], "book-a" as BookId)).toEqual([]);
  });
});

/**
 * `useBooks`'s Add-chapter and optimistic-patch paths, minus React (no
 * jsdom, no renderer — the same constraint `tests/use-erase-segment.test.ts`
 * documents). What is Node-testable here is three pure decisions the hook's
 * `addChapter`/`createBook`/load effect were missing:
 *
 * - the fold that patches a new chapter onto its book's card in the same
 *   turn as the write;
 * - the guard that a second tap for the same book while the first is in
 *   flight must not proceed (George R3/R4 P2 — "Create success now focuses
 *   an unlatched, non-optimistic Add-chapter control; extra chapters cannot
 *   be deleted"); and
 * - the generation check that stops a load which started before an
 *   optimistic patch from overwriting it after the fact (George R4 P2-2).
 *
 * `addingChapterFor` and `loadGen`, the refs that HOLD these guards, are
 * React state and are review + on-device surface, same as `creatingBook`
 * and `useEraseSegment`'s own double-tap ref.
 */

const chapterBookId = (s: string): BookId => s as BookId;
const chapterId = (s: string): ChapterId => s as ChapterId;

const chapterCard = (
  bookId_: BookId,
  chapters: BookCard["chapters"] = []
): BookCard => ({
  bookId: bookId_,
  name: `Book ${bookId_}`,
  chapters,
});

const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: chapterId("ch-1"),
  bookId: chapterBookId("b-1"),
  number: 1,
  name: null,
  segmentIds: [],
  ...overrides,
});

describe("patchNewChapter", () => {
  it("appends the new chapter as a zero-progress row on its own book's card", () => {
    const books = [chapterCard(chapterBookId("b-1")), chapterCard(chapterBookId("b-2"))];
    const next = patchNewChapter(books, chapterBookId("b-1"), chapter());

    expect(next[0]?.chapters).toEqual([
      {
        chapterId: chapterId("ch-1"),
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 0,
      },
    ]);
    // The other book's card is untouched — same array reference, even.
    expect(next[1]).toBe(books[1]);
  });

  it("appends after any existing chapters, preserving chapter order", () => {
    const existing = [
      {
        chapterId: chapterId("ch-0"),
        number: 1,
        name: null,
        finishedCount: 2,
        totalCount: 2,
      },
    ];
    const books = [chapterCard(chapterBookId("b-1"), existing)];
    const next = patchNewChapter(
      books,
      chapterBookId("b-1"),
      chapter({ id: chapterId("ch-1"), number: 2 })
    );

    expect(next[0]?.chapters.map((c) => c.chapterId)).toEqual([
      chapterId("ch-0"),
      chapterId("ch-1"),
    ]);
  });

  it("is a no-op when the chapter's book is not on the shelf (a stale card)", () => {
    const books = [chapterCard(chapterBookId("b-2"))];
    const next = patchNewChapter(books, chapterBookId("b-1"), chapter());
    expect(next).toEqual(books);
  });

  it("moves the patched book to the front of the shelf, matching the updatedAt bump the write already made (Frank R5 P2)", () => {
    // `addChapterToBook` bumps the parent book's `updatedAt` in the same
    // write, and `listBooks` sorts newest-first — with `reload()` gone
    // (George R4 P2-2), nothing else reconciles the shelf order, so the
    // patch itself has to move the book, not just append its chapter.
    const books = [card(bookId("b-1")), card(bookId("b-2"))];
    const next = patchNewChapter(
      books,
      bookId("b-2"),
      chapter({ id: chapterId("ch-9"), bookId: bookId("b-2") })
    );

    expect(next.map((c) => c.bookId)).toEqual([bookId("b-2"), bookId("b-1")]);
    expect(next[0]?.chapters).toEqual([
      {
        chapterId: chapterId("ch-9"),
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 0,
      },
    ]);
    // The untouched book keeps its own identity, just shifted in position.
    expect(next[1]).toBe(books[0]);
  });
});

describe("canStartAddChapter", () => {
  it("allows a tap when nothing is in flight for that book", () => {
    expect(canStartAddChapter(new Set(), chapterBookId("b-1"))).toBe(true);
  });

  it("swallows a second tap for the SAME book while the first is in flight", () => {
    const inFlight = new Set([chapterBookId("b-1")]);
    expect(canStartAddChapter(inFlight, chapterBookId("b-1"))).toBe(false);
  });

  it("does not block a different book's Add-chapter tap", () => {
    const inFlight = new Set([chapterBookId("b-1")]);
    expect(canStartAddChapter(inFlight, chapterBookId("b-2"))).toBe(true);
  });
});

describe("isLoadCurrent", () => {
  it("is current when nothing has bumped the generation since the load started", () => {
    expect(isLoadCurrent(3, 3)).toBe(true);
  });

  it("is stale once an optimistic patch (or a newer load) has bumped the generation", () => {
    // `startedAt` is what a load captured when it began; `current` has since
    // moved on — a `createBook`/`addChapter` patch, or a later load's own
    // start, both bump it the same way (George R4 P2-2).
    expect(isLoadCurrent(3, 4)).toBe(false);
  });

  it("a load started before ANY patch is stale even against a much later generation", () => {
    expect(isLoadCurrent(0, 5)).toBe(false);
  });
});
