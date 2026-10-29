/**
 * Book repository — the Book → Chapter → Segment → Take tree.
 *
 * Ordering is explicit (`chapterIds`, `segmentIds` arrays) rather than derived
 * from a sort key, because export is defined as "concatenation of segments"
 * and the order of that concatenation is a decision the user makes, not a
 * property of the data.
 *
 * The take writes and the finished flag are NOT here: `saveTake`,
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

import type { PlaylistCandidate } from "@/lib/audio/chapter-queue";
import { highestSlot, slotOf } from "@/lib/chapter-slot";
import type { CoverColourKey } from "@/lib/cover-colour";
import { getDb, type TcMobileDb } from "./db";
import { resolveSegmentAudio } from "./segment-audio";
import { withClipBytes } from "./clip-bytes";
import { deleteClipIfUnreferenced, type ClipUseTx } from "./clips";
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
 * The placeholder SLOT for a new book: the first one no unnamed book on the
 * shelf is already showing. 1-based, and rendered as "Book 001" by the string
 * table, never here (#169).
 *
 * Pure, and the single definition of the slot — both callers go through it, so
 * the placeholder the New Book field is pre-filled with (the Books screen, off
 * the shelf it has already loaded) and the slot a blank confirm actually writes
 * ({@link createBook}) cannot drift (#314). The pre-fill is DISPLAY only: an
 * untouched field is confirmed as `""`, so the row that lands is always derived
 * inside the write transaction below, never from the rendered string.
 *
 * **First unused, not `count + 1`** (#360). The count-based namer this replaces
 * assumed books are only ever added. Once a book can be deleted, deleting
 * "Book 001" leaves one book and makes the next one "Book 002" as well — two
 * identical rows. Names were not unique keys then (new writes are held to
 * one since #1272, but a phone may still hold two "Mark"s, U4a), and the delete confirm puts the book's name in its accessible name,
 * so a duplicate leaves a destructive, irreversible dialog unable to say which
 * book it is about to destroy — on a screen built for people who may not read,
 * where discarding practice books is the normal training workflow.
 *
 * **Only UNNAMED books hold a slot against this** — that is what makes the rule
 * survive translation. Before #169 the placeholder was matched as a stored
 * string, so a facilitator who typed the literal "Book 003" reserved slot 3 and
 * a book renamed away from it released one. Now the comparison is over slots,
 * which no UI language changes: a typed name occupies nothing (as "Mark" never
 * did), and a renamed book releases the slot it is no longer showing. The one
 * narrowing is a facilitator who types this locale's placeholder wording by
 * hand — two rows can then read alike, exactly as two "Mark"s already can, and
 * unlike the #360 case it takes a deliberate retype to reach.
 *
 * The loop is bounded by the number of books + 1: with N books, at most N of
 * the first N + 1 slots can be taken.
 */
export function nextBookNumber(
  books: Iterable<Pick<Book, "name" | "number">>
): number {
  const taken = new Set<number>();
  for (const book of books) {
    if (book.name === null) taken.add(book.number);
  }
  for (let n = 1; ; n++) {
    if (!taken.has(n)) return n;
  }
}

/**
 * Thrown when a name is already another book's (#1272, S13: "require unique
 * names for the books"). Matched by `name` in `hooks/save-failure.ts`, so the
 * New Book and Rename sheets can ask for a different name in place.
 */
export class BookNameTakenError extends Error {
  override readonly name = "BookNameTakenError";
  constructor() {
    super("Another book already has this name");
  }
}

/**
 * The key two book names are compared by: Unicode NFC, trimmed, runs of
 * whitespace collapsed to one space, lower-cased. So "Mark", " mark " and
 * "MARK" are one name, and a name typed with a combining accent equals the
 * same name typed precomposed. Not locale-sensitive (`toLowerCase`, not
 * `toLocaleLowerCase`), so the answer does not change with the phone's
 * language. Pure; the one definition, used by the writes below.
 */
export function bookNameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Refuse `name` if a book other than `exceptId` already holds it (#1272).
 * Unnamed books (`name === null`) hold nothing. Existing duplicates are left
 * alone (U4a): this only looks at the name being written, never at the rest of
 * the shelf. Called inside the write's own transaction, with the shelf that
 * transaction read.
 */
export function assertBookNameFree(
  shelf: readonly Pick<Book, "id" | "name">[],
  name: string,
  exceptId?: BookId
): void {
  const key = bookNameKey(name);
  for (const book of shelf) {
    if (book.id === exceptId || book.name === null) continue;
    if (bookNameKey(book.name) === key) throw new BookNameTakenError();
  }
}

/**
 * Create a book, named by the translator (#314) or by the placeholder.
 *
 * The name is trimmed, exactly as {@link renameBook} trims it — one validation
 * rule for the one naming field, wherever it is shown. A blank or
 * whitespace-only name is not an error: the book is simply stored UNNAMED and
 * shows its placeholder, which is what preserves the one-tap New Book the
 * corner `+` used to be. Nothing writes the placeholder's words to disk (#169).
 *
 * The slot is derived INSIDE the one readwrite transaction that writes the
 * row, never from a screen's render state: two rapid blank confirms both reading
 * an empty shelf from the same render would both persist slot 1. IndexedDB
 * serialises overlapping readwrite transactions, so deriving and putting in one
 * transaction gives the second confirm the first's write — slot 1, then slot 2.
 * That race-safety is the property `createNextBook` held before #314 split
 * naming off from creating, and it is preserved here rather than moved to the
 * caller.
 *
 * The shelf read is now UNCONDITIONAL, where the string-named version skipped
 * it whenever a name was typed. Every row carries a slot, so the field means
 * one thing on every book rather than holding a placeholder value on the ones
 * born named; and the read is a `getAll` over a metadata-only store (no clip
 * bytes live here) at the frequency a person taps Create.
 *
 * A supplied name that another book already has is refused with
 * {@link BookNameTakenError} (#1272, S13; compared by {@link bookNameKey}); it
 * is never silently altered to be unique. Books already on a phone that share a
 * name are left alone (U4a). That is also why the New Book dialog sends `""` rather than the placeholder string it
 * displayed when the field is untouched — a supplied "Book 001" would bypass the
 * derivation below, and two documents open on the same shelf would both write it
 * (George R1 P2-3).
 */
export async function createBook(
  name: string,
  languageCode: string | null = null,
  now: number = Date.now(),
  coverColourKey: CoverColourKey | null = null
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const trimmed = name.trim();
  try {
    const shelf = await tx.store.getAll();
    // Names are unique for NEW books (#1272, S13). Checked on the shelf this
    // same transaction read, so two overlapping creates cannot both pass.
    if (trimmed !== "") assertBookNameFree(shelf, trimmed);
    const book: Book = {
      id: uuid() as BookId,
      name: trimmed === "" ? null : trimmed,
      number: nextBookNumber(shelf),
      languageCode,
      chapterIds: [],
      createdAt: now,
      updatedAt: now,
      // Unset by default — the facilitator has not chosen one yet (#957).
      // `resolveCoverKey` derives a colour from the id until they do. The New
      // Book sheet may pass one (#1190) so the colour lands in this same write
      // rather than in a second one after it. Like `setBookCoverColour`, this
      // does not validate against the live palette; the picker only offers it.
      coverColourKey,
      // A new book lands at the TOP of the shelf (#338), as it always has; the
      // books already there move down one, in the order the user left them.
      shelfPosition: 0,
      // v12 (#1462): made blank, licence not chosen yet (R20: the share step
      // pre-selects CC BY-SA 4.0 without storing it), written now.
      provenance: { kind: "blank" },
      licence: null,
      modifiedAt: now,
    };
    await tx.store.put(book);
    for (const [index, row] of byShelfPosition(shelf).entries()) {
      if (row.shelfPosition !== index + 1) {
        await tx.store.put({
          ...row,
          shelfPosition: index + 1,
          modifiedAt: now,
        });
      }
    }
    await tx.done;
    return book;
  } catch (cause) {
    // One transaction: a put that threw mid-renumber must not commit the new
    // row and a partly renumbered shelf (#1369), as in moveBook.
    await abortQuietly(() => tx.abort(), tx.done);
    throw cause;
  }
}

/**
 * `books` in shelf order: by `shelfPosition`, top first. Pure, and the one
 * definition of that order, shared by {@link listBooks} and the two writes
 * that renumber the shelf ({@link createBook}, {@link moveBook}). A tie —
 * which only a database a second copy of the app wrote at the same moment
 * could hold — falls back to the pre-#338 rule, newest created first, and
 * then to key order (`getAll`'s order; the sort is stable).
 */
export function byShelfPosition(books: readonly Book[]): Book[] {
  return books
    .slice()
    .sort(
      (a, b) => a.shelfPosition - b.shelfPosition || b.createdAt - a.createdAt
    );
}

/**
 * Every book, in the user's shelf order (#338): `shelfPosition`, top first.
 *
 * A new book lands at the top ({@link createBook}); after that a book moves
 * only when the user moves it ({@link moveBook}). Nothing else writes the
 * position — a rename, a cover colour or work inside a book bumps `updatedAt`
 * at most, and `updatedAt` does not order the shelf (#1185, DRI 2026-09-28:
 * "books stay put"). The v11 upgrade wrote the order the shelf showed before
 * this field existed (newest created first), so nothing moved on upgrade.
 */
export async function listBooks(): Promise<Book[]> {
  const db = await getDb();
  return byShelfPosition(await db.getAll("books"));
}

export async function getBook(id: BookId): Promise<Book | undefined> {
  return (await getDb()).get("books", id);
}

/**
 * Rename a book in place (#264 — the training manual workflow names a book for
 * the passage, e.g. "Mark").
 *
 * Get-then-put in ONE readwrite transaction — the idempotency bar, never a
 * read-tx-then-write-tx seam. The new name is trimmed; a blank/whitespace-only
 * rename is refused and keeps the current value, so a book that has never been
 * named stays unnamed and goes on showing its placeholder rather than acquiring
 * that placeholder's words as a real name (#169). Renaming to the current name
 * — `null` included — writes nothing and does NOT bump `updatedAt`, so a re-run
 * is a true no-op. Any real rename bumps `updatedAt` — labelling a book is
 * activity — and the book keeps its place on the shelf ({@link listBooks}
 * orders by `shelfPosition`, #338).
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
  if (!book) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such book: ${id}`);
  }

  const trimmed = name.trim();
  // Blank keeps the current value — a named book keeps its name, and an
  // unnamed one stays unnamed (#169). The invariant is that a book is always
  // LABELLED: by the facilitator's name, or by the placeholder its slot renders.
  const nextName = trimmed === "" ? book.name : trimmed;
  if (nextName === book.name) {
    await tx.done; // idempotent no-op: no write, no recency bump.
    return book;
  }
  // A real rename to a name another book holds is refused (#1272, S13). Not
  // reached for the no-op above, so renaming one of two existing duplicates to
  // its own current name stays what it was (U4a). Same transaction as the put.
  if (nextName !== null) {
    try {
      assertBookNameFree(await tx.store.getAll(), nextName, id);
    } catch (cause) {
      await abortQuietly(() => tx.abort(), tx.done);
      throw cause;
    }
  }

  const updated: Book = {
    ...book,
    name: nextName,
    updatedAt: now,
    modifiedAt: now,
  };
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
 * (`lib/cover-colour.ts`'s `resolveCoverKey`). Unlike a rename, a `null` here
 * is something a caller may set: a blank rename keeps the current name, but
 * "no chosen colour" is the normal starting state for every book and a caller
 * may return to it, so there is nothing to refuse.
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
 * `updatedAt` (the book keeps its place on the shelf), and setting the SAME
 * key again (including `null` to `null`) is an idempotent no-op — no write,
 * no recency bump, safe to re-run.
 */
export async function setBookCoverColour(
  id: BookId,
  key: string | null,
  now: number = Date.now()
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const book = await tx.store.get(id);
  if (!book) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such book: ${id}`);
  }

  if (key === (book.coverColourKey ?? null)) {
    await tx.done; // idempotent no-op: no write, no recency bump.
    return book;
  }

  const updated: Book = {
    ...book,
    coverColourKey: key,
    updatedAt: now,
    modifiedAt: now,
  };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * Write the language a book's recordings are in, once (#1492, R12).
 * Get-or-create in ONE readwrite transaction: a book that already has a
 * language keeps it and nothing is written, so a second ask (another tab, a
 * stale card) never replaces the first answer. Returns the stored book, whose
 * language is the one to export. `tag` is trimmed and a blank one refused; it
 * is not checked against the bundled list, so a stored tag keeps loading if a
 * later list drops it. Stamps `modifiedAt`, not `updatedAt`: naming the
 * language is not shelf activity.
 */
export async function setBookLanguageOnce(
  id: BookId,
  tag: string,
  now: number = Date.now()
): Promise<Book> {
  const trimmed = tag.trim();
  if (trimmed === "") throw new Error("A blank language tag is not a language");
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const book = await tx.store.get(id);
  if (!book) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such book: ${id}`);
  }
  if (book.languageCode !== null && book.languageCode.trim() !== "") {
    await tx.done; // already answered: no write.
    return book;
  }
  const updated: Book = { ...book, languageCode: trimmed, modifiedAt: now };
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
 * The stores a book delete touches: the tree, both halves of every clip that
 * goes with it, and the tombstone it leaves (#1463). v13 (#38): the pending
 * rows of the segments it deletes (deleted with them, rebuild PR 2) and the
 * rows a clip's use is counted from, and the disposition records of the
 * segments it deletes.
 */
const DELETE_BOOK_STORES = withClipBytes([
  "books",
  "chapters",
  "segments",
  "takes",
  "clipMeta",
  "tombstones",
  "pendingTakes",
  "takeDispositions",
]);

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
 *     guard `clearSegmentTake` already holds; the take write's is #68.
 *   - **Pending rows go with their segments** (#38 rebuild PR 2), and the
 *     clips their `stored` bases named are released by the same check.
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
  // The clips this delete lets go of: every doomed take's, and the `stored`
  // base of every doomed segment's pending row (#38 rebuild PR 2).
  const released = new Set(doomedTakes.map((take) => take.clipId));
  for (const segmentId of doomedSegments) {
    await segments.delete(segmentId);
    await deleteDispositionsOf(tx, segmentId);
    for (const clipId of await deletePendingRowOf(tx, segmentId)) {
      released.add(clipId);
    }
  }
  for (const chapter of ownedChapters) await chapters.delete(chapter.id);
  // `delete` on an absent key is a no-op in IndexedDB, so the orphan case needs
  // no branch for the delete: the row goes if it is there, and nothing is
  // written if not. The tombstone (#1463) does branch: it records that THIS
  // call removed a book, so a book row already gone (an orphaned tree, or a
  // repeated delete) gets none. One row for the book, not one per segment in
  // its tree: the book's tombstone covers everything under it.
  const book = await books.get(bookId);
  await books.delete(bookId);
  if (book) {
    await tx.objectStore("tombstones").add({
      entity: "book",
      entityId: bookId,
      parentId: null,
      deletedAt: Date.now(),
    });
  }

  // The take rows and the pending rows are gone, so the clip-use check sees
  // only the references that survive this delete. A clip nothing uses is
  // unreachable audio and goes with the book; a clip another segment's take,
  // or another segment's pending row's stored base, still names stays (v13,
  // #38). The surviving take rows are read once, after the last take delete,
  // and nothing below deletes a take, so the set stays exact for every clip.
  const takeClips = new Set((await takes.getAll()).map((take) => take.clipId));
  for (const clipId of released) {
    await deleteClipIfUnreferenced(tx, clipId, takeClips);
  }
}

/**
 * Delete a segment's pending row (#38 rebuild PR 2,
 * docs/design/pending-take-lifecycle.md §3 and cell RP-D), on the transaction
 * that deletes the segment, and return the clip its `stored` base named, for
 * the caller to release once every row it is deleting is gone. A row ends
 * only in the owning transaction or with its segment; this is the second.
 * No disposition is written: the segment's records go in the same
 * transaction, because a deleted segment is final. A row of any take goes,
 * this copy's or another's, refused or not: nothing can install audio on a
 * deleted segment, and the replay would only delete the row as `gone`.
 * Idempotent: a segment with no row returns `[]` and writes nothing.
 */
async function deletePendingRowOf(
  tx: ClipUseTx,
  segmentId: SegmentId
): Promise<ClipId[]> {
  const rows = tx.objectStore("pendingTakes");
  const row = await rows.get(segmentId);
  if (!row) return [];
  await rows.delete(segmentId);
  return row.base.kind === "stored" ? [row.base.sourceClipId] : [];
}

/**
 * Delete a segment's disposition records (v13, #38), on the transaction that
 * deletes the segment: the records' only deletion, because a deleted segment
 * is final and nothing can install audio there again.
 */
async function deleteDispositionsOf(
  tx: ClipUseTx,
  segmentId: SegmentId
): Promise<void> {
  const records = tx.objectStore("takeDispositions");
  for (const clipId of await records.index("bySegment").getAllKeys(segmentId)) {
    await records.delete(clipId);
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
export async function abortQuietly(
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
 * drift, the way {@link nextBookNumber} already ties the New Book field to
 * {@link createBook}.
 *
 * **`max + 1`, deliberately NOT {@link nextBookNumber}'s first-unused rule.** A
 * book's placeholder is a label and reusing a freed one is the point (#360); a
 * chapter's `number` is its own (#1272) and a new chapter goes at the end of
 * the book, so filling a hole left by a removed chapter would give it a number
 * that sits among the earlier ones rather than after them.
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
 * showing its slot (#1272 B), which is the right number even when another
 * copy of the app added a chapter after the prompt rendered. The `number`
 * written here is not shown for a chapter added by hand. Unlike
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
  if (!book) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such book: ${bookId}`);
  }

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
  const now = Date.now();
  const chapter: Chapter = {
    id: uuid() as ChapterId,
    bookId,
    number: resolvedNumber,
    // Blank stays unnamed, and the display falls back to "Chapter {number}"
    // until the facilitator names it — at this prompt (#609) or later through
    // Rename (#264).
    name: trimmed === "" ? null : trimmed,
    segmentIds: [],
    // v12 (#1462): the write time, and no template behind a hand-made chapter.
    createdAt: now,
    modifiedAt: now,
    templateKey: null,
  };
  await tx.objectStore("chapters").put(chapter);
  await tx.objectStore("books").put({
    ...book,
    chapterIds: [...book.chapterIds, chapter.id],
    updatedAt: now,
    modifiedAt: now,
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
 * — labelling a chapter is activity on its book, exactly as `addChapter`,
 * `renameBook` and recording are (G4). The book keeps its place on the shelf
 * ({@link listBooks} orders by `shelfPosition`, #338). The no-op path skips
 * the bump.
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
  if (!chapter) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such chapter: ${id}`);
  }

  const trimmed = name.trim();
  // Blank clears back to the default "Chapter N" (chapters, unlike books, have
  // one), rather than storing an empty label.
  const nextName = trimmed === "" ? null : trimmed;
  if (nextName === (chapter.name ?? null)) {
    await tx.done; // idempotent no-op: no write, no recency bump.
    return chapter;
  }

  const updated: Chapter = { ...chapter, name: nextName, modifiedAt: now };
  await tx.objectStore("chapters").put(updated);
  // Bump the parent book's `updatedAt`, in this same transaction. A dangling
  // parent is skipped rather than failing a rename that otherwise succeeded.
  const book = await tx.objectStore("books").get(chapter.bookId);
  if (book) {
    await tx.objectStore("books").put({
      ...book,
      updatedAt: now,
      modifiedAt: now,
    });
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
 *     aborted on a thrown error (the `deleteBook` guard) — the new order
 *     commits whole or not at all.
 *   - **No chapter row is written** (#1272). Only `book.chapterIds`
 *     changes. Every screen numbers a chapter by its slot (the requirements
 *     owner's answer B, "the fifth chapter slot is always 5",
 *     `lib/chapter-slot.ts`), so a moved chapter takes its new slot's number
 *     without a write, and the stored `number` stays the template's (the
 *     DRI's S1: no schema change). A dangling id has no record, and export
 *     still counts it as missing.
 *   - **Names are not touched** (scope Q5): "Mark 6" stays "Mark 6".
 *   - **No `updatedAt` bump** (scope Q4): a reorder is not recorded as
 *     activity on the book. This is the one tree edit that differs from
 *     `renameChapter` here, on purpose. (The shelf order does not depend on
 *     it: {@link listBooks} orders by `shelfPosition`, #338.)
 *   - **Idempotent.** The target is absolute, so a re-run lands in the same
 *     state; a move that leaves the order as it was writes nothing at all.
 *
 * Returns the book's resolvable chapters in their new order, each as
 * stored — what a caller patches its rows from.
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

    // No `updatedAt`: a reorder is not activity on the book (scope Q4). It
    // is still a write, so `modifiedAt` moves (J6).
    const now = Date.now();
    await books.put({ ...book, chapterIds: plan.ids, modifiedAt: now });
    await tx.done;
    return plan.order;
  } catch (cause) {
    await abortQuietly(() => tx.abort(), tx.done);
    throw cause;
  }
}

/**
 * Move one book to an absolute position on the shelf (#338 — press-and-hold
 * reorder on the Books screen; the book twin of {@link moveChapter}).
 *
 * `toIndex` counts the books in shelf order ({@link listBooks}), which is
 * exactly the cards `use-books.ts` holds. An out-of-range target clamps to the
 * top or the bottom ({@link moveToIndex}).
 *
 * The rules, and why — each one {@link moveChapter}'s:
 *
 *   - **ONE readwrite transaction** over `books`, get-then-put, aborted on a
 *     thrown error, so the shelf's positions commit together or not at all.
 *   - **Dense**: every book's `shelfPosition` becomes its place in the new
 *     order, 0..N-1, and only rows whose position changes are written.
 *   - **No `updatedAt` bump**: moving a book is not activity on it.
 *   - **Idempotent.** The target is absolute, so a re-run lands in the same
 *     state; a move that leaves the order as it was writes nothing at all.
 *
 * Returns every book in the new shelf order, with the positions they now
 * hold.
 */
export async function moveBook(
  bookId: BookId,
  toIndex: number
): Promise<Book[]> {
  assertReorderTarget(toIndex);
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  try {
    const shelf = byShelfPosition(await tx.store.getAll());
    const from = shelf.findIndex((book) => book.id === bookId);
    if (from === -1) throw new Error(`No such book: ${bookId}`);
    const order = moveToIndex(shelf, from, toIndex);
    if (order.every((book, i) => book === shelf[i])) {
      await tx.done; // idempotent no-op: no write.
      return shelf;
    }
    const now = Date.now();
    const placed: Book[] = [];
    for (const [position, book] of order.entries()) {
      if (book.shelfPosition === position) {
        placed.push(book);
        continue;
      }
      // No `updatedAt`: a reorder is not activity on the book. `modifiedAt`
      // moves: the row is written (J6).
      const updated: Book = {
        ...book,
        shelfPosition: position,
        modifiedAt: now,
      };
      await tx.store.put(updated);
      placed.push(updated);
    }
    await tx.done;
    return placed;
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

/**
 * Where `chapterId` sits in its book (#1272): its slot and the book's chapter
 * count, both over {@link resolveBookChapters}'s list (`lib/chapter-slot.ts`).
 * `null` when the chapter is gone or its book no longer lists it. Share
 * Chapter numbers its file by the slot and pads it to the count (#1233), the
 * same name Share Book gives that chapter, so one chapter's file name does not
 * depend on what else is being shared.
 */
export async function chapterPlacement(
  chapterId: ChapterId
): Promise<{ slot: number; chapterCount: number } | null> {
  const chapter = await getChapter(chapterId);
  if (!chapter) return null;
  const { chapters } = await resolveBookChapters(chapter.bookId);
  const slot = slotOf(chapters, chapterId);
  return slot === null ? null : { slot, chapterCount: highestSlot(chapters) };
}

/**
 * The number a chapter's screens show (#1272 B): its slot in its book, over
 * the same list as {@link chapterPlacement}. `null` when its book no longer
 * lists it: such a chapter has no slot, and this says so rather than handing
 * back its stored number in a slot's place (#1747). The stored number is a
 * template's number or an old max + 1, the same shape as a slot, so a fallback
 * here would be invisible; a caller that must still show a number borrows the
 * stored one itself, where the reader can see it.
 */
export async function chapterSlot(
  chapter: Pick<Chapter, "id" | "bookId">
): Promise<number | null> {
  const { chapters } = await resolveBookChapters(chapter.bookId);
  return slotOf(chapters, chapter.id);
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
  if (!chapter) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such chapter: ${chapterId}`);
  }

  const now = Date.now();
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
    // v12 (#1462): as addChapter.
    createdAt: now,
    modifiedAt: now,
    templateKey: null,
    audioRevision: 0,
  };
  await tx.objectStore("segments").put(segment);
  await tx.objectStore("chapters").put({
    ...chapter,
    segmentIds: [...chapter.segmentIds, segment.id],
    modifiedAt: now,
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
 * rename to the current label writes nothing. Only `label` changes, with the
 * `modifiedAt` every put stamps (#1463): the ordinal, the chapter's order,
 * the take pointer and the status are the audio's identity and progress, and
 * a label is neither.
 *
 * Unlike a chapter rename it does not bump the book's `updatedAt`: the store is
 * `segments` alone, matching `addSegment` and `setSegmentFinished`, the other
 * segment edits that leave the book row unwritten.
 */
export async function renameSegment(
  id: SegmentId,
  label: string
): Promise<Segment> {
  const db = await getDb();
  const tx = db.transaction("segments", "readwrite");
  const segment = await tx.store.get(id);
  if (!segment) {
    // A thrown error does not roll the transaction back; abort it first.
    await abortQuietly(() => tx.abort(), tx.done);
    throw new Error(`No such segment: ${id}`);
  }

  const trimmed = label.trim();
  const nextLabel = trimmed === "" ? null : trimmed;
  if (nextLabel === segment.label) {
    await tx.done; // idempotent no-op: no write.
    return segment;
  }

  const updated: Segment = {
    ...segment,
    label: nextLabel,
    modifiedAt: Date.now(),
  };
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
 * above the chapter is — the book row is not written.
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

    const now = Date.now();
    await chapters.put({ ...chapter, segmentIds: plan.ids, modifiedAt: now });
    const renumbered = await renumberSegments(segments, plan.order, now);
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
  order: readonly Segment[],
  now: number
): Promise<Segment[]> {
  const renumbered: Segment[] = [];
  for (const [position, row] of order.entries()) {
    const index = position + 1;
    if (row.index === index) {
      renumbered.push(row);
      continue;
    }
    const updated: Segment = { ...row, index, modifiedAt: now };
    await store.put(updated);
    renumbered.push(updated);
  }
  return renumbered;
}

/**
 * The stores a segment delete touches: the tree link (the chapter it hangs
 * off), the segment itself, its take, both halves of its clip, the book
 * whose `updatedAt` it bumps (#590), and the tombstone it leaves (#1463).
 * v13 (#38): as {@link DELETE_BOOK_STORES}.
 */
const DELETE_SEGMENT_STORES = withClipBytes([
  "books",
  "chapters",
  "segments",
  "takes",
  "clipMeta",
  "tombstones",
  "pendingTakes",
  "takeDispositions",
]);

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
 *   - **The segment's pending row goes with it** (#38 rebuild PR 2), and the
 *     clip its `stored` base named is released by the same check, unless
 *     another segment's row still names it.
 *   - **Dense renumbering**, reusing {@link renumberSegments} — the same
 *     write `moveSegment` makes, not a second copy of it. A dangling id
 *     already in `chapter.segmentIds` (unrelated to this delete) keeps its
 *     stored slot and is not renumbered, exactly as `moveSegment`'s
 *     `planReorder` leaves one.
 *   - **Editing is activity**: the book's `updatedAt` is bumped in the same
 *     transaction — the bump `clearSegmentTake`/`writeTakeInTx` make for
 *     exactly this reason. The book keeps its place on the shelf
 *     ({@link listBooks} orders by `shelfPosition`, #338).
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
    // deletes them (takes.ts), and the segment's pending row with the clip
    // its `stored` base names (v13, #38 rebuild PR 2). Both rows go first,
    // so the clip-use check below sees only the uses that are left: a row
    // whose base is this segment's own active clip would otherwise keep it.
    const released: ClipId[] = [];
    const priorTakeId = segment.activeTakeId;
    if (priorTakeId !== null) {
      const priorTake = await takes.get(priorTakeId);
      await takes.delete(priorTakeId);
      if (priorTake) released.push(priorTake.clipId);
    }
    released.push(...(await deletePendingRowOf(tx, segmentId)));
    for (const clipId of new Set(released)) {
      await deleteClipIfUnreferenced(tx, clipId);
    }

    const now = Date.now();
    await segments.delete(segmentId);
    await deleteDispositionsOf(tx, segmentId);
    // The tombstone (#1463), in this transaction: the row was here and is
    // removed, so the delete and its record land together or not at all.
    // The already-gone path above returned before this, so a repeated delete
    // adds no second row.
    await tx.objectStore("tombstones").add({
      entity: "segment",
      entityId: segmentId,
      parentId: chapter.id,
      deletedAt: now,
    });
    const nextIds = chapter.segmentIds.filter((id) => id !== segmentId);
    await chapters.put({ ...chapter, segmentIds: nextIds, modifiedAt: now });

    const records = await Promise.all(nextIds.map((id) => segments.get(id)));
    const visible = records.filter((r): r is Segment => r !== undefined);
    const renumbered = await renumberSegments(segments, visible, now);

    // Deleting a segment discards its recording (or its empty row) — activity
    // on the book, the same bump `clearSegmentTake`/`writeTakeInTx` make.
    const book = await tx.objectStore("books").get(chapter.bookId);
    if (book) {
      await tx
        .objectStore("books")
        .put({ ...book, updatedAt: now, modifiedAt: now });
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
 * `saveTake` demotes `affirmed → draft` and `setSegmentFinished(true)` requires
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

/**
 * A chapter's members as chapter-play candidates (#1468): every id in
 * `chapter.segmentIds`, in that order, each probed with `resolveSegmentAudio`
 * the way `resolveChapterClipIds` probes it — a key lookup, never the
 * samples. `buildChapterPlaylist` turns the list into the playlist; this only
 * reads.
 *
 * A member nobody has recorded is `unrecorded`. Every other unresolved walk is
 * `broken`, so the playlist skips exactly the set the export skips, and a
 * member with no segment row counts as broken in this chapter (it has no
 * start chapter of its own to name). `frames` is the clip's original PCM
 * length whatever it is stored as, so progress is exact for MP3 clips too.
 */
export async function chapterPlayCandidates(
  chapterId: ChapterId
): Promise<PlaylistCandidate[]> {
  const db = await getDb();
  const chapter = await db.get("chapters", chapterId);
  if (!chapter) return [];

  // Every probe is started at once (#1747). Chapter play holds the floor
  // across this read, and a serial walk waited on each member's probe in
  // turn. Each probe is its own readonly transaction; `Promise.all` keeps
  // the membership order whatever order the answers arrive in.
  return Promise.all(
    chapter.segmentIds.map(async (segmentId): Promise<PlaylistCandidate> => {
      const audio = await resolveSegmentAudio(segmentId);
      return {
        segmentId,
        startChapterId:
          audio.kind === "no-segment" ? chapterId : audio.segment.chapterId,
        audio:
          audio.kind === "resolved"
            ? { kind: "playable", frames: audio.clip.frameCount }
            : audio.kind === "no-active-take"
              ? { kind: "unrecorded" }
              : { kind: "broken" },
      };
    })
  );
}
