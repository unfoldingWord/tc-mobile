import { useCallback, useEffect, useState } from "react";

import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import {
  addChapter as addChapterToBook,
  chapterProgress,
  createNextBook,
  getChapter,
  listBooks,
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
  // A vocabulary key, never a caught message (#172): the screen looks the word
  // up in `strings`, and the cause goes to the failure sink instead.
  const [error, setError] = useState<FailureKey | null>(null);
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
        // Reported BEFORE the cancelled check: a shelf read that failed after
        // the screen unmounted still failed, and the sink is the maintainer's
        // channel, not the screen's. (Two mounts that each throw their own error
        // report twice — `reportFailure` collapses one OBJECT reaching two feeds,
        // not two separate failures. Two logs of a real double read is honest.)
        reportFailure(cause, "books-load");
        if (cancelled) return;
        setError(failureKey(cause, "loadFailed"));
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
      reportFailure(cause, "books-create");
      // A write: a full phone is the likeliest cause and the one a translator
      // can act on, so it is classified here rather than only on the take save.
      setError(failureKey(cause, "saveFailed"));
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
        reportFailure(cause, "books-add-chapter");
        setError(failureKey(cause, "saveFailed"));
        return null;
      }
    },
    [reload]
  );

  return { books, loading, loaded, error, reload, createBook, addChapter };
}
