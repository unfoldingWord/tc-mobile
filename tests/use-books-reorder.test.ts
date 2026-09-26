import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { patchMovedChapter, useBooks } from "@/hooks/use-books";
import { reportFailure } from "@/hooks/report-failure";
import {
  addChapter,
  chapterProgress,
  createBook,
  getBook,
  listBooks,
  moveChapter,
} from "@/lib/storage/books";
import type { Book, BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";
import { clearAllStores } from "./support";

/**
 * `useBooks().moveChapter` (#953 PR1) — the hook half of chapter reorder.
 *
 * The hook runs for real over fake-indexeddb (the `segment-rename-failure`
 * harness); the store's `moveChapter` and `listBooks` are wrapped so a test
 * can make one reject or hold. The gesture that calls this is PR2.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    listBooks: vi.fn(actual.listBooks),
    chapterProgress: vi.fn(actual.chapterProgress),
    moveChapter: vi.fn(actual.moveChapter),
  };
});

const row = (id: string, number: number): ChapterRow => ({
  chapterId: id as ChapterId,
  number,
  name: null,
  finishedCount: 0,
  totalCount: 0,
  recordedCount: 0,
});
const card = (id: string, chapters: ChapterRow[]): BookCard => ({
  bookId: id as BookId,
  name: id,
  chapters,
  coverColourKey: null,
});

describe("patchMovedChapter", () => {
  const shelf = [
    card("first", [row("a", 1)]),
    card("second", [row("b", 1), row("c", 2), row("d", 3)]),
  ];

  it("moves the row within its card and renumbers the badges densely", () => {
    const next = patchMovedChapter(shelf, "d" as ChapterId, 0);
    expect(next[1]!.chapters.map((r) => [r.chapterId, r.number])).toEqual([
      ["d", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("leaves the card where it is on the shelf (no recency bump)", () => {
    const next = patchMovedChapter(shelf, "d" as ChapterId, 0);
    expect(next.map((c) => c.bookId)).toEqual(["first", "second"]);
    expect(next[0]).toBe(shelf[0]);
  });

  it("returns the shelf itself for a drop where it started, or an unknown row", () => {
    expect(patchMovedChapter(shelf, "c" as ChapterId, 1)).toBe(shelf);
    expect(patchMovedChapter(shelf, "zz" as ChapterId, 0)).toBe(shelf);
  });
});

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useBooks> | null } = {
  current: null,
};

function Probe() {
  const result = useBooks();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

/** Two books; the OLDER one (not at the front of the shelf) has 3 chapters. */
async function mountShelf(): Promise<{
  bookId: BookId;
  chapterIds: ChapterId[];
}> {
  const book = await createBook("Mark");
  const chapterIds: ChapterId[] = [];
  for (let i = 0; i < 3; i++) chapterIds.push((await addChapter(book.id)).id);
  await createBook("Luke");
  await act(async () => {
    root.render(createElement(Probe));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  return { bookId: book.id, chapterIds };
}

const rowsOf = (bookId: BookId) =>
  hook()
    .books.find((c) => c.bookId === bookId)!
    .chapters.map((r) => [r.chapterId, r.number]);

describe("useBooks().moveChapter (#953)", () => {
  it("moves and renumbers the rows, writes the store, and keeps the shelf order", async () => {
    const { bookId, chapterIds } = await mountShelf();
    const [c1, c2, c3] = chapterIds as [ChapterId, ChapterId, ChapterId];
    const shelfBefore = hook().books.map((c) => c.bookId);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().moveChapter(c3, 0);
    });

    expect(ok).toBe(true);
    await vi.waitFor(() =>
      expect(rowsOf(bookId)).toEqual([
        [c3, 1],
        [c1, 2],
        [c2, 3],
      ])
    );
    expect((await getBook(bookId))!.chapterIds).toEqual([c3, c1, c2]);
    expect(hook().books.map((c) => c.bookId)).toEqual(shelfBefore);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reconciles with the store's order when another copy moved a chapter first", async () => {
    const { bookId, chapterIds } = await mountShelf();
    const [c1, c2, c3] = chapterIds as [ChapterId, ChapterId, ChapterId];
    const real = (
      await vi.importActual<typeof import("@/lib/storage/books")>(
        "@/lib/storage/books"
      )
    ).moveChapter;
    // A second copy moves c1 to the end; this shelf still shows [c1, c2, c3].
    await real(c1, 2);

    await act(async () => {
      await hook().moveChapter(c3, 0);
    });

    // The store applied c3 -> 0 to ITS order [c2, c3, c1]: [c3, c2, c1].
    await vi.waitFor(() =>
      expect(rowsOf(bookId)).toEqual([
        [c3, 1],
        [c2, 2],
        [c1, 3],
      ])
    );
  });

  // George round 1 #2 (bench fix): a non-integer target is refused before
  // the generation or the shelf is touched, not thrown from an updater.
  it("refuses a non-integer target without touching the shelf", async () => {
    const { bookId, chapterIds } = await mountShelf();
    const [c1, c2, c3] = chapterIds as [ChapterId, ChapterId, ChapterId];

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().moveChapter(c3, Number.NaN);
    });

    expect(ok).toBe(false);
    expect(moveChapter).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(RangeError),
      "chapter-reorder"
    );
    expect(rowsOf(bookId)).toEqual([
      [c1, 1],
      [c2, 2],
      [c3, 3],
    ]);
  });

  it("reports a failed move as chapter-reorder, shows nothing, and restores the stored order", async () => {
    const { bookId, chapterIds } = await mountShelf();
    const [c1, c2, c3] = chapterIds as [ChapterId, ChapterId, ChapterId];
    const cause = new Error("UnknownError: the transaction was aborted");
    vi.mocked(moveChapter).mockRejectedValueOnce(cause);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().moveChapter(c3, 0);
    });

    expect(ok).toBe(false);
    expect(reportFailure).toHaveBeenCalledWith(cause, "chapter-reorder");
    // Nothing extra on screen (#172): the shared Notice slot stays empty.
    expect(hook().error).toBeNull();
    await vi.waitFor(() =>
      expect(rowsOf(bookId)).toEqual([
        [c1, 1],
        [c2, 2],
        [c3, 3],
      ])
    );
  });

  it("does not let a load that read the pre-move shelf snap the row back", async () => {
    const { bookId, chapterIds } = await mountShelf();
    const [c1, c2, c3] = chapterIds as [ChapterId, ChapterId, ChapterId];

    // A reload is in flight, holding a shelf read taken BEFORE the move.
    const stale = await listBooks();
    let releaseLoad!: (books: Book[]) => void;
    vi.mocked(listBooks).mockImplementationOnce(
      () => new Promise<Book[]>((resolve) => (releaseLoad = resolve))
    );
    await act(async () => {
      hook().reload();
    });
    await vi.waitFor(() => expect(releaseLoad).toBeDefined());

    // The write is held too, so the only thing on screen is the patch.
    let releaseWrite!: () => void;
    const real = (
      await vi.importActual<typeof import("@/lib/storage/books")>(
        "@/lib/storage/books"
      )
    ).moveChapter;
    vi.mocked(moveChapter).mockImplementationOnce(
      (id, to) =>
        new Promise((resolve, reject) => {
          releaseWrite = () => {
            real(id, to).then(resolve, reject);
          };
        })
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = hook().moveChapter(c3, 0);
    });

    // The pre-move read lands while the write is still in flight. Wait for
    // the load to finish its per-chapter reads (3 chapters on this book; the
    // other book has none), so the assertion below runs AFTER it resolved.
    vi.mocked(chapterProgress).mockClear();
    await act(async () => {
      releaseLoad(stale);
    });
    await vi.waitFor(() => expect(chapterProgress).toHaveBeenCalledTimes(3));
    await act(async () => {
      await Promise.all(
        vi.mocked(chapterProgress).mock.results.map((r) => r.value)
      );
    });
    expect(rowsOf(bookId)).toEqual([
      [c3, 1],
      [c1, 2],
      [c2, 3],
    ]);

    await act(async () => {
      releaseWrite();
      await pending;
    });
  });
});
