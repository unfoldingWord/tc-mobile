import { useCallback, useEffect, useRef, useState } from "react";

import {
  addChapter as addChapterToBook,
  chapterProgress,
  createNextBook,
  deleteBook as deleteBookFromStore,
  getChapter,
  listBooks,
  renameBook as renameBookInStore,
} from "@/lib/storage/books";
import type { Book, BookId, Chapter } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * Assemble the Books screen: every book with its chapters and each chapter's
 * finished/total roll-up. Pure data loading with no React state, so the hook
 * below can call it from an effect without setting state before its first
 * await, and so the assembly can be reasoned about on its own.
 *
 * The per-chapter counts come from `chapterProgress`, which counts segment
 * status only — never clip bytes — so building this screen stays cheap even
 * when a book holds many recorded chapters.
 */
async function loadBookCards(): Promise<BookCard[]> {
  const books = await listBooks();
  return Promise.all(books.map(loadBookCard));
}

async function loadBookCard(book: Book): Promise<BookCard> {
  const chapters = await Promise.all(
    book.chapterIds.map(async (id): Promise<ChapterRow | null> => {
      const chapter = await getChapter(id);
      if (!chapter) return null; // drop a dangling id rather than render a blank
      const { finished, total } = await chapterProgress(id);
      return {
        chapterId: chapter.id,
        number: chapter.number,
        name: chapter.name,
        finishedCount: finished,
        totalCount: total,
      };
    })
  );
  return {
    bookId: book.id,
    name: book.name,
    chapters: chapters.filter((c): c is ChapterRow => c !== null),
  };
}

/**
 * The outcome of a call to `deleteBook`.
 *
 * `"busy"` is distinct from `"failed"` on purpose, exactly as in
 * `useEraseSegment`: a double-tap's second call is refused by the in-flight
 * guard, and the caller must NOT treat that refusal as a result and dismiss its
 * confirmation — the first call is still running and owns the outcome. Callers
 * act on `"ok"`/`"failed"` and ignore `"busy"`.
 */
type DeleteBookResult = "ok" | "failed" | "busy";

/**
 * The Books screen (B2): the book/chapter tree and its two creation actions.
 *
 * Expand/collapse is per-viewer UI state and stays in the component; this hook
 * owns only what is on disk. `createBook` and `addChapter` return what they
 * made so the screen can expand and scroll to it.
 */
export function useBooks() {
  const [books, setBooks] = useState<BookCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Latches true on the first read that completes without throwing. `loading`
  // can't stand in: `reload()` never flips it back on, and `error` is also set
  // by a failed create — so only this distinguishes "a genuinely empty shelf"
  // from "a read that never succeeded" for the caller's empty-vs-retry choice.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /** True while a book delete is in flight — the confirm dialog's `busy`. */
  const [deleting, setDeleting] = useState(false);
  /**
   * The live in-flight guard, readable synchronously.
   *
   * `deleting` is last render's value; two taps in one frame both read it false.
   * The ref answers for the current moment, so a second tap is refused before it
   * can open a second delete transaction over the same tree.
   */
  const deletingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cards = await loadBookCards();
        if (cancelled) return;
        setBooks(cards);
        setError(null);
        setLoaded(true);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const createBook = useCallback(async (): Promise<Book | null> => {
    // Auto-named from the count on disk (race-safe in storage), not from the
    // stale render count. A failed write reaches the same Notice a load failure
    // does, never a silent unhandled rejection — the caller gets null.
    try {
      const book = await createNextBook();
      reload();
      return book;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [reload]);

  const addChapter = useCallback(
    async (bookId: BookId): Promise<Chapter | null> => {
      try {
        const chapter = await addChapterToBook(bookId);
        reload();
        return chapter;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [reload]
  );

  const renameBook = useCallback(
    async (bookId: BookId, name: string): Promise<Book | null> => {
      // reload() rather than an in-place patch: a rename bumps the book's
      // updatedAt, and listBooks sorts by it, so the shelf order actually
      // changes — the same reason createBook/addChapter reload. A failed write
      // reaches the same Notice a load failure does.
      try {
        const book = await renameBookInStore(bookId, name);
        reload();
        return book;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [reload]
  );

  const deleteBook = useCallback(
    async (bookId: BookId): Promise<DeleteBookResult> => {
      // Refused, not failed: the first call owns the outcome, and a caller that
      // treated this as a result would tear its confirm down mid-delete. Same
      // distinction, and the same reason, as `useEraseSegment`'s `"busy"`.
      if (deletingRef.current) return "busy";
      deletingRef.current = true;
      setDeleting(true);
      try {
        await deleteBookFromStore(bookId);
        // reload() rather than dropping the row in place: the whole shelf is
        // one read, an empty shelf has to reach the invite empty state, and the
        // store is the only authority on what survived.
        reload();
        return "ok";
      } catch (cause) {
        // Never swallowed: the reason reaches `error` for a maintainer reading
        // the screen Notice, while the screen shows `deleteBookFailed` to the
        // translator. `console.error` is the sink, as in `performErase`.
        console.error("Deleting a book failed", cause);
        setError(cause instanceof Error ? cause.message : String(cause));
        return "failed";
      } finally {
        // Releases the guard rather than dropping state, so it is safe in
        // `finally`; a guard left set would lock out every later delete.
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    [reload]
  );

  return {
    books,
    loading,
    loaded,
    error,
    reload,
    createBook,
    addChapter,
    renameBook,
    deleteBook,
    deleting,
  };
}
