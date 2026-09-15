/**
 * Book repository — the Book → Chapter → Segment → Take tree.
 *
 * Ordering is explicit (`chapterIds`, `segmentIds` arrays) rather than derived
 * from a sort key, because export is defined as "concatenation of segments"
 * and the order of that concatenation is a decision the user makes, not a
 * property of the data.
 *
 * This module is also the one place the binary "finished" UI meets the 5-value
 * `RecordingStatus` enum (see `isFinished`/`setSegmentFinished`): both the
 * writes here and the view layer's reads route through the same mapping, so
 * they cannot drift.
 */

import type { IDBPDatabase } from "idb";

import { buildClipMeta } from "./clips";
import { getDb, type TcMobileDb } from "./db";
import { resolveSegmentAudio } from "./segment-audio";
import type {
  Book,
  BookId,
  Chapter,
  ChapterId,
  ClipId,
  RecordingStatus,
  Segment,
  SegmentId,
  Take,
  TakeId,
} from "@/types/domain";

const uuid = (): string => crypto.randomUUID();

/**
 * Open the transaction a take write needs: the take row and segment pointer, the
 * clip both `saveTake` writes and a superseded take's clip is deleted from, and
 * the book/chapter parents floated to the top of the shelf. `addTake` and
 * `saveTake` open the identical transaction — `saveTake` just also writes the
 * clip inside it — so the store list and the take logic are shared, not
 * duplicated. `TakeTx` is derived from this call's return so the helper's
 * parameter type cannot drift from what actually opens.
 */
function openTakeTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(
    ["segments", "takes", "clipMeta", "clipData", "chapters", "books"],
    "readwrite",
    // Strict durability: this transaction creates the ONLY copy of a recording,
    // and under the browser default (relaxed on Chromium) it can report success
    // before the bytes are flushed — so a crash or a power loss just after Stop
    // loses the take. Same bar `commitTranscode` holds (#179, ADR 0009).
    { durability: "strict" }
  );
}

type TakeTx = ReturnType<typeof openTakeTx>;

// ── The finished flag — binary UI over the 5-value enum (D-FIN) ────────────

// The binary "finished" UI is one edge over the 5-value enum, and both sides of
// it live in this module — the writes below and the `isFinished` read the view
// layer calls. So these two anchors stay module-local: exporting them would be
// surface nothing outside consumes (the UI toggles through `setSegmentFinished`
// and reads through `isFinished`, never the raw status).
/** The one status the binary "finished" UI writes and reads as complete. */
const FINISHED_STATUS = "affirmed" satisfies RecordingStatus;
/** What "finished" turns OFF to: recorded but not complete. */
const UNFINISHED_STATUS = "draft" satisfies RecordingStatus;

/** Binary read of the enum. Any non-"affirmed" value is "not finished". */
export function isFinished(status: RecordingStatus): boolean {
  return status === FINISHED_STATUS;
}

// ── Books ──────────────────────────────────────────────────────────────────

export async function createBook(
  name: string,
  languageCode: string | null = null,
  now: number = Date.now()
): Promise<Book> {
  const book: Book = {
    id: uuid() as BookId,
    name,
    languageCode,
    chapterIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.put("books", book);
  return book;
}

/**
 * Create a book auto-named "Book NNN" from the count already on disk, deriving
 * the name and writing inside ONE readwrite transaction.
 *
 * The count must come from storage, not from a screen's render state: two rapid
 * New Book taps both read `books.length === 0` from the same render and would
 * both persist "Book 001". IndexedDB serialises overlapping readwrite
 * transactions, so counting and putting in one transaction gives the second tap
 * the first's write — "Book 001", then "Book 002". The auto-name is a starting
 * label; a facilitator renames the book for the passage through {@link renameBook}
 * (#264).
 */
export async function createNextBook(now: number = Date.now()): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const count = await tx.store.count();
  const book: Book = {
    id: uuid() as BookId,
    name: `Book ${String(count + 1).padStart(3, "0")}`,
    languageCode: null,
    chapterIds: [],
    createdAt: now,
    updatedAt: now,
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

// ── Chapters ─────────────────────────────────────────────────────────────

/**
 * Add a chapter to a book. `number` defaults to the next ordinal (max existing
 * in this book + 1), computed inside the one transaction that also writes the
 * chapter and bumps the book — never a read-tx-then-write-tx seam.
 */
export async function addChapter(
  bookId: BookId,
  number?: number
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
    const maxNumber = existing.reduce(
      (max, chapter) =>
        chapter && chapter.number > max ? chapter.number : max,
      0
    );
    resolvedNumber = maxNumber + 1;
  }

  const chapter: Chapter = {
    id: uuid() as ChapterId,
    bookId,
    number: resolvedNumber,
    // Unnamed by default — the display falls back to "Chapter {number}" until
    // the facilitator renames it for the passage (#264).
    name: null,
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

// ── Takes / status ─────────────────────────────────────────────────────────

/**
 * Record the take for a segment, REPLACING any prior one (1:1, D1/A2).
 *
 * A segment has at most one take: re-recording is an in-place edit, not a new
 * entry on a stack (A2 removed the many-takes model; the switcher is gone with
 * `setActiveTake`). So this creates the new take, points the segment at it,
 * demotes an "affirmed" segment back to draft — the audio a reviewer approved
 * is no longer the audio that would be exported — and then deletes the
 * superseded take row and its clip.
 *
 * All of it is one atomic transaction spanning the take, segment, and clip
 * stores, so the delete of the old audio cannot land without the new audio and
 * pointer landing too: an interrupted replace never strands the new recording.
 * The prior clip is deleted only when it differs from the new one, so a retry
 * that reuses a clip id (the pending-take upsert path) never deletes the audio
 * it just committed.
 *
 * `finished` sets the segment's final status in this same transaction. It
 * defaults to false — a new recording is draft, which is what demotes an
 * approved segment — so `true` is only ever the recorder carrying an explicit
 * Finished mark for THIS take. Writing it here, atomically with the take, is
 * what lets the mark survive a save-failure retry (which re-runs this) instead
 * of being lost to a separate write the recovery path never reaches.
 */
/**
 * The take write itself, on a caller-provided transaction.
 *
 * Shared by `addTake` (clip already on disk) and `saveTake` (clip written in the
 * same transaction), so the 1:1 replace, the finished-mark, the prior-clip
 * cleanup and the book float exist once. Does NOT open or close the transaction:
 * the caller owns its lifetime, which is what lets `saveTake` make the clip write
 * and this take write atomic together.
 */
async function writeTakeInTx(
  tx: TakeTx,
  segmentId: SegmentId,
  clipId: ClipId,
  durationMs: number,
  opts: { finished?: boolean; now?: number } = {}
): Promise<Take> {
  const { finished = false, now = Date.now() } = opts;
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  const priorTakeId = segment.activeTakeId;
  const priorTake = priorTakeId
    ? await tx.objectStore("takes").get(priorTakeId)
    : undefined;

  const take: Take = {
    id: uuid() as TakeId,
    segmentId,
    clipId,
    createdAt: now,
    durationMs,
  };
  await tx.objectStore("takes").put(take);
  await tx.objectStore("segments").put({
    ...segment,
    activeTakeId: take.id,
    // A new recording is draft unless the recorder carried an explicit Finished
    // mark for it: a fresh take demotes an approved segment and moves a first
    // take off "not-started", while an explicit mark lands finished atomically
    // with the take (so a retry re-applies it, never a separate lost write).
    status: finished ? FINISHED_STATUS : UNFINISHED_STATUS,
  });

  if (priorTake && priorTake.id !== take.id) {
    await tx.objectStore("takes").delete(priorTake.id);
    // Guard the clip delete against a reused id: retrying a save with the same
    // clipId must not delete the audio the new take now points at.
    if (priorTake.clipId !== clipId) {
      await tx.objectStore("clipMeta").delete(priorTake.clipId);
      await tx.objectStore("clipData").delete(priorTake.clipId);
    }
  }

  // Recording is activity: float the book to the top of the shelf (listBooks
  // sorts by updatedAt), in the SAME transaction so the take and the recency
  // land together. A dangling chapter/book parent is skipped rather than
  // failing a save that otherwise succeeded.
  const chapter = await tx.objectStore("chapters").get(segment.chapterId);
  const book = chapter
    ? await tx.objectStore("books").get(chapter.bookId)
    : undefined;
  if (book) await tx.objectStore("books").put({ ...book, updatedAt: now });

  return take;
}

/**
 * The generation of the clip behind a segment's current take, or 0 when there is
 * none (never recorded, or a dangling take/clip — an edit of audio the database
 * could not produce is not a lossy pass over anything). Read on the caller's
 * transaction so `saveTake` stamps its new clip from the same state it replaces.
 */
async function priorClipGeneration(
  tx: TakeTx,
  segmentId: SegmentId
): Promise<number> {
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment?.activeTakeId) return 0;
  const take = await tx.objectStore("takes").get(segment.activeTakeId);
  if (!take) return 0;
  const meta = await tx.objectStore("clipMeta").get(take.clipId);
  return meta?.generation ?? 0;
}

/**
 * Point a segment at an already-stored clip as its active take.
 *
 * Assumes the clip is on disk (its caller `putClip`s first). For the record/edit
 * commit path, prefer `saveTake`, which writes the clip in the SAME transaction
 * so a failure cannot strand an orphan.
 */
export async function addTake(
  segmentId: SegmentId,
  clipId: ClipId,
  durationMs: number,
  opts: { finished?: boolean; now?: number } = {}
): Promise<Take> {
  const db = await getDb();
  const tx = openTakeTx(db);
  const take = await writeTakeInTx(tx, segmentId, clipId, durationMs, opts);
  await tx.done;
  return take;
}

/**
 * Persist a recording — the clip AND the take — in ONE transaction.
 *
 * This is the commit path's write, and its atomicity is the #38 fix. The old
 * flow was `putClip` (transaction A) then `addTake` (transaction B): if the
 * second failed — quota on the take/segment write, or the clip write itself
 * succeeding and then the process dying — the clip was already durable with no
 * take referencing it. That orphan consumed the very space the recovery screen
 * tells the translator to free, so freeing space and retrying failed again: the
 * quota death spiral. One transaction removes the half-written state entirely —
 * a quota failure rolls back the clip too, so there is nothing to reap.
 *
 * The clip write is the same shape as `putClip` (build meta, reject a 0-frame
 * clip, copy through a fresh ArrayBuffer so a trimmed view does not serialise its
 * whole backing buffer); the take write is `writeTakeInTx`, shared with
 * `addTake`. `putClip` is an upsert on `clipId`, so a retry with the same id
 * overwrites rather than duplicating.
 */
export async function saveTake(
  segmentId: SegmentId,
  clipId: ClipId,
  samples: Int16Array,
  sampleRate: number,
  opts: { finished?: boolean; now?: number } = {}
): Promise<Take> {
  const now = opts.now ?? Date.now();
  // Built before the transaction opens, so a 0-frame clip is rejected without
  // ever starting a write. The generation is stamped below, inside the
  // transaction, once the prior clip has been read.
  const base = buildClipMeta(clipId, samples, sampleRate, now);
  const bytes = new Int16Array(samples);

  const db = await getDb();
  const tx = openTakeTx(db);
  try {
    // The lossy-pass count carries over from the clip this take REPLACES (B8,
    // Q5). The only way a segment has a prior take at save time is that the
    // recorder opened it and edited or inserted into its audio — and if that
    // audio was an MP3 (a finished segment being fixed), the buffer being saved
    // was decoded from it and has been through that many lossy passes already.
    // An erase clears the take first, so a genuinely fresh recording starts at
    // 0. Read inside the transaction so the count and the take it describes
    // come from the same state.
    const generation = await priorClipGeneration(tx, segmentId);
    const meta = { ...base, generation };
    await tx.objectStore("clipMeta").put(meta);
    await tx.objectStore("clipData").put(bytes.buffer, clipId);
    const take = await writeTakeInTx(tx, segmentId, clipId, meta.durationMs, {
      ...opts,
      now,
    });
    await tx.done;
    return take;
  } catch (cause) {
    // A THROWN error mid-transaction (e.g. `writeTakeInTx` finding no such
    // segment) does not roll the clip write back on its own: IndexedDB
    // auto-commits an inactive transaction unless it is aborted. Abort so the
    // clip rolls back WITH the failed take — the single-transaction atomicity
    // #38 depends on, and without which the clip would be the very orphan this
    // rewrite exists to prevent. (A failed *request* — quota on the clip write —
    // already aborts the transaction on its own; this covers the thrown case.)
    try {
      tx.abort();
    } catch {
      // Already settled — aborted by a request failure, or committed. Nothing
      // to undo; the original cause below is what the caller needs.
    }
    // Observe the aborted transaction's `done` (idb creates it eagerly and it
    // rejects with AbortError on abort), so it is not an unhandled rejection.
    // The original cause is what the caller acts on.
    await tx.done.catch(() => {});
    throw cause;
  }
}

/**
 * Clear a segment's audio, returning it to never-recorded.
 *
 * B5's cut-to-nothing lands here: a selection over the whole clip, cut, then
 * close leaves an empty working buffer, and persisting that as a 0-frame take
 * would fabricate a recorded state — a resolved clip that plays silence and can
 * be counted finished. Instead the take and its clip are removed and the segment
 * returns to "not-started" (the same shape B6's Erase Segment will reuse, G4).
 *
 * One atomic transaction, like `addTake`: the pointer reset, the take-row delete
 * and the clip delete land together, so an interrupted clear never strands a
 * segment pointing at a take that is gone. Idempotent — a segment with no active
 * take is left "not-started" and nothing is deleted — so a repeated close, or a
 * cut-to-empty on an already-empty segment, is a safe no-op.
 */
export async function clearSegmentTake(segmentId: SegmentId): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["segments", "takes", "clipMeta", "clipData", "chapters", "books"],
    "readwrite",
    // Strict durability: this removes the only copy of a take. #179.
    { durability: "strict" }
  );
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  const priorTakeId = segment.activeTakeId;
  if (priorTakeId !== null) {
    const priorTake = await tx.objectStore("takes").get(priorTakeId);
    await tx.objectStore("takes").delete(priorTakeId);
    if (priorTake) {
      // Delete the clip only when no OTHER take still points at it. Nothing
      // shares a clip today (every take mints a fresh `newClipId()`), but a
      // future content-addressed import could dedupe, and an unconditional
      // delete would then punch a hole in another segment — unrecoverable audio
      // loss (Frank R4). The take row is already gone, so `getAll` sees only the
      // survivors. NOTE: `addTake`'s prior-clip delete has the same latent
      // property and is tracked in #68.
      const survivors = await tx.objectStore("takes").getAll();
      const stillReferenced = survivors.some(
        (t) => t.clipId === priorTake.clipId
      );
      if (!stillReferenced) {
        await tx.objectStore("clipMeta").delete(priorTake.clipId);
        await tx.objectStore("clipData").delete(priorTake.clipId);
      }
    }
  }

  await tx.objectStore("segments").put({
    ...segment,
    activeTakeId: null,
    status: "not-started",
  });

  // Editing is activity: float the book to the top of the shelf in the same
  // transaction, exactly as recording does.
  const chapter = await tx.objectStore("chapters").get(segment.chapterId);
  const book = chapter
    ? await tx.objectStore("books").get(chapter.bookId)
    : undefined;
  if (book)
    await tx.objectStore("books").put({ ...book, updatedAt: Date.now() });

  await tx.done;
}

/**
 * The binary "finished" write boundary over the 5-value enum (D-FIN).
 *
 * A never-recorded segment can be neither finished nor "draft": there is no
 * recording to be either. The invariant is enforced here, in the store, not
 * only by disabling the checkbox — writing "draft" onto an empty segment would
 * fabricate a recorded state that any Phase-2 reader of the enum would trust.
 * So on a segment with no active take, `true` rejects and `false` is an
 * idempotent no-op that leaves (or restores) "not-started".
 */
export async function setSegmentFinished(
  segmentId: SegmentId,
  finished: boolean
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("segments", "readwrite");
  const segment = await tx.store.get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  if (segment.activeTakeId === null) {
    if (finished) {
      throw new Error(
        `Segment ${segmentId} has no recording; cannot mark finished`
      );
    }
    await tx.store.put({ ...segment, status: "not-started" });
    await tx.done;
    return;
  }

  await tx.store.put({
    ...segment,
    status: finished ? FINISHED_STATUS : UNFINISHED_STATUS,
  });
  await tx.done;
}

/**
 * The chapter's finished/total roll-up for the Books-screen counter.
 *
 * A cheap read — segments only, never clips. `total` counts resolvable segment
 * rows; a dangling id contributes to neither count. An empty chapter is
 * `{ finished: 0, total: 0 }`, and the UI shows no counter when `total === 0`.
 *
 * Known corner (documented, cheap to revisit): an externally-corrupted
 * `affirmed`-but-dangling segment counts as finished here while its row renders
 * as never-recorded. It is near-unreachable by construction — `addTake` demotes
 * `affirmed → draft` and `setSegmentFinished(true)` requires an active take, so
 * only external clip loss produces it — and a full audio walk per segment on
 * every render is not worth its cost.
 */
export async function chapterProgress(
  chapterId: ChapterId
): Promise<{ finished: number; total: number }> {
  const segments = await getSegmentsOfChapter(chapterId);
  const finished = segments.filter((s) => isFinished(s.status)).length;
  return { finished, total: segments.length };
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
 * It used to push `take.clipId` on the strength of the take row alone. Once an
 * export path exists (#18), a take whose clip had gone would count as
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
