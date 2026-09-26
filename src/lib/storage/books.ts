/**
 * Book repository — the Book → Chapter → Segment → Take tree.
 *
 * Ordering is explicit (`chapterIds`, `segmentIds` arrays) rather than derived
 * from a sort key, because export is defined as "concatenation of segments"
 * and the order of that concatenation is a decision the user makes, not a
 * property of the data.
 *
 * The take writes and the finished flag are NOT here: `addTake`, `saveTake`,
 * `clearSegmentTake`, `setSegmentFinished` and `isFinished` are in `takes.ts`
 * (#160, L-16), which keeps every take-lifecycle status transition and the
 * read the view layer calls in one place. `addSegment` below is the one
 * `RecordingStatus` write that stays here: the initial `"not-started"` belongs
 * to creating a segment, not to a take. This module owns the tree — the books,
 * chapters and segments, their order, and the export resolution over them —
 * and reaches into takes for exactly one thing, `chapterProgress`'s
 * `isFinished`.
 */

import type { IDBPDatabase } from "idb";

import { getDb, type TcMobileDb } from "./db";
import { resolveSegmentAudio } from "./segment-audio";
import { isFinished } from "./takes";
import type {
  Book,
  BookId,
  Chapter,
  ChapterId,
  ClipId,
  Segment,
  SegmentId,
  Take,
} from "@/types/domain";

const uuid = (): string => crypto.randomUUID();

// ── Books ──────────────────────────────────────────────────────────────────

/**
 * The placeholder name for a new book: the FIRST "Book NNN" not already on the
 * shelf, three-digit padded ("Book 001", "Book 002" …).
 *
 * Pure, and the single definition of the placeholder — both callers go through
 * it, so the name the New Book field is pre-filled with (the Books screen, off
 * the shelf it has already loaded) and the name a blank confirm actually writes
 * ({@link createBook}) cannot drift (#314). The pre-fill is DISPLAY only: an
 * untouched field is confirmed as `""`, so the name that lands is always the one
 * derived inside the write transaction below, never the rendered string.
 *
 * **First unused, not `count + 1`** (#360). The count-based namer this replaces
 * assumed books are only ever added. Once a book can be deleted, deleting
 * "Book 001" leaves one book and makes the next one "Book 002" as well — two
 * identical rows. Names have never been unique keys (rename already allows two
 * "Mark"s), but the delete confirm puts the book's name in its accessible name,
 * so a duplicate leaves a destructive, irreversible dialog unable to say which
 * book it is about to destroy — on a screen built for people who may not read,
 * where discarding practice books is the normal training workflow.
 *
 * Matching is exact on the stored name. A facilitator's own name ("Mark")
 * occupies no slot, and "Book 1" is not a string this ever writes, so neither
 * blocks "Book 001". The loop is bounded by the number of names + 1: with N
 * names, at most N of the first N + 1 candidates can be taken.
 */
export function nextBookName(existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  for (let n = 1; ; n++) {
    const candidate = `Book ${String(n).padStart(3, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Create a book, named by the translator (#314) or by the placeholder.
 *
 * The name is trimmed, exactly as {@link renameBook} trims it — one validation
 * rule for the one naming field, wherever it is shown. A blank or
 * whitespace-only name is not an error: it falls back to the "Book NNN"
 * placeholder, which is what preserves the one-tap New Book the corner `+` used
 * to be.
 *
 * The fallback is derived INSIDE the one readwrite transaction that writes the
 * row, never from a screen's render state: two rapid blank confirms both reading
 * an empty shelf from the same render would both persist "Book 001". IndexedDB
 * serialises overlapping readwrite transactions, so deriving and putting in one
 * transaction gives the second confirm the first's write — "Book 001", then
 * "Book 002". That race-safety is the property `createNextBook` held before
 * #314 split naming off from creating, and it is preserved here rather than
 * moved to the caller.
 *
 * A supplied name is never made unique: a facilitator may deliberately have two
 * books called "Mark", and {@link renameBook} has always allowed it. That is
 * also why the New Book dialog sends `""` rather than the placeholder string it
 * displayed when the field is untouched — a supplied "Book 001" would bypass the
 * derivation below, and two documents open on the same shelf would both write it
 * (George R1 P2-3).
 */
export async function createBook(
  name: string,
  languageCode: string | null = null,
  now: number = Date.now()
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const trimmed = name.trim();
  // Read the shelf only when the name is actually blank — a typed name needs no
  // placeholder, and `getAll` is the expensive half of this transaction.
  const resolvedName =
    trimmed === ""
      ? nextBookName((await tx.store.getAll()).map((b) => b.name))
      : trimmed;
  const book: Book = {
    id: uuid() as BookId,
    name: resolvedName,
    languageCode,
    chapterIds: [],
    createdAt: now,
    updatedAt: now,
    // Unset by default — the facilitator has not chosen one yet (#957).
    // `resolveCoverKey` derives a colour from the id until they do.
    coverColourKey: null,
  };
  await tx.store.put(book);
  await tx.done;
  return book;
}

export async function listBooks(): Promise<Book[]> {
  const db = await getDb();
  return (await db.getAll("books")).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getBook(id: BookId): Promise<Book | undefined> {
  return (await getDb()).get("books", id);
}

/**
 * Rename a book in place (#264 — the Nairobi manual workflow names a book for
 * the passage, e.g. "Mark").
 *
 * Get-then-put in ONE readwrite transaction — the idempotency bar, never a
 * read-tx-then-write-tx seam. The new name is trimmed; a blank/whitespace-only
 * rename is refused (a book must always have a non-empty name) and keeps the
 * current one. Renaming to the current name writes nothing and does NOT bump
 * `updatedAt`, so a re-run is a true no-op that never reshuffles the shelf.
 * Any real rename bumps `updatedAt` — labelling a book is activity, and
 * `listBooks` sorts by it, so the book just named floats to the top.
 *
 * Concurrent renames deliberately use transaction-creation-order last-write-wins
 * (#394). The read and write stay in one readwrite transaction. The same-tab
 * calls in `tests/rename-ordering.test.ts` share `getDb()` and leave the later
 * call's label stored. Across tabs, connection readiness can change transaction
 * creation order after `await getDb()`: we do not promise typing-time ordering
 * or reject competing edits from another copy.
 */
export async function renameBook(
  id: BookId,
  name: string,
  now: number = Date.now()
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const book = await tx.store.get(id);
  if (!book) throw new Error(`No such book: ${id}`);

  const trimmed = name.trim();
  // Blank keeps the current name — the invariant that a book is always named.
  const nextName = trimmed === "" ? book.name : trimmed;
  if (nextName === book.name) {
    await tx.done; // idempotent no-op: no write, no recency bump.
    return book;
  }

  const updated: Book = { ...book, name: nextName, updatedAt: now };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * Set a book's cover colour in place (#957 — D7/D8, "people choose a colour"
 * from a palette).
 *
 * The `renameBook` rules, deliberately: get-then-put in ONE readwrite
 * transaction — the idempotency bar. `key` is stored as given — a palette key
 * such as `"forest"`, or `null` to clear back to the derived fallback
 * (`lib/cover-colour.ts`'s `resolveCoverKey`). Unlike a book's name, `null` is
 * a real, first-class value here rather than something trimming falls back
 * to: a book is always named, but "no chosen colour" is the normal starting
 * state for every book, so there is nothing to refuse.
 *
 * This function does not validate `key` against the live palette. That is a
 * deliberate split, not an oversight, and it holds even though the ten keys
 * are final (`lib/cover-colour.ts`): a key this store already holds must keep
 * loading and round-tripping, never turn into a write-time error, if a later
 * build ever renames or drops a palette entry. Do not "tighten" this by
 * validating against the live set. `resolveCoverKey` is where an unknown
 * key is handled — on READ, deterministically, never here on write. The one
 * caller with an opinion about which keys are valid is the picker
 * (`components/cover-picker.tsx`), which only ever offers the live palette in
 * the first place.
 *
 * Setting a colour is activity, exactly like `renameBook`: a real change bumps
 * `updatedAt` so the book floats up the `listBooks`-sorted shelf, and setting
 * the SAME key again (including `null` to `null`) is an idempotent no-op —
 * no write, no recency bump, safe to re-run.
 */
export async function setBookCoverColour(
  id: BookId,
  key: string | null,
  now: number = Date.now()
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const book = await tx.store.get(id);
  if (!book) throw new Error(`No such book: ${id}`);

  if (key === (book.coverColourKey ?? null)) {
    await tx.done; // idempotent no-op: no write, no recency bump.
    return book;
  }

  const updated: Book = { ...book, coverColourKey: key, updatedAt: now };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * Whether a caught failure from {@link renameBook} or {@link addChapter}
 * describes a book that is gone because an UNRELATED delete already succeeded
 * — not a fresh failure the screen should speak (George, PR #344 round 8).
 *
 * Both throw the identical `No such book: ${id}` shape from their own
 * `if (!book) throw` guard. Once a book can be deleted (#337), that throw is
 * reachable by a race that has nothing to do with a NEW failure: a rename or
 * an add-chapter already in flight when a delete commits loses its target
 * mid-flight, and a naive catch would paint "No such book: …" over a shelf
 * that just correctly dropped the row.
 *
 * Deliberately narrow, so a genuine failure is never swallowed:
 *
 *   - The message must name the SAME id the caller was acting on — not merely
 *     start with "No such book" — so a stale race on one book can never
 *     absorb a real failure about another.
 *   - `stillPresent` is the caller's own check, against the store (the system
 *     of record, not React state), of whether that exact id exists right now.
 *     If it does, this is not the delete race — something else produced the
 *     same message, or the id came back some other way, and it is reported.
 *
 * Pure and synchronous on purpose: the caller resolves `stillPresent` (an
 * async store read) itself, so this decision — the part that actually needs
 * proving — is a plain function a Node test can pin without a fake database.
 */
export function isStaleBookFailure(
  cause: unknown,
  targetId: BookId,
  stillPresent: boolean
): boolean {
  if (stillPresent) return false;
  return (
    cause instanceof Error && cause.message === `No such book: ${targetId}`
  );
}

/**
 * The stores a book delete touches: the tree, and both halves of every clip
 * that goes with it.
 */
const DELETE_BOOK_STORES = [
  "books",
  "chapters",
  "segments",
  "takes",
  "clipMeta",
  "clipData",
] as const;

/**
 * Open the transaction a book delete needs. Strict durability: this removes the
 * only copy of a whole book of takes (#179). Split out so `DeleteBookTx` is
 * derived from the call itself and cannot drift from what actually opens — the
 * same shape `openTakeTx`/`TakeTx` uses above.
 */
function openDeleteBookTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(DELETE_BOOK_STORES, "readwrite", {
    durability: "strict",
  });
}

type DeleteBookTx = ReturnType<typeof openDeleteBookTx>;

/**
 * Delete a book and everything under it — chapters, segments, takes and the
 * audio behind them (#337).
 *
 * The first external tester could not remove a practice book, and at the
 * training the only way to clear one would be to uninstall the app, which takes
 * every recording with it. This is the op that makes a trial book disposable.
 *
 * It is also the most destructive write in the product, so it holds the same
 * three properties `clearSegmentTake` does, at a whole tree's scale:
 *
 *   - **ONE readwrite transaction** over all six stores. A delete that removed
 *     the book in one transaction and its clips in another could be interrupted
 *     between them and leave megabytes of audio no screen can ever reach and no
 *     delete can ever free — the storage pressure #12 exists about. Strict
 *     durability, like every other write that removes the only copy of a take
 *     (#179).
 *   - **Idempotent.** A missing book resolves without error and writes nothing,
 *     so a second tap, a retry after a failed reload, or a stale confirm is a
 *     true no-op rather than a throw the UI has to special-case.
 *   - **Reference-counted clips.** A clip is deleted only when no take OUTSIDE
 *     this book still points at it. Nothing shares a clip in the shipped app —
 *     every save mints a fresh `newClipId()` UUID, so "content-addressed" names
 *     the intent and not the current implementation — but this deletes many
 *     clips at once, so an unconditional delete would, the day an import
 *     dedupes, punch a book's worth of holes in another book's audio. Same
 *     guard `clearSegmentTake` already holds; `addTake`'s is #68.
 *
 * **The walk goes by the parent links, not the ordering arrays.** `chapterIds`
 * and `segmentIds` are denormalised order; `chapter.bookId` and
 * `segment.chapterId` (both indexed) are what says a row belongs to this book.
 * A row the array has lost — a half-written `addChapter` — is still this book's,
 * and once the book is gone nothing could ever reach it again. Going by the
 * index also means an id the array holds that points at ANOTHER book's chapter
 * is left alone rather than deleted out from under it. For the same reason the
 * walk does not depend on the `books` row existing: the row is removed if it is
 * there, but a tree whose book row has already gone is still collected, because
 * this is the only reclamation path there is.
 */
export async function deleteBook(bookId: BookId): Promise<void> {
  const db = await getDb();
  const tx = openDeleteBookTx(db);
  try {
    await deleteBookInTx(tx, bookId);
    await tx.done;
  } catch (cause) {
    // A THROWN error mid-transaction does not roll this back on its own:
    // IndexedDB auto-commits an inactive transaction unless it is aborted. The
    // same guard `saveTake` and `commitTranscode` hold — and it matters more
    // here than anywhere, because the tree deletes are issued BEFORE the clip
    // deletes. A throw in between (building the reference-count sets, or
    // anything the idb wrapper raises) would otherwise commit a database in
    // which the book, its chapters, its segments and its takes are gone while
    // `clipMeta`/`clipData` still hold their audio — megabytes that nothing can
    // reach and nothing can free, since this function is the only reclamation
    // path there is. That is precisely the leak the one-transaction shape
    // exists to prevent. (A failed *request* already aborts on its own; this
    // covers the thrown case.)
    try {
      tx.abort();
    } catch {
      // Already settled — aborted by a request failure, or committed. Nothing
      // to undo; the original cause below is what the caller needs.
    }
    // Observe the aborted transaction's `done` (idb creates it eagerly and it
    // rejects with AbortError on abort), so it is not an unhandled rejection.
    await tx.done.catch(() => {});
    throw cause;
  }
}

/**
 * The walk itself, on a caller-owned transaction.
 *
 * Split out so `deleteBook` above is exactly the transaction's lifetime — open,
 * run, commit, or abort — and the abort guard cannot be bypassed by an early
 * return added to the walk later.
 */
async function deleteBookInTx(tx: DeleteBookTx, bookId: BookId): Promise<void> {
  const books = tx.objectStore("books");
  const chapters = tx.objectStore("chapters");
  const segments = tx.objectStore("segments");
  const takes = tx.objectStore("takes");

  // Gather the whole tree first, by parent link, before deleting anything: the
  // clip reference count below has to see every take of this book removed
  // before it can ask what is left.
  //
  // This runs whether or not the `books` row is still there, and the row itself
  // is removed below only if present. An early return on a missing book would
  // make the orphan guarantee conditional on the one row that is itself part of
  // what is being removed: a tree whose `books` row had gone could never be
  // reclaimed by anything, because this is the app's only reclamation path and
  // it would no-op on exactly the state that needs it. Idempotency is unchanged
  // — on a database that does not hold this book the index returns nothing and
  // the transaction commits empty.
  const ownedChapters = await chapters.index("bookId").getAll(bookId);
  const doomedTakes: Take[] = [];
  const doomedSegments: SegmentId[] = [];
  for (const chapter of ownedChapters) {
    const ownedSegments = await segments.index("chapterId").getAll(chapter.id);
    for (const segment of ownedSegments) {
      doomedSegments.push(segment.id);
      // Every take row of the segment, not just `activeTakeId`: the index is the
      // parent link, and a stale row the pointer has moved off would otherwise
      // survive its segment and keep a clip alive forever.
      doomedTakes.push(...(await takes.index("segmentId").getAll(segment.id)));
    }
  }

  for (const take of doomedTakes) await takes.delete(take.id);
  for (const segmentId of doomedSegments) await segments.delete(segmentId);
  for (const chapter of ownedChapters) await chapters.delete(chapter.id);
  // `delete` on an absent key is a no-op in IndexedDB, so the orphan case needs
  // no branch here: the row goes if it is there, and nothing is written if not.
  await books.delete(bookId);

  // The take rows are gone, so what `getAll` returns now is exactly the set of
  // references that survive this delete. A clip nothing in that set names is
  // unreachable audio and goes with the book; a clip something still names is
  // another segment's only copy and stays.
  const survivingClipIds = new Set(
    (await takes.getAll()).map((take) => take.clipId)
  );
  const doomedClipIds = new Set(doomedTakes.map((take) => take.clipId));
  for (const clipId of doomedClipIds) {
    if (survivingClipIds.has(clipId)) continue;
    await tx.objectStore("clipMeta").delete(clipId);
    await tx.objectStore("clipData").delete(clipId);
  }
}

// ── Reorder (#953) ───────────────────────────────────────────────────────

/**
 * Throw a `RangeError` unless `toIndex` is an integer — the one check
 * `moveToIndex` makes, exported so a hook can refuse a bad target before it
 * touches any state, instead of throwing from inside a React updater.
 */
export function assertReorderTarget(toIndex: number): void {
  if (!Number.isInteger(toIndex)) {
    throw new RangeError(`A reorder target must be an integer: ${toIndex}`);
  }
}

/**
 * `items` with the one at `fromIndex` moved to `toIndex` — the single
 * definition of a reorder target, shared by the two store writes below and by
 * the hooks' optimistic patches, so the row a screen shows and the row the
 * store writes cannot land in different places.
 *
 * `toIndex` is ABSOLUTE — the final position of the moved item — never a
 * delta, so the same call made twice gives the same result. It must be an
 * integer (a `RangeError` otherwise: a fractional or NaN target is a caller
 * bug, not a position) and is clamped to `[0, items.length - 1]`, so a drop
 * past either end lands on that end. Pure; the input is not mutated.
 */
export function moveToIndex<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  assertReorderTarget(toIndex);
  const out = items.slice();
  const [moved] = out.splice(fromIndex, 1);
  if (moved === undefined) return items.slice(); // nothing at fromIndex
  const to = Math.min(Math.max(toIndex, 0), out.length);
  out.splice(to, 0, moved);
  return out;
}

/**
 * The plan for moving `movingId` to visible position `toIndex` within a
 * stored ordering array, or `null` when `movingId` is not a resolvable member
 * of it.
 *
 * `records[i]` is the store's answer for `storedIds[i]` (`undefined` for a
 * dangling id). The VISIBLE rows are the resolvable ones in array order;
 * `toIndex` is a position among those. The new stored array keeps every
 * dangling id in its own slot and fills the remaining slots, left to right,
 * with the visible rows in their new order — so a dangling id never moves,
 * is never dropped, and never shifts what the target means.
 *
 * `changed` is false when the visible order is unchanged, which is the
 * caller's signal to write nothing.
 */
function planReorder<Id extends string, R extends { readonly id: Id }>(
  storedIds: readonly Id[],
  records: readonly (R | undefined)[],
  movingId: Id,
  toIndex: number
): { ids: Id[]; order: R[]; changed: boolean } | null {
  const visible = records.filter((r): r is R => r !== undefined);
  const from = visible.findIndex((r) => r.id === movingId);
  if (from === -1) return null;
  const order = moveToIndex(visible, from, toIndex);
  const changed = order.some((row, i) => row !== visible[i]);
  let next = 0;
  const ids = storedIds.map((id, i) =>
    records[i] === undefined ? id : order[next++]!.id
  );
  return { ids, order, changed };
}

/**
 * Abort a transaction a thrown error interrupted, and observe its `done`.
 *
 * A THROWN error mid-transaction does not roll it back on its own: IndexedDB
 * auto-commits an inactive transaction unless it is aborted, so the writes
 * already issued would land without the rest. The same guard `deleteBook`
 * holds inline above. (A failed *request* already aborts on its own; this
 * covers the thrown case.)
 */
async function abortQuietly(
  abort: () => void,
  done: Promise<void>
): Promise<void> {
  try {
    abort();
  } catch {
    // Already settled — aborted by a request failure, or committed. Nothing
    // to undo; the caller rethrows the original cause.
  }
  // idb creates `done` eagerly and it rejects with AbortError on abort; the
  // original cause is what the caller needs, not this.
  await done.catch(() => {});
}

// ── Chapters ─────────────────────────────────────────────────────────────

/**
 * The ordinal a new chapter gets: one past the highest already in the book, and
 * 1 for an empty one.
 *
 * Pure, and the single definition of that number — `addChapter` calls it inside
 * its own write transaction, and the Books screen calls it over the chapters it
 * has already loaded to pre-fill the Add-chapter prompt (#609). One function,
 * so the "Chapter N" the field offers and the `number` the write derives cannot
 * drift, the way {@link nextBookName} already ties the New Book field to
 * {@link createBook}.
 *
 * **`max + 1`, deliberately NOT {@link nextBookName}'s first-unused rule.** A
 * book's placeholder is a label and reusing a freed one is the point (#360); a
 * chapter's `number` is its position in the export concatenation, so filling a
 * hole left by a removed chapter would drop the new recording into the middle
 * of the book rather than at the end.
 */
export function nextChapterNumber(existingNumbers: Iterable<number>): number {
  let max = 0;
  for (const n of existingNumbers) if (n > max) max = n;
  return max + 1;
}

/**
 * Add a chapter to a book. `number` defaults to the next ordinal
 * ({@link nextChapterNumber}), computed inside the one transaction that also
 * writes the chapter and bumps the book — never a read-tx-then-write-tx seam.
 *
 * `name` is the label the translator typed at the Add-chapter prompt (#609),
 * normalised exactly as {@link renameChapter} normalises a rename: trimmed, and
 * `null` when blank or whitespace-only. `null` is also what an untouched prompt
 * writes, because the screen sends `""` rather than the "Chapter N" string it
 * displayed — so a one-tap create stores nothing new and the row goes on
 * showing the ordinal this transaction derived, which is the right number even
 * when another copy of the app moved it after the prompt rendered. Unlike
 * `createBook`'s blank fallback there is nothing to derive here and so no race
 * to be safe from: the default is an absence, not a name.
 */
export async function addChapter(
  bookId: BookId,
  number?: number,
  name = ""
): Promise<Chapter> {
  const db = await getDb();
  const tx = db.transaction(["books", "chapters"], "readwrite");
  const book = await tx.objectStore("books").get(bookId);
  if (!book) throw new Error(`No such book: ${bookId}`);

  let resolvedNumber = number;
  if (resolvedNumber === undefined) {
    const existing = await Promise.all(
      book.chapterIds.map((id) => tx.objectStore("chapters").get(id))
    );
    resolvedNumber = nextChapterNumber(
      existing.flatMap((chapter) => (chapter ? [chapter.number] : []))
    );
  }

  const trimmed = name.trim();
  const chapter: Chapter = {
    id: uuid() as ChapterId,
    bookId,
    number: resolvedNumber,
    // Blank stays unnamed, and the display falls back to "Chapter {number}"
    // until the facilitator names it — at this prompt (#609) or later through
    // Rename (#264).
    name: trimmed === "" ? null : trimmed,
    segmentIds: [],
  };
  await tx.objectStore("chapters").put(chapter);
  await tx.objectStore("books").put({
    ...book,
    chapterIds: [...book.chapterIds, chapter.id],
    updatedAt: Date.now(),
  });
  await tx.done;
  return chapter;
}

export async function getChapter(id: ChapterId): Promise<Chapter | undefined> {
  return (await getDb()).get("chapters", id);
}

/**
 * Rename a chapter in place (#264 — a chapter is labelled for its span, e.g.
 * "Mark 6").
 *
 * Get-then-put in ONE readwrite transaction, like {@link renameBook}. The name
 * is trimmed; unlike a book, a chapter has a default ("Chapter {number}"), so a
 * blank/whitespace-only rename CLEARS the label back to `null` rather than being
 * refused. Setting the name to what it already is writes nothing (idempotent
 * no-op). The chapter's `number` — its ordinal and export position — is never
 * touched; the name is a label over it.
 *
 * A real rename also bumps the parent book's `updatedAt` in the SAME transaction
 * — labelling a chapter is activity on its book, and `listBooks` sorts by
 * `updatedAt`, so the book floats up the shelf exactly as `addChapter`,
 * `renameBook`, and recording do (G4). The no-op path skips the bump, so a
 * re-run never reshuffles the shelf.
 *
 * Concurrent renames use the same transaction-order last-write-wins policy as
 * {@link renameBook} (#394). The scope overlaps `renameBook` on `books`, so a
 * chapter rename preserves a competing book rename while updating its timestamp.
 * A parent-book deletion either removes the renamed chapter afterward or makes
 * this transaction fail with `No such chapter`, depending on transaction order.
 */
export async function renameChapter(
  id: ChapterId,
  name: string,
  now: number = Date.now()
): Promise<Chapter> {
  const db = await getDb();
  const tx = db.transaction(["chapters", "books"], "readwrite");
  const chapter = await tx.objectStore("chapters").get(id);
  if (!chapter) throw new Error(`No such chapter: ${id}`);

  const trimmed = name.trim();
  // Blank clears back to the default "Chapter N" (chapters, unlike books, have
  // one), rather than storing an empty label.
  const nextName = trimmed === "" ? null : trimmed;
  if (nextName === (chapter.name ?? null)) {
    await tx.done; // idempotent no-op: no write, no recency bump.
    return chapter;
  }

  const updated: Chapter = { ...chapter, name: nextName };
  await tx.objectStore("chapters").put(updated);
  // Float the parent book up the shelf, in this same transaction. A dangling
  // parent is skipped rather than failing a rename that otherwise succeeded.
  const book = await tx.objectStore("books").get(chapter.bookId);
  if (book) {
    await tx.objectStore("books").put({ ...book, updatedAt: now });
  }
  await tx.done;
  return updated;
}

/**
 * Move one chapter to an absolute position in its book (#953 — press-and-hold
 * reorder on the Books screen).
 *
 * `toIndex` counts the chapters a screen actually shows: the ids in
 * `book.chapterIds` whose record resolves, in array order — exactly the rows
 * `use-books.ts`'s card holds, since it drops a dangling id rather than render
 * a blank. See {@link planReorder} for how that maps back onto the stored
 * array; in short, a dangling id keeps its stored slot and the resolvable ids
 * fill the other slots in their new order. An out-of-range target clamps to
 * the first or last row ({@link moveToIndex}).
 *
 * The rules, and why:
 *
 *   - **ONE readwrite transaction** over `books` and `chapters`, get-then-put,
 *     aborted on a thrown error (the `deleteBook` guard) — the array and the
 *     numbers commit together or not at all. A crash between the two would
 *     leave badges and export file names that disagree with the order.
 *   - **Dense renumbering** (DRI pick, #953 scope Q1): every resolvable
 *     chapter's `number` becomes its visible position + 1, so the badges read
 *     1..N and the export's `nameChapter(number)` follows the order. Only rows
 *     whose number changes are written. A dangling id is not numbered — it has
 *     no record — and export still counts it as missing.
 *   - **Names are not touched** (scope Q5): "Mark 6" stays "Mark 6"; only the
 *     number badge and the file name follow position.
 *   - **No shelf bump** (scope Q4): the book's `updatedAt` is left alone, so
 *     the card a translator is dragging inside does not jump to the top of the
 *     `listBooks`-sorted shelf. This is the one tree edit that differs from
 *     `renameChapter` here, on purpose.
 *   - **Idempotent.** The target is absolute, so a re-run lands in the same
 *     state; a move that leaves the order as it was writes nothing at all.
 *
 * Returns the book's resolvable chapters in their new order, with the numbers
 * they now hold — what a caller patches its rows from.
 */
export async function moveChapter(
  chapterId: ChapterId,
  toIndex: number
): Promise<Chapter[]> {
  const db = await getDb();
  const tx = db.transaction(["books", "chapters"], "readwrite");
  try {
    const chapters = tx.objectStore("chapters");
    const books = tx.objectStore("books");
    const chapter = await chapters.get(chapterId);
    if (!chapter) throw new Error(`No such chapter: ${chapterId}`);
    const book = await books.get(chapter.bookId);
    if (!book) throw new Error(`No such book: ${chapter.bookId}`);

    const records = await Promise.all(
      book.chapterIds.map((id) => chapters.get(id))
    );
    const plan = planReorder(book.chapterIds, records, chapterId, toIndex);
    if (!plan) {
      throw new Error(`Chapter ${chapterId} is not listed in its book`);
    }
    if (!plan.changed) {
      await tx.done; // idempotent no-op: no write, no recency bump.
      return plan.order;
    }

    // No `updatedAt`: a reorder does not float the book up the shelf.
    await books.put({ ...book, chapterIds: plan.ids });
    const renumbered: Chapter[] = [];
    for (const [position, row] of plan.order.entries()) {
      const number = position + 1;
      if (row.number === number) {
        renumbered.push(row);
        continue;
      }
      const updated: Chapter = { ...row, number };
      await chapters.put(updated);
      renumbered.push(updated);
    }
    await tx.done;
    return renumbered;
  } catch (cause) {
    await abortQuietly(() => tx.abort(), tx.done);
    throw cause;
  }
}

/**
 * Resolve a book to its chapters, in `book.chapterIds` order, alongside the count
 * of ids that no longer resolve to a chapter record — the export order a Share
 * Book walks. Mirrors `resolveChapterClipIds`'s `{ …, missing }` shape: a
 * dangling id is dropped from the list but COUNTED, so an export can admit to a
 * hole rather than share a book "as if whole" (Frank R-B7-book P2).
 */
export async function resolveBookChapters(
  bookId: BookId
): Promise<{ chapters: Chapter[]; missing: number }> {
  const db = await getDb();
  const book = await db.get("books", bookId);
  if (!book) return { chapters: [], missing: 0 };
  const resolved = await Promise.all(
    book.chapterIds.map((id) => db.get("chapters", id))
  );
  const chapters = resolved.filter((c): c is Chapter => c !== undefined);
  return { chapters, missing: resolved.length - chapters.length };
}

// ── Segments ─────────────────────────────────────────────────────────────

/**
 * Append one segment to the end of a chapter (the Segments-screen "+", A3).
 *
 * One segment per call, appended last (last export position). Get-then-create
 * in a single transaction — the idempotency bar: never two.
 */
export async function addSegment(chapterId: ChapterId): Promise<Segment> {
  const db = await getDb();
  const tx = db.transaction(["chapters", "segments"], "readwrite");
  const chapter = await tx.objectStore("chapters").get(chapterId);
  if (!chapter) throw new Error(`No such chapter: ${chapterId}`);

  const segment: Segment = {
    id: uuid() as SegmentId,
    chapterId,
    index: chapter.segmentIds.length + 1,
    reference: null,
    // Unlabelled by default — the row shows the ordinal alone until the
    // facilitator labels it for its verses (#591).
    label: null,
    activeTakeId: null,
    status: "not-started",
  };
  await tx.objectStore("segments").put(segment);
  await tx.objectStore("chapters").put({
    ...chapter,
    segmentIds: [...chapter.segmentIds, segment.id],
  });
  await tx.done;
  return segment;
}

/**
 * Label a segment in place (#591 — "verses 3–4", so a facilitator can tell
 * which verses a segment holds without playing it).
 *
 * The chapter-name rules, deliberately ({@link renameChapter}): get-then-put in
 * ONE readwrite transaction, the label trimmed, a blank/whitespace-only rename
 * CLEARS it back to `null` (a segment has a default — its ordinal), and a
 * rename to the current label writes nothing. Only `label` changes: the
 * ordinal, the chapter's order, the take pointer and the status are the audio's
 * identity and progress, and a label is neither.
 *
 * Unlike a chapter rename it does not bump the book's `updatedAt`: the store is
 * `segments` alone, matching `addSegment` and `setSegmentFinished`, the other
 * segment edits that leave the shelf order where it was.
 */
export async function renameSegment(
  id: SegmentId,
  label: string
): Promise<Segment> {
  const db = await getDb();
  const tx = db.transaction("segments", "readwrite");
  const segment = await tx.store.get(id);
  if (!segment) throw new Error(`No such segment: ${id}`);

  const trimmed = label.trim();
  const nextLabel = trimmed === "" ? null : trimmed;
  if (nextLabel === segment.label) {
    await tx.done; // idempotent no-op: no write.
    return segment;
  }

  const updated: Segment = { ...segment, label: nextLabel };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * Move one segment to an absolute position in its chapter (#953 — press-and-
 * hold reorder on the Segments screen). Moves the chapter's export
 * concatenation order with it, since `segmentIds` is that order.
 *
 * {@link moveChapter}'s rules, one level down: ONE readwrite transaction over
 * `chapters` and `segments`, aborted on a thrown error; the target counts the
 * rows the screen shows (resolvable ids), and a dangling id keeps its stored
 * slot; `index` is renumbered densely to visible position + 1 (DRI pick, #953
 * scope Q1 — the renumber `Segment.index`'s own docblock has always said a
 * reorder owes), written only where it changes; a move that changes nothing
 * writes nothing. Label, take pointer and status are not touched, and nothing
 * above the chapter is — the book's shelf position stays where it was, as for
 * every other segment edit.
 *
 * Returns the chapter's resolvable segments in their new order, with the
 * indexes they now hold.
 */
export async function moveSegment(
  segmentId: SegmentId,
  toIndex: number
): Promise<Segment[]> {
  const db = await getDb();
  const tx = db.transaction(["chapters", "segments"], "readwrite");
  try {
    const segments = tx.objectStore("segments");
    const chapters = tx.objectStore("chapters");
    const segment = await segments.get(segmentId);
    if (!segment) throw new Error(`No such segment: ${segmentId}`);
    const chapter = await chapters.get(segment.chapterId);
    if (!chapter) throw new Error(`No such chapter: ${segment.chapterId}`);

    const records = await Promise.all(
      chapter.segmentIds.map((id) => segments.get(id))
    );
    const plan = planReorder(chapter.segmentIds, records, segmentId, toIndex);
    if (!plan) {
      throw new Error(`Segment ${segmentId} is not listed in its chapter`);
    }
    if (!plan.changed) {
      await tx.done; // idempotent no-op: no write.
      return plan.order;
    }

    await chapters.put({ ...chapter, segmentIds: plan.ids });
    const renumbered = await renumberSegments(segments, plan.order);
    await tx.done;
    return renumbered;
  } catch (cause) {
    await abortQuietly(() => tx.abort(), tx.done);
    throw cause;
  }
}

/**
 * Renumber `order` densely to position + 1, writing only where `index`
 * changes. Split out of {@link moveSegment} so its renumber write and
 * {@link deleteSegment}'s (#590) are the same code, not two copies of the
 * loop `Segment.index`'s own docblock has always said a reorder — and now a
 * delete — owes.
 */
async function renumberSegments(
  store: { put(value: Segment): Promise<SegmentId> },
  order: readonly Segment[]
): Promise<Segment[]> {
  const renumbered: Segment[] = [];
  for (const [position, row] of order.entries()) {
    const index = position + 1;
    if (row.index === index) {
      renumbered.push(row);
      continue;
    }
    const updated: Segment = { ...row, index };
    await store.put(updated);
    renumbered.push(updated);
  }
  return renumbered;
}

/**
 * The stores a segment delete touches: the tree link (the chapter it hangs
 * off), the segment itself, its take, both halves of its clip, and the book
 * it floats (#590).
 */
const DELETE_SEGMENT_STORES = [
  "books",
  "chapters",
  "segments",
  "takes",
  "clipMeta",
  "clipData",
] as const;

/**
 * Delete one segment — the row itself, not only its audio (#590, reversing
 * G4's "Erase erases the audio and keeps the row" for the one entry that asks
 * to remove the row rather than clear it). Densely renumbers the chapter's
 * remaining segments — the renumber `Segment.index`'s own docblock has always
 * said a delete batch owes.
 *
 * {@link deleteBook}'s rules, one level down, plus the reference-counted clip
 * delete {@link clearSegmentTake} (`takes.ts`) already holds:
 *
 *   - **ONE readwrite transaction, strict durability.** This removes the only
 *     copy of a take, the same bar every other write that does (#179).
 *   - **Idempotent.** A segment that is already gone resolves without error
 *     and writes nothing — a second tap, a retry, or a stale confirm is a true
 *     no-op, exactly like `deleteBook`'s missing-id case.
 *   - **Reference-counted clip.** The clip is deleted only when no OTHER take
 *     still points at it — the identical guard `clearSegmentTake` holds:
 *     nothing shares a clip in the shipped app, but a future
 *     content-addressed import could dedupe, and an unconditional delete
 *     would then punch a hole in another segment's only copy.
 *   - **Dense renumbering**, reusing {@link renumberSegments} — the same
 *     write `moveSegment` makes, not a second copy of it. A dangling id
 *     already in `chapter.segmentIds` (unrelated to this delete) keeps its
 *     stored slot and is not renumbered, exactly as `moveSegment`'s
 *     `planReorder` leaves one.
 *   - **Editing is activity**: the book floats to the top of the
 *     `listBooks`-sorted shelf in the same transaction — the bump
 *     `clearSegmentTake`/`writeTakeInTx` make for exactly this reason.
 *     **Inference, not a recorded decision**: `moveSegment`/`moveChapter`
 *     deliberately do NOT bump for a pure reorder (scope Q4), but a delete
 *     also discards a recording (or the last trace of an empty row), which is
 *     what a bump has always meant elsewhere in this file. Revisit if the DRI
 *     says otherwise.
 *
 * **An in-flight transcode or a held take cannot resurrect a deleted
 * segment — cited, not newly guarded.** The Finished-transcode sweep
 * (`hooks/finish-transcode.ts`) loads a segment's PCM through
 * `loadSegmentClip` before it ever holds the encoder lane; once this
 * transaction commits, that walk (`lib/storage/segment-audio.ts`'s `walk`)
 * finds no segment row and returns `{ kind: "no-segment" }`, which
 * `sweepOnce`'s `audio.kind !== "resolved"` branch already treats as "not
 * this clip's job any more" and skips — the same branch that already handles
 * a segment "erased, re-recorded, already MP3" mid-pass. And
 * `commitTranscode` (`lib/storage/transcode.ts`) re-checks its own target
 * inside its own transaction: `!segment` (or, since the take goes with it,
 * `!take`) resolves `"stale"` and writes nothing — the identical guard
 * `tests/delete-book.test.ts`'s "does not resurrect a segment or a clip when
 * a transcode commits after the delete" already pins for `deleteBook`. No new
 * coordination is added here; both the sweep and the commit were already
 * built to survive their target vanishing under them.
 *
 * Returns the chapter's resolvable segments in their new order, with the
 * indexes they now hold — what a caller (the hook) patches its rows from; `[]`
 * only when the chapter is now empty. An already-gone segment returns `null`,
 * not `[]`: nothing was read, so there is no order to report, and a caller
 * that took `[]` as "the chapter is empty" would overwrite a good order.
 */
export async function deleteSegment(
  segmentId: SegmentId
): Promise<Segment[] | null> {
  const db = await getDb();
  const tx = db.transaction(DELETE_SEGMENT_STORES, "readwrite", {
    durability: "strict",
  });
  try {
    const segments = tx.objectStore("segments");
    const chapters = tx.objectStore("chapters");
    const takes = tx.objectStore("takes");

    const segment = await segments.get(segmentId);
    if (!segment) {
      await tx.done; // idempotent no-op: already gone, nothing to renumber.
      return null;
    }
    const chapter = await chapters.get(segment.chapterId);
    if (!chapter) throw new Error(`No such chapter: ${segment.chapterId}`);

    // The take and its clip, reference-counted exactly as `clearSegmentTake`
    // deletes them (takes.ts). The take row goes first so the survivor scan
    // below sees only the takes that are left.
    const priorTakeId = segment.activeTakeId;
    if (priorTakeId !== null) {
      const priorTake = await takes.get(priorTakeId);
      await takes.delete(priorTakeId);
      if (priorTake) {
        const survivors = await takes.getAll();
        const stillReferenced = survivors.some(
          (t) => t.clipId === priorTake.clipId
        );
        if (!stillReferenced) {
          await tx.objectStore("clipMeta").delete(priorTake.clipId);
          await tx.objectStore("clipData").delete(priorTake.clipId);
        }
      }
    }

    await segments.delete(segmentId);
    const nextIds = chapter.segmentIds.filter((id) => id !== segmentId);
    await chapters.put({ ...chapter, segmentIds: nextIds });

    const records = await Promise.all(nextIds.map((id) => segments.get(id)));
    const visible = records.filter((r): r is Segment => r !== undefined);
    const renumbered = await renumberSegments(segments, visible);

    // Deleting a segment discards its recording (or its empty row) — activity
    // on the book, the same bump `clearSegmentTake`/`writeTakeInTx` make.
    const book = await tx.objectStore("books").get(chapter.bookId);
    if (book) {
      await tx.objectStore("books").put({ ...book, updatedAt: Date.now() });
    }

    await tx.done;
    return renumbered;
  } catch (cause) {
    await abortQuietly(() => tx.abort(), tx.done);
    throw cause;
  }
}

export async function getSegment(id: SegmentId): Promise<Segment | undefined> {
  return (await getDb()).get("segments", id);
}

export async function getSegmentsOfChapter(
  chapterId: ChapterId
): Promise<Segment[]> {
  const db = await getDb();
  const chapter = await db.get("chapters", chapterId);
  if (!chapter) return [];
  const segments = await Promise.all(
    chapter.segmentIds.map((id) => db.get("segments", id))
  );
  // Preserve the chapter's declared order; drop any dangling ids.
  return segments.filter((s): s is Segment => s !== undefined);
}

/**
 * The chapter's finished/total/recorded roll-up for the Books-screen counter
 * and its storage-pressure gate.
 *
 * A cheap read — segments only, never clips. `total` counts resolvable segment
 * rows; a dangling id contributes to neither count. An empty chapter is
 * `{ finished: 0, total: 0, recorded: 0 }`, and the UI shows no counter when
 * `total === 0`.
 *
 * `recorded` (#542 Part B) counts segments with `activeTakeId !== null` — a
 * segment that holds a take, finished or not — from the SAME
 * `getSegmentsOfChapter` read `finished`/`total` already make, so it costs no
 * extra IndexedDB trip. It exists because the storage-pressure line's copy
 * ("mark segments finished", "share your work and remove it") only makes
 * sense once a recording exists to reclaim, and neither `finished` (too
 * narrow — a "draft" segment has reclaimable bytes too) nor `total` (too
 * wide — an unrecorded segment has nothing to reclaim) answers that; see
 * `lib/view/book-rows.ts`'s `hasReclaimableAudio`, which sums this field
 * across every chapter of every book.
 *
 * Known corner (documented, cheap to revisit): an externally-corrupted
 * `affirmed`-but-dangling segment counts as finished (and recorded) here while
 * its row renders as never-recorded. It is near-unreachable by construction —
 * `addTake` demotes `affirmed → draft` and `setSegmentFinished(true)` requires
 * an active take, so only external clip loss produces it — and a full audio
 * walk per segment on every render is not worth its cost.
 */
export async function chapterProgress(
  chapterId: ChapterId
): Promise<{ finished: number; total: number; recorded: number }> {
  const segments = await getSegmentsOfChapter(chapterId);
  const finished = segments.filter((s) => isFinished(s.status)).length;
  const recorded = segments.filter((s) => s.activeTakeId !== null).length;
  return { finished, total: segments.length, recorded };
}

/**
 * Resolve a chapter to the ordered list of clips that make up its export.
 *
 * Walks `chapter.segmentIds` directly (the nested section loop is gone).
 * Segments with no active take are skipped rather than treated as an error: a
 * partially-recorded chapter should still export the parts that are done. The
 * returned `missing` count lets the UI say so honestly.
 *
 * "Honestly" is why every id here is one `resolveSegmentAudio` has confirmed
 * has both halves of its clip behind it — the metadata row and the samples
 * key. It probes the second rather than reading it, so the check costs a key
 * lookup per segment and not a chapter of PCM.
 *
 * It used to push `take.clipId` on the strength of the take row alone. With an
 * export path in place (#18), a take whose clip had gone would count as
 * exported: the chapter would read as complete and the segment would be absent
 * from the file. A gap the count admits to is recoverable; one it does not is
 * not.
 */
export async function resolveChapterClipIds(
  chapterId: ChapterId
): Promise<{ clipIds: ClipId[]; missing: number }> {
  const db = await getDb();
  const chapter = await db.get("chapters", chapterId);
  if (!chapter) return { clipIds: [], missing: 0 };

  const clipIds: ClipId[] = [];
  let missing = 0;
  for (const segmentId of chapter.segmentIds) {
    const audio = await resolveSegmentAudio(segmentId);
    if (audio.kind === "resolved") clipIds.push(audio.clip.id);
    else missing++;
  }
  return { clipIds, missing };
}
