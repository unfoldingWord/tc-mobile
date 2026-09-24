import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addChapter as addChapterToBook,
  chapterProgress,
  createBook as createBookInStore,
  deleteBook as deleteBookFromStore,
  getBook,
  getChapter,
  isStaleBookFailure,
  listBooks,
  nextBookName,
  renameBook as renameBookInStore,
} from "@/lib/storage/books";
import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import { bumpStoragePressure } from "./use-storage-pressure";
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
      const { finished, total, recorded } = await chapterProgress(id);
      return {
        chapterId: chapter.id,
        number: chapter.number,
        name: chapter.name,
        finishedCount: finished,
        totalCount: total,
        recordedCount: recorded,
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
 * The hook's single error slot: the failure KEY (#172 — never the raw
 * `cause.message` a screen would otherwise speak verbatim), and whether it
 * came from a delete.
 *
 * One state, not two, so the label and the key it labels cannot drift apart
 * — a delete's copy must never outlive the error it describes, and a later
 * failure from any other mutation must take the label off (George R1 P2-2).
 */
interface Failure {
  readonly key: FailureKey;
  readonly fromDelete: boolean;
}

/**
 * Fold a freshly added chapter into its book's card, in the same turn as the
 * write — patched immediately, the same contract `createBook`'s optimistic
 * insert and `useChapterSegments.addSegment` both follow, so a repeated confirm
 * sees the row that landed instead of an empty card that reads as "nothing
 * happened" (George R3/R4 P2): without the patch, the row stayed empty until
 * `loadBookCards` finished, and on this tree there is no way to delete the
 * extra chapter a second confirm writes.
 *
 * The repeat that reaches this is a deliberate one — reopen the prompt from the
 * row's `+` and confirm again before the reload lands (#609). The key-repeat
 * half is gone with the prompt: a held Enter through Confirm now lands on the
 * new chapter row, not on a control that writes.
 *
 * The caller (`addChapter`) still `reload()`s after patching — see its own
 * comment (George R7 P2) — for the two-copy shelf-reconciliation
 * `reportUnlessStale` is built around; `isLoadCurrent` (below) is what stops
 * that reload's own read from landing on top of a newer patch.
 *
 * The patched card also moves to the FRONT of the shelf. `addChapterToBook`
 * bumps the book's `updatedAt` in the same write (`lib/storage/books.ts`,
 * the `chapters` object store put), and `listBooks` sorts newest-first — the
 * IMMEDIATE patch has to already reflect that, because the reload that
 * reconciles it is asynchronous: a chapter added to a book that is not
 * already first would otherwise flash out of order for the length of that
 * read (Frank R5 P2).
 *
 * Chapters themselves are appended, not prepended: `ChapterRow` order is the
 * book's chapter order — unlike `BookCard`'s `updatedAt` shelf sort — and a
 * new chapter is the next one, not the first.
 *
 * Pure so the fold itself, not just the ref that gates it, has a red-first
 * test (`tests/use-books.test.ts`).
 */
export function patchNewChapter(
  books: readonly BookCard[],
  bookId: BookId,
  chapter: Chapter
): BookCard[] {
  const index = books.findIndex((card) => card.bookId === bookId);
  const original = books[index];
  if (index === -1 || !original) return books as BookCard[]; // stale card
  const patched: BookCard = {
    ...original,
    chapters: [
      ...original.chapters,
      {
        chapterId: chapter.id,
        number: chapter.number,
        name: chapter.name,
        // A brand-new chapter has no segments, so all three counts are known
        // without a read — mirrors `addSegment`'s optimistic row.
        finishedCount: 0,
        totalCount: 0,
        recordedCount: 0,
      },
    ],
  };
  return moveToFront(books, index, patched);
}

/** Shared by every optimistic patch that also moves its card to the shelf's
 * front — see `patchNewChapter` and `patchRenamedBook`. Not exported: it is
 * an implementation detail of "where does the patched card land", not a
 * decision either caller needs to make independently. */
function moveToFront<T>(items: readonly T[], index: number, patched: T): T[] {
  return [patched, ...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * Fold a rename's result into its book's card, in the same turn as the write.
 * `renameBook` used to rely on `reload()` alone (no immediate patch), on the
 * theory that a rename's shelf-reorder made an in-place patch have to
 * duplicate `listBooks`' own sort. That was exactly what Frank R5 P2 caught
 * breaking: `isLoadCurrent` discards ANY load whose generation has fallen
 * behind current, and a rename's reload had no fallback if a LATER
 * optimistic patch (`createBook`/`addChapter`) bumped the generation before
 * the rename's own read landed — the database held the new name permanently
 * while the shelf kept showing the old one, because nothing else was ever
 * going to re-apply it. Patching immediately, like the other two paths,
 * removes the window this bug needed to open at all; `renameBook` still
 * `reload()`s afterward (George R7 P2) for the same two-copy reconciliation
 * `createBook`/`addChapter` do, and `isLoadCurrent` still protects this
 * patch from a stale read the same way.
 *
 * Mirrors `renameBookInStore`'s own idempotency: a blank rename keeps the
 * current name and does not bump `updatedAt` or write at all, so a
 * name-unchanged result here does not reorder the shelf either — moving it
 * would show recency that never actually happened on disk. A genuine rename
 * moves the card to the front, matching the write's own bump, the same
 * reasoning `patchNewChapter` already follows for `addChapter`.
 */
export function patchRenamedBook(
  books: readonly BookCard[],
  book: Book
): BookCard[] {
  const index = books.findIndex((card) => card.bookId === book.id);
  const original = books[index];
  if (index === -1 || !original) return books as BookCard[]; // stale card
  if (book.name === original.name) return books as BookCard[]; // no-op rename
  return moveToFront(books, index, { ...original, name: book.name });
}

/**
 * Whether an Add-chapter tap for `bookId` should proceed, given the set of
 * books currently mid-create. The guard itself — not just the ref that holds
 * it — gets a red-first test: a second tap for the SAME book while the first
 * is still in flight must be swallowed (the unlatched control George R3/R4
 * P2 found), while a tap for a DIFFERENT book must not be blocked by it — two
 * books' Add-chapter controls are independent, unlike the single New Book
 * dialog's `creatingBook` latch.
 */
export function canStartAddChapter(
  inFlight: ReadonlySet<BookId>,
  bookId: BookId
): boolean {
  return !inFlight.has(bookId);
}

/**
 * Whether a load stamped `startedAt` may still apply its result, given the
 * CURRENT generation.
 *
 * `reload()` bumps the generation — every one of `createBook`'s,
 * `addChapter`'s and `renameBook`'s success paths call it right after their
 * own optimistic `setBooks` patch (George R7 P2), and so does a manual Retry
 * — so a load whose stamp has fallen behind current has been superseded and
 * must not overwrite newer state with what it read before the patch landed
 * (George R4 P2-2: the load effect's `cancelled` closure flag is set by a
 * CLEANUP function, which runs on React's own schedule; it is not guaranteed
 * to have run before an already-in-flight load's own promise resolves, so an
 * absolute `setBooks(cards)` from a load that started before an optimistic
 * patch, but resolves after it, could silently erase the patch). The
 * generation is the explicit, synchronous version of the same check.
 */
export function isLoadCurrent(startedAt: number, current: number): boolean {
  return startedAt === current;
}

/**
 * What a create attempt resolved to: the book, or the reason it failed.
 *
 * A discriminated outcome rather than `Book | null`, because the caller needs
 * the REASON and needs it scoped to this attempt — see `createBook` below.
 */
type CreateBookOutcome =
  | { readonly ok: true; readonly book: Book }
  | { readonly ok: false; readonly key: FailureKey };

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
   * asks for a re-read also invalidates whatever was already in flight —
   * `createBook`, `addChapter` and `renameBook` all patch `books` optimistic-
   * ally in the SAME turn as their write and then call `reload()` too (George
   * R7 P2: a two-copy shelf — a second tab, or a pre-`autoUpdate` page — needs
   * that reconciling read, or nothing ever catches this copy up with what the
   * other one wrote), so a load that started before an optimistic patch but
   * resolves after it must not overwrite the patch with a stale absolute
   * `setBooks(cards)` (George R4 P2-2). `isLoadCurrent` is the pure, explicit
   * version of the comparison below, pinned in `tests/use-books.test.ts`.
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
   * The same live guard, exposed (#452 PR3, the design's F4).
   *
   * `deleting` above is a `useState` value and so is last render's answer —
   * which is exactly what `Layer.busy()` may not be (invariant 4,
   * `lib/nav/layer-stack.ts`): the system-Back handler calls it from a
   * `popstate`, with no render between `deletingRef.current = true` and the
   * read. Identity-stable, because the delete confirm's `Layer` captures it
   * when the confirm opens.
   *
   * Not a second source of truth: it reads the SAME ref `deleteBook` flips
   * synchronously to refuse a double tap, so "Back is refused" and "a second
   * Confirm is refused" can never disagree.
   */
  const isDeleting = useCallback(() => deletingRef.current, []);

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
      // Every caller here is a write (create/addChapter/rename/delete), so
      // "saveFailed" is the fallback; `deleteBook`'s own failure never shows
      // this key on screen regardless — `fromDelete` relabels it to
      // `deleteBookFailed` instead (see `books-screen.tsx`'s `noticeText`).
      key: failureKey(cause, "saveFailed"),
      fromDelete,
    });
  }, []);

  useEffect(() => {
    // Captured synchronously, before the first await, so this load knows which
    // generation it belongs to.
    const gen = loadGen.current;
    let cancelled = false;
    void (async () => {
      // Superseded: a reload, a delete, or an optimistic create/addChapter
      // patch has happened since this load started, so its snapshot describes
      // a database state that is no longer true. Checked alongside `cancelled`
      // because `cancelled` alone flips too late (see `loadGen`).
      const stale = () => cancelled || !isLoadCurrent(gen, loadGen.current);
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
        //
        // `key` is extracted BEFORE the updater, not inside it: the
        // updater must not reference `cause` itself, only a value already
        // read from it. A nested function inside a `catch (cause)` block that
        // DOES reference `cause` silences eslint-plugin-react-hooks 7.1.1's
        // analysis for this WHOLE hook, including any unrelated render-time
        // ref write elsewhere in `useBooks` (#212,
        // tests/react-hooks-refs-gate.test.ts). George round 3 on #433 found
        // this exact shape still live here. (Not the same fix as
        // `use-save-take.ts` #213 — that moved the catch OUT of the hook
        // entirely into the module-level `performSaveTake`, which still
        // closes over `cause` there; a module-level function is not a hook,
        // so it is outside what eslint-plugin-react-hooks analyses at all.
        // This hoist stays inside the hook and only changes what the nested
        // closure references.)
        const key = failureKey(cause, "loadFailed");
        // #172: this site had no funnel report before this PR. Called
        // directly here, not inside the updater above (same reason `key` is
        // hoisted out of it) — see the comment block above.
        reportFailure(cause, "books-load");
        setFailure((prev) =>
          prev?.fromDelete ? prev : { key, fromDelete: false }
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
        // The write is durable now — a new book may hold new chapters/takes
        // before this screen next asks `estimate()` on its own, so a live
        // `useStoragePressure` mount must re-read rather than keep whatever
        // it answered before this commit (#542 Part A, DRI decision
        // 2026-09-24). Called here, after the `await` lands, never from the
        // optimistic `setBooks` patch below — that patch can still be
        // superseded by a stale concurrent load, but this write already
        // committed regardless.
        bumpStoragePressure();
        report(null); // a successful write clears the slot — see `deleteBook`
        // Put the row on the shelf in THIS turn, before `reload()`'s async read
        // lands. The New Book dialog unmounts on success, and every contract it
        // hands off to keys on `books`: `showEmpty` would otherwise re-raise the
        // "start your first book" invite — with a live CTA — over a shelf that
        // now has a book on it, a second Confirm there writing a second book
        // only a manual delete (#337) recovers from; and the screen's
        // scroll/focus effect could not run at all, leaving focus on the
        // document (George R2 P2-1). Prepended because `listBooks` sorts by
        // `updatedAt` and this is
        // the newest, so the optimistic order is the order the reload confirms.
        //
        // `reload()` DOES follow this. An earlier round dropped it on the
        // theory that the new card is already fully correct so a reload could
        // only race a later patch — true in a single copy, but `books` is
        // IndexedDB's cache, not the source of truth (`reportUnlessStale`'s
        // doc above): a second tab or a pre-`autoUpdate` page can mutate the
        // SAME store underneath this one, and dropping the reconciling read
        // meant nothing here — or in `addChapter`/`renameBook` below — ever
        // caught up with disk again outside of a delete or a stale swallow
        // (George R7 P2, on the #344 rebase: the shelf stopped being
        // reconciled with disk for exactly the two-copy shape
        // `reportUnlessStale` exists to handle). `reload()` bumps the
        // generation itself, so the guard below still discards this read if a
        // NEWER patch lands before it resolves — the optimistic insert above
        // is never at risk, only ever reconciled or superseded.
        setBooks((prev) => [
          { bookId: book.id, name: book.name, chapters: [] },
          ...prev,
        ]);
        reload();
        return { ok: true, book };
      } catch (cause) {
        // #172: this site had no funnel report before this PR — the reason
        // reached only the New Book dialog's own scoped Notice, and only as
        // the raw store string.
        reportFailure(cause, "books-create");
        return {
          ok: false,
          key: failureKey(cause, "saveFailed"),
        };
      }
    },
    [reload, report]
  );

  // The Add-chapter in-flight latch, one entry per book. A ref (like
  // `creatingBook` in books-screen.tsx), not state: it gates re-entrancy
  // rather than driving a render, and each book's control latches
  // independently, so two different books' Add-chapter taps do not block
  // each other the way the single New Book dialog's latch would.
  const addingChapterFor = useRef<Set<BookId>>(new Set());

  const addChapter = useCallback(
    async (bookId: BookId, name: string): Promise<Chapter | null> => {
      if (!canStartAddChapter(addingChapterFor.current, bookId)) return null;
      addingChapterFor.current.add(bookId);
      try {
        // `name` is what the Add-chapter prompt confirmed (#609) — "" for an
        // untouched "Chapter N" default, which the store writes as no label at
        // all. Required rather than defaulted, so a call site that forgets to
        // forward the field is a `tsc` error and not a silently unnamed
        // chapter. `undefined` for the ordinal: only the export suites pin an
        // explicit `number`, and the default (max + 1, derived in the write's
        // own transaction) is what the product path wants.
        const chapter = await addChapterToBook(bookId, undefined, name);
        report(null); // a successful write clears the slot — see `createBook`
        // Patch the row on THIS book's card in the same turn as the write —
        // see `patchNewChapter` — so the control's own repeated activations
        // after a reopened prompt see the row that landed instead of a card that
        // reads as "nothing happened" (George R3/R4 P2). `reload()` still
        // follows — see `createBook`'s matching comment (George R7 P2): the
        // patch is what the control sees immediately, `reload()` is what
        // catches this book up with anything a second copy did elsewhere,
        // and `isLoadCurrent` still protects the patch from a stale read
        // landing after a NEWER one.
        setBooks((prev) => patchNewChapter(prev, bookId, chapter));
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
        // patch — the book is still live and nothing about it changed — but
        // it DOES need to invalidate a load already in flight (#666, George
        // round 1 on #637). `report()` sets the Notice synchronously, but a
        // load an earlier `reload()` started (e.g. `createBook`'s, on a large
        // shelf) can still be running; if it resolves afterward, its success
        // path (`setFailure((prev) => (prev?.fromDelete ? prev : null))`
        // above) would clear the Notice this report just set, even though
        // the failure is still unaddressed. Bumping the generation — not
        // calling `reload()`, which would also trigger a needless extra read
        // of a book that has not changed — marks that load stale so its
        // resolution is a no-op.
        // #172: this site had no funnel report before this PR. The wrapper
        // — not bare `report` — only fires on the NOT-swallowed branch,
        // exactly where `reportUnlessStale` calls it; a stale race is not a
        // genuine failure to log, matching `renameSegment`'s same rule.
        const { swallowed } = await reportUnlessStale(
          cause,
          bookId,
          (reported) => {
            reportFailure(reported, "books-add-chapter");
            report(reported);
          }
        );
        if (swallowed) {
          setBooks((prev) => dropBookCard(prev, bookId));
          reload();
        } else {
          loadGen.current += 1;
        }
        return null;
      } finally {
        // This per-book write latch releases when the attempt settles. The
        // screen's separate prompt latch stays held until a new prompt opens.
        addingChapterFor.current.delete(bookId);
      }
    },
    [reload, report]
  );

  const renameBook = useCallback(
    async (bookId: BookId, name: string): Promise<Book | null> => {
      // Clear at the START of the op, as `deleteBook` does (#395 item 1): a
      // Notice from a PREVIOUS failed rename must not still be standing once
      // a retry is under way, alongside the screen's own busy Notice for
      // THIS attempt — the exact collision `control-affordance.ts` names as
      // the rule the busy/Notice wiring follows (George, #395).
      report(null);
      // `reload()` follows the patch — see `createBook`'s matching comment
      // (George R7 P2). A failed write reaches the same Notice a load
      // failure does.
      try {
        const book = await renameBookInStore(bookId, name);
        report(null); // a successful write clears the slot — see `createBook`
        setBooks((prev) => patchRenamedBook(prev, book));
        reload();
        return book;
      } catch (cause) {
        // Stale if an unrelated delete already removed this exact book and
        // already reported its own outcome — see `reportUnlessStale`. Same
        // swallow-patches-and-reloads rule as `addChapter` above — including
        // the non-swallowed `else` (#732, mirroring #728's `addChapter` fix
        // for #666): a genuinely reported failure still needs to invalidate a
        // load already in flight, or that load's success path
        // (`setFailure((prev) => (prev?.fromDelete ? prev : null))` in the
        // load effect above) can resolve afterward and silently clear the
        // Notice this failure just set. Bumping the generation — not calling
        // `reload()`, which would also trigger a needless extra read of a
        // book that has not changed — marks that load stale so its
        // resolution is a no-op. The bump rides INSIDE the report callback,
        // in the same synchronous step as the Notice: bumping after the
        // `await` left a microtask window in which an already-resolved load
        // continuation still read the old generation (Frank, #733 round 1).
        // #172: this site had no funnel report before this PR — added the
        // same way `addChapter` above does, and for the same reason.
        const { swallowed } = await reportUnlessStale(
          cause,
          bookId,
          (reported) => {
            reportFailure(reported, "books-rename");
            loadGen.current += 1;
            report(reported);
          }
        );
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
        // The delete transaction has committed — real storage (clipMeta/
        // clipData, `lib/storage/books.ts`) is freed now, so a live
        // `useStoragePressure` mount must re-read `estimate()` rather than
        // keep repainting whatever it answered before this delete (#542 Part
        // A, DRI decision 2026-09-24). After the commit, not from the
        // optimistic `setBooks` patch below.
        bumpStoragePressure();
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
        // One row per real failure (#456); console.error kept beside it.
        // `cause` passed straight through, called directly here — not inside
        // a nested closure, which would silence eslint-plugin-react-hooks's
        // analysis for this whole hook (the catch-block shape #212 and
        // `tests/react-hooks-refs-gate.test.ts` pin; `message` below is
        // extracted the same defensive way for the same reason).
        reportFailure(cause, "book-delete");
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
    newBookPlaceholder,
    loading,
    loaded,
    // Derived from the one failure slot, so the key and its delete label
    // are always the same failure's.
    error: failure?.key ?? null,
    deleteFailed: failure?.fromDelete ?? false,
    reload,
    createBook,
    addChapter,
    renameBook,
    deleteBook,
    deleting,
    isDeleting,
  };
}
