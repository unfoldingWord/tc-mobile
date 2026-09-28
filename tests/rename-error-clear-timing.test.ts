import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBooks } from "@/hooks/use-books";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import {
  addChapter,
  createBook,
  renameBook as renameBookInStore,
  renameChapter as renameChapterInStore,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { Book, Chapter, ChapterId } from "@/types/domain";

/**
 * #395 item 1, the hook half: `renameBook`/`renameChapter` must clear a
 * STALE error at the START of a new attempt — matching `useBooks`'s
 * `deleteBook`, which already does this — not only on the write's own
 * success. Before this fix, a failed rename's Notice stayed in `error` for
 * the whole window between Confirm and the retry's own settle, which is
 * what let `tests/books-rename-busy-notice.test.ts` / `tests/segments-
 * rename-busy-notice.test.ts`'s UI-level guard (`!savingBookName` /
 * `!savingChapterName`) matter in the first place — George's point that
 * either half alone still leaves the other channel wrong.
 *
 * Shape borrowed from the PR #809 lane's `tests/segment-rename-reload-
 * race.test.ts`: a react-dom + `act()` mount of the hook itself, over a real
 * fake-indexeddb, with the store's own rename function wrapped so a
 * specific call can be made to reject or deferred.
 */

vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    renameBook: vi.fn(actual.renameBook),
    renameChapter: vi.fn(actual.renameChapter),
  };
});

let dom: JSDOM;
let root: Root;
const booksProbe: { current: ReturnType<typeof useBooks> | null } = {
  current: null,
};
const chapterProbe: {
  current: ReturnType<typeof useChapterSegments> | null;
} = { current: null };

function BooksProbe() {
  const result = useBooks();
  useLayoutEffect(() => {
    booksProbe.current = result;
  });
  return null;
}
function ChapterProbe({ chapterId }: { chapterId: ChapterId }) {
  const result = useChapterSegments(chapterId);
  useLayoutEffect(() => {
    chapterProbe.current = result;
  });
  return null;
}
const books = () => booksProbe.current!;
const chapter = () => chapterProbe.current!;

beforeEach(async () => {
  vi.clearAllMocks();
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
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

it("useBooks().renameBook clears a stale error at the START of a new attempt, before it settles (#395 item 1)", async () => {
  const book = await createBook("probe");
  await act(async () => {
    root.render(createElement(BooksProbe));
  });
  await vi.waitFor(() => expect(books().loaded).toBe(true));

  // A previous rename attempt already failed.
  vi.mocked(renameBookInStore).mockRejectedValueOnce(new Error("boom"));
  await act(async () => {
    await books().renameBook(book.id, "Mark");
  });
  await vi.waitFor(() => expect(books().error).not.toBeNull());

  // A retry — deferred, so the assertion below observes `error` WHILE the
  // second attempt is still in flight, not only once it settles.
  let resolveSecond: ((b: Book) => void) | null = null;
  vi.mocked(renameBookInStore).mockReturnValueOnce(
    new Promise<Book>((resolve) => {
      resolveSecond = resolve;
    })
  );
  act(() => {
    void books().renameBook(book.id, "Luke");
  });
  await vi.waitFor(() => expect(books().error).toBeNull());

  await act(async () => {
    resolveSecond!({ ...book, name: "Luke" });
  });
});

it("useChapterSegments().renameChapter clears a stale error at the START of a new attempt, before it settles (#395 item 1)", async () => {
  const book = await createBook("probe");
  const chapterRow = await addChapter(book.id);
  await act(async () => {
    root.render(createElement(ChapterProbe, { chapterId: chapterRow.id }));
  });
  await vi.waitFor(() => expect(chapter().loaded).toBe(true));

  vi.mocked(renameChapterInStore).mockRejectedValueOnce(new Error("boom"));
  await act(async () => {
    await chapter().renameChapter("Mark 6");
  });
  await vi.waitFor(() => expect(chapter().error).not.toBeNull());

  let resolveSecond: ((c: Chapter) => void) | null = null;
  vi.mocked(renameChapterInStore).mockReturnValueOnce(
    new Promise<Chapter>((resolve) => {
      resolveSecond = resolve;
    })
  );
  act(() => {
    void chapter().renameChapter("Mark 9");
  });
  await vi.waitFor(() => expect(chapter().error).toBeNull());

  await act(async () => {
    resolveSecond!({ ...chapterRow, name: "Mark 9" });
  });
});
