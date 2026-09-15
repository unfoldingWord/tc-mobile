import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addChapter as addChapterToBook,
  chapterProgress,
  createBook as createBookInStore,
  getChapter,
  listBooks,
  nextBookName,
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
 * What a create attempt resolved to: the book, or the reason it failed.
 *
 * A discriminated outcome rather than `Book | null`, because the caller needs
 * the REASON and needs it scoped to this attempt — see `createBook` below.
 */
type CreateBookOutcome =
  | { readonly ok: true; readonly book: Book }
  | { readonly ok: false; readonly message: string };

/**
 * The Books screen (B2): the book/chapter tree and its two creation actions.
 *
 * Expand/collapse is per-viewer UI state and stays in the component; this hook
 * owns only what is on disk. `addChapter` returns what it made so the screen can
 * expand and scroll to it; `createBook` returns an outcome rather than a
 * nullable book, because a failed create has to speak INSIDE the New Book dialog
 * (the screen's Notice sits behind its scrim) and must not be confused with
 * whatever last wrote the shared channel (#314; Frank R1 P3, George R1 P2-2).
 * `newBookPlaceholder` is the name that dialog pre-fills its field with.
 */
export function useBooks() {
  const [books, setBooks] = useState<BookCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Latches true on the first read that completes without throwing. `loading`
  // can't stand in — `reload()` never flips it back on — so only this
  // distinguishes "a genuinely empty shelf" from "a read that never succeeded"
  // for the caller's empty-vs-retry choice.
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

  /**
   * The name a blank New Book confirm would be given, for the dialog to pre-fill
   * its field with (#314).
   *
   * Derived from `books` rather than held as its own state, so it cannot lag the
   * shelf by a render: the optimistic insert below moves both in one commit, and
   * a second `+` immediately after a create offers the NEXT name rather than the
   * one just taken (George R2 P2-1). Same pure function the store's own fallback
   * uses, over the same names, so the field shows what a blank confirm writes.
   */
  const newBookPlaceholder = useMemo(
    () => nextBookName(books.map((b) => b.name)),
    [books]
  );

  const createBook = useCallback(
    async (name: string): Promise<CreateBookOutcome> => {
      // The name comes from the New Book field (#314). A blank one falls back to
      // the "Book NNN" placeholder — derived on disk inside the write's own
      // transaction, so it is race-safe and never a render-time snapshot.
      //
      // The reason is RETURNED rather than pushed onto the shared `error`: this
      // failure has to appear inside the New Book dialog, and that dialog must
      // not also display an addChapter or rename failure left on the shared
      // channel by an earlier action (Frank R1 P3 / George R1 P2-2, raised
      // independently by both lenses). Still never a silent unhandled rejection.
      try {
        const book = await createBookInStore(name);
        // Put the row on the shelf in THIS turn, before `reload()`'s async read
        // lands. The New Book dialog unmounts on success, and every contract it
        // hands off to keys on `books`: `showEmpty` would otherwise re-raise the
        // "start your first book" invite — with a live CTA — over a shelf that
        // now has a book on it, a second Confirm there writing a second book
        // that cannot be deleted on this tree; and the screen's scroll/focus
        // effect could not run at all, leaving focus on the document (George R2
        // P2-1). Prepended because `listBooks` sorts by `updatedAt` and this is
        // the newest, so the optimistic order is the order the reload confirms.
        // `reload()` stays as the reconciliation that fills in anything this
        // synthesised card cannot know.
        setBooks((prev) => [
          { bookId: book.id, name: book.name, chapters: [] },
          ...prev,
        ]);
        reload();
        return { ok: true, book };
      } catch (cause) {
        return {
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    [reload]
  );

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
    newBookPlaceholder,
    loading,
    loaded,
    error,
    reload,
    createBook,
    addChapter,
    renameBook,
  };
}
