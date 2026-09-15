import { useCallback, useEffect, useState } from "react";

import {
  addChapter as addChapterToBook,
  chapterProgress,
  createBook as createBookInStore,
  getChapter,
  listBooks,
  peekNextBookName,
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
 * The Books screen (B2): the book/chapter tree and its two creation actions.
 *
 * Expand/collapse is per-viewer UI state and stays in the component; this hook
 * owns only what is on disk. `createBook` and `addChapter` return what they
 * made so the screen can expand and scroll to it; `peekBookName` reads the
 * placeholder the New Book dialog pre-fills its field with (#314), without
 * creating anything.
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

  const createBook = useCallback(
    async (name: string): Promise<Book | null> => {
      // The name comes from the New Book field (#314). A blank one falls back to
      // the "Book NNN" placeholder — derived on disk inside the write's own
      // transaction, so it is race-safe and never the stale render count. A
      // failed write reaches the same Notice a load failure does, never a silent
      // unhandled rejection — the caller gets null.
      try {
        const book = await createBookInStore(name);
        reload();
        return book;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [reload]
  );

  /**
   * The placeholder to pre-fill the New Book field with (#314). Read-only, so a
   * cancelled dialog leaves nothing behind.
   *
   * A failed read is NOT fatal to the flow: it surfaces on the same Notice
   * channel and returns "", which opens the dialog on an empty field — and a
   * blank confirm still derives the placeholder inside the write. So a
   * transiently unreadable shelf costs the pre-fill, not the ability to create.
   */
  const peekBookName = useCallback(async (): Promise<string> => {
    try {
      return await peekNextBookName();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return "";
    }
  }, []);

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

  return {
    books,
    loading,
    loaded,
    error,
    reload,
    createBook,
    peekBookName,
    addChapter,
    renameBook,
  };
}
