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
 * The hook's single error slot: the message, and whether it came from a delete.
 *
 * One state, not two, so the label and the message it labels cannot drift apart
 * — a delete's copy must never outlive the error it describes, and a later
 * failure from any other mutation must take the label off (George R1 P2-2).
 */
interface Failure {
  readonly message: string;
  readonly fromDelete: boolean;
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
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /**
   * The generation a load must still belong to for its result to be applied.
   *
   * `cancelled` in the load effect below is NOT enough on its own: it flips in
   * an effect cleanup, which React runs after paint, so between a mutation
   * committing and that cleanup there is a window in which a load started
   * BEFORE the write can resolve and write its pre-write snapshot over the
   * shelf — putting a just-deleted book back, with its chapters already gone
   * underneath it (George R3 P1). A ref moves that invalidation into the same
   * synchronous step as the write. Bumped by `reload()`, so every path that
   * asks for a re-read also invalidates whatever was already in flight.
   */
  const loadGen = useRef(0);
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

  /**
   * The ONE place this hook sets or clears `error`.
   *
   * `report(null)` clears; `report(cause)` records a failure; `report(cause,
   * true)` records one the screen should speak in the delete's own words. Both
   * pieces of state move together here, so a stale "could not delete" can never
   * survive a healthy reload or shadow another mutation's failure.
   */
  const report = useCallback((cause: unknown, fromDelete = false): void => {
    if (cause === null) {
      setFailure(null);
      return;
    }
    setFailure({
      message: cause instanceof Error ? cause.message : String(cause),
      fromDelete,
    });
  }, []);

  useEffect(() => {
    // Captured synchronously, before the first await, so this load knows which
    // generation it belongs to.
    const gen = loadGen.current;
    let cancelled = false;
    void (async () => {
      // Superseded: a reload or a delete has happened since this load started,
      // so its snapshot describes a database state that is no longer true.
      // Checked alongside `cancelled` because `cancelled` alone flips too late
      // (see `loadGen`).
      const stale = () => cancelled || gen !== loadGen.current;
      try {
        const cards = await loadBookCards();
        if (stale()) return;
        setBooks(cards);
        // A successful read clears a standing load or mutation error — the
        // shelf it just drew IS the truth. It must NOT clear a DELETE failure:
        // the delete's failure path re-arms this very load (so the shelf still
        // refreshes), and clearing here would race that error off the screen
        // every time, leaving a book that is still on disk with no signal that
        // removing it failed (George R3 P1 scenario B).
        setFailure((prev) => (prev?.fromDelete ? prev : null));
        setLoaded(true);
      } catch (cause) {
        if (stale()) return;
        report(cause);
      } finally {
        if (!stale()) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, report]);

  const reload = useCallback(() => {
    // Invalidate anything already in flight in the SAME synchronous step, then
    // ask for the new read. Doing only the latter is what let a pre-write
    // snapshot land after the write (George R3 P1).
    loadGen.current += 1;
    setReloadToken((t) => t + 1);
  }, []);

  const createBook = useCallback(async (): Promise<Book | null> => {
    // Auto-named from the count on disk (race-safe in storage), not from the
    // stale render count. A failed write reaches the same Notice a load failure
    // does, never a silent unhandled rejection — the caller gets null.
    try {
      const book = await createNextBook();
      reload();
      return book;
    } catch (cause) {
      report(cause);
      return null;
    }
  }, [reload, report]);

  const addChapter = useCallback(
    async (bookId: BookId): Promise<Chapter | null> => {
      try {
        const chapter = await addChapterToBook(bookId);
        reload();
        return chapter;
      } catch (cause) {
        report(cause);
        return null;
      }
    },
    [reload, report]
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
        report(cause);
        return null;
      }
    },
    [reload, report]
  );

  const deleteBook = useCallback(
    async (bookId: BookId): Promise<DeleteBookResult> => {
      // Refused, not failed: the first call owns the outcome, and a caller that
      // treated this as a result would tear its confirm down mid-delete. Same
      // distinction, and the same reason, as `useEraseSegment`'s `"busy"`.
      if (deletingRef.current) return "busy";
      deletingRef.current = true;
      setDeleting(true);
      // Clear at the START of the op, as `useEraseSegment` does: a Notice from
      // the previous attempt must not stand over an attempt that is running
      // now, and must not survive into a success (George R3 P2-2).
      report(null);
      try {
        await deleteBookFromStore(bookId);
        // Drop the row in the SAME turn the store commits, THEN reload for
        // authority. `reload()` alone only bumps a token: the shelf would keep
        // rendering the deleted book until an async `loadBookCards` resolved,
        // leaving a tappable row whose chapters are gone (the Segments loader
        // would throw `No such chapter`), and leaving the caller's focus
        // hand-off with no `books` change to fire on — and if that reload then
        // FAILED, `books` would never change at all and the ghost would stay,
        // with no Retry offered because `loaded` has already latched (George R1
        // P2-1). This is `eraseRow`'s model, one screen up: patch what we know
        // changed, then re-read.
        setBooks((prev) => prev.filter((b) => b.bookId !== bookId));
        // `reload()` bumps `loadGen` first, so a load that started before this
        // delete can no longer apply its pre-delete snapshot over the filtered
        // shelf — the resurrection in George R3 P1 scenario A.
        reload();
        // Explicit, not merely implied by the follow-up read: the delete
        // succeeded, so a Notice from an earlier failed attempt comes down now
        // rather than whenever `loadBookCards` happens to resolve.
        report(null);
        return "ok";
      } catch (cause) {
        // Never swallowed: the reason reaches `error` for a maintainer reading
        // the screen Notice, while `deleteFailed` tells the screen to speak it
        // in the delete's own words. `console.error` is the sink, as in
        // `performErase`.
        console.error("Deleting a book failed", cause);
        report(cause, true);
        // Re-arm the read even though nothing was deleted. A load that started
        // before this attempt is now invalidated by `reload()`'s generation
        // bump — without that, its `setFailure(null)` would clear this very
        // error and leave a book still on disk with no signal that removing it
        // failed. Re-arming rather than only invalidating means a refresh
        // another mutation had asked for is not silently dropped. The new
        // load's success cannot clear this error: it preserves a delete failure
        // by design (see the load effect).
        reload();
        return "failed";
      } finally {
        // Releases the guard rather than dropping state, so it is safe in
        // `finally`; a guard left set would lock out every later delete.
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    [reload, report]
  );

  return {
    books,
    loading,
    loaded,
    // Derived from the one failure slot, so the message and its delete label
    // are always the same failure's.
    error: failure?.message ?? null,
    deleteFailed: failure?.fromDelete ?? false,
    reload,
    createBook,
    addChapter,
    renameBook,
    deleteBook,
    deleting,
  };
}
