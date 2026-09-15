import { useCallback, useEffect, useRef, useState } from "react";

import {
  addChapter as addChapterToBook,
  chapterProgress,
  createBook as createBookInStore,
  deleteBook as deleteBookFromStore,
  getBook,
  getChapter,
  isStaleBookFailure,
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
 * Report a `renameBook` / `addChapter` failure — unless it is stale: the SAME
 * book id this hook has already handled through an unrelated, successful
 * delete (`isStaleBookFailure`, PR #344 round 8). Both mutations throw
 * `No such book: <id>` from an identical missing-row guard, and once a book
 * can be deleted that throw is reachable by a race that is not a fresh
 * failure — an in-flight rename or add-chapter losing its target to a delete
 * that already committed and already reported its own, correct outcome.
 *
 * `checkPresent` reads the store — the system of record — rather than `books`
 * state, which a memoised callback would otherwise read through a stale
 * closure (this hook's `renameBook`/`addChapter` are not re-created when
 * `books` changes). It is injected, defaulting to a real store read, so its
 * OWN failure — the gap Frank's round-9 review found (below) — can be pinned
 * in plain Node without a failing IndexedDB, the same seam this repo already
 * uses to test the encoder boundary (`AudioCodec`).
 *
 * This function must never reject. Every caller is already inside a `catch`
 * for a mutation that failed; before this guard, a failure of the stale-check
 * read itself (the same fault that may have caused `cause`, e.g. a blocked or
 * broken IndexedDB) propagated out and turned a HANDLED mutation failure into
 * an unhandled promise rejection — `addChapter`/`renameBook` never reaching
 * their documented `Promise<... | null>` contract (Frank, PR #344 round 9). On
 * that path the ORIGINAL mutation failure is reported: it is the operation the
 * translator actually attempted, and the stale-check's own fault is not new
 * information the screen can act on.
 *
 * Returns whether the failure was SWALLOWED (stale, nothing reported) rather
 * than reported. `books` state is IndexedDB's cache, not its source of truth
 * — a caller must `reload()` on a swallow, because the reason there was
 * nothing to report is that the store has already moved (George, PR #344
 * round 9). Two live copies of this app are a shape this repo already designs
 * for (`db.ts`'s `autoUpdate`, an e2e two-tab case): a second tab or a
 * pre-update page can delete a book while THIS copy's `books` still shows it,
 * and without a reload here the row stays tappable with no Notice explaining
 * why its actions silently do nothing — until a later tap into the ghost
 * throws a raw store string into the Segments screen instead. A reported
 * (non-stale) failure needs no extra reload: it is a live book, and nothing
 * about it changed.
 */
export async function reportUnlessStale(
  cause: unknown,
  bookId: BookId,
  report: (cause: unknown, fromDelete?: boolean) => void,
  checkPresent: (id: BookId) => Promise<boolean> = async (id) =>
    (await getBook(id)) !== undefined
): Promise<{ swallowed: boolean }> {
  let stillPresent: boolean;
  try {
    stillPresent = await checkPresent(bookId);
  } catch {
    report(cause);
    return { swallowed: false };
  }
  if (isStaleBookFailure(cause, bookId, stillPresent)) {
    return { swallowed: true };
  }
  report(cause);
  return { swallowed: false };
}

/**
 * The shelf's `books` state with exactly one book's card removed.
 *
 * `deleteBook`'s own success path patches `books` this way, in the SAME turn
 * the store transaction commits, so a chapter tap in between can never reach
 * a row whose parent book — and every store row under it — is already gone
 * (see the long comment on `deleteBook` below). A `reportUnlessStale` SWALLOW
 * is the same shape from a different door: an unrelated delete (a second tab,
 * or a pre-`autoUpdate` page) already committed and IndexedDB has already
 * moved, so `addChapter`/`renameBook`'s catch must patch the shelf the same
 * way before it reloads — `reload()` alone leaves the ghost row tappable
 * until the async read lands, and a chapter tap into it reaches the unchanged
 * Segments loader, which throws (George, PR #344 round 10 P2-1). Extracted so
 * both callers share one decision instead of three copies of the same filter
 * drifting apart, and so the decision itself — not the `setBooks` wiring
 * around it — is what a plain Node test pins.
 */
export function dropBookCard(
  books: readonly BookCard[],
  bookId: BookId
): BookCard[] {
  return books.filter((b) => b.bookId !== bookId);
}

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
        // THE LOAD NEVER TOUCHES A STANDING DELETE FAILURE — in either
        // direction. Success clears a load or mutation error, because the shelf
        // it just drew IS the truth; it must not clear a delete failure,
        // because the delete's failure path re-arms this very load and would
        // race its own error off the screen (George R3 P1 scenario B).
        setFailure((prev) => (prev?.fromDelete ? prev : null));
        setLoaded(true);
      } catch (cause) {
        if (stale()) return;
        // The other half of that rule. A delete failure re-arms this load, so
        // when the underlying fault is shared — a blocked or broken IndexedDB —
        // the load fails too, and reporting it plainly would overwrite the
        // delete's slot: the translator would lose `deleteBookFailed` for a raw
        // store string AND get no Retry, because `loaded` has already latched
        // so `loadFailed` is false. The book is still on disk in that state, so
        // the delete's copy is the one that has to survive (George R4 P2-1).
        setFailure((prev) =>
          prev?.fromDelete
            ? prev
            : {
                message: cause instanceof Error ? cause.message : String(cause),
                fromDelete: false,
              }
        );
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

  const createBook = useCallback(
    async (name: string): Promise<Book | null> => {
      // The name comes from the New Book field (#314). A blank one falls back to
      // the "Book NNN" placeholder — derived on disk inside the write's own
      // transaction, so it is race-safe and never the stale render count. A
      // failed write reaches the same Notice a load failure does, never a silent
      // unhandled rejection — the caller gets null.
      try {
        const book = await createBookInStore(name);
        report(null); // a successful write clears the slot — see `deleteBook`
        reload();
        return book;
      } catch (cause) {
        report(cause);
        return null;
      }
    },
    [reload, report]
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
      report(cause);
      return "";
    }
  }, [report]);

  const addChapter = useCallback(
    async (bookId: BookId): Promise<Chapter | null> => {
      try {
        const chapter = await addChapterToBook(bookId);
        report(null); // a successful write clears the slot — see `createBook`
        reload();
        return chapter;
      } catch (cause) {
        // Stale if an unrelated delete already removed this exact book and
        // already reported its own outcome — see `reportUnlessStale`. A
        // swallowed (stale) failure still patches `books` and reloads:
        // `books` is IndexedDB's cache, not its source of truth, and the
        // store has already moved out from under this ghost row (George, PR
        // #344 round 9) — the second-tab/pre-update-page shape `db.ts`'s
        // `autoUpdate` designs for. `reload()` alone left the row tappable
        // until that read landed (George, PR #344 round 10 P2-1); patching
        // first is exactly what `deleteBook`'s own success path already does,
        // below. A genuinely reported failure needs no extra reload or
        // patch; the book is still live and nothing about it changed.
        const { swallowed } = await reportUnlessStale(cause, bookId, report);
        if (swallowed) {
          setBooks((prev) => dropBookCard(prev, bookId));
          reload();
        }
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
        report(null); // a successful write clears the slot — see `createBook`
        reload();
        return book;
      } catch (cause) {
        // Stale if an unrelated delete already removed this exact book and
        // already reported its own outcome — see `reportUnlessStale`. Same
        // swallow-patches-and-reloads rule as `addChapter` above.
        const { swallowed } = await reportUnlessStale(cause, bookId, report);
        if (swallowed) {
          setBooks((prev) => dropBookCard(prev, bookId));
          reload();
        }
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
        setBooks((prev) => dropBookCard(prev, bookId));
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
    peekBookName,
    addChapter,
    renameBook,
    deleteBook,
    deleting,
  };
}
