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

import { getDb } from "./db";
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
 * the first's write — "Book 001", then "Book 002". (Rename is deferred, Q1.)
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
 */
export async function addTake(
  segmentId: SegmentId,
  clipId: ClipId,
  durationMs: number,
  now: number = Date.now()
): Promise<Take> {
  const db = await getDb();
  const tx = db.transaction(
    ["segments", "takes", "clipMeta", "clipData", "chapters", "books"],
    "readwrite"
  );
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
    // Any new recording means "recorded, not finished": a fresh take demotes
    // an approved segment, and a first take moves it off "not-started".
    status: UNFINISHED_STATUS,
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

  await tx.done;
  return take;
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
