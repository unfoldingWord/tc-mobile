import { describe, expect, it, vi } from "vitest";

import { dropBookCard, reportUnlessStale } from "@/hooks/use-books";
import type { BookId } from "@/types/domain";
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
