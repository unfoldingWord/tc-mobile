import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  addTake,
  createBook,
  deleteBook,
  getBook,
  getChapter,
  getSegment,
  listBooks,
  setSegmentFinished,
  saveTake,
} from "@/lib/storage/books";
import { getClip, getClipMeta, newClipId, putClip } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import { commitTranscode } from "@/lib/storage/transcode";
import type { BookId, ClipId, SegmentId, TakeId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Delete a Book (#337) — T1.
 *
 * The first external tester could not remove a practice book, and at the
 * training an un-deletable trial book stays for the life of the install: the
 * only way to clear it is uninstall, which wipes every recording. So this op
 * exists — and it is the single most destructive write in the product. It
 * removes a whole tree of the only copy of a translator's audio.
 *
 * Every case here is about one of the four ways that goes wrong: leaving
 * dependents behind (unreachable bytes that never free), reaching past the
 * book into another book's tree, failing a re-run, and taking a clip that
 * something else still points at.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/**
 * A row count for every store in the database — the "did anything change?"
 * probe, and the only way to assert that an idempotent re-run wrote NOTHING
 * rather than merely not throwing.
 *
 * The six are listed rather than read from `objectStoreNames` so the counts are
 * typed (and so a seventh store added later is a compile-time prompt to decide
 * what a book delete owes it, not a silent gap).
 */
const ALL_STORES = [
  "books",
  "chapters",
  "segments",
  "takes",
  "clipMeta",
  "clipData",
] as const;

type StoreCounts = Record<(typeof ALL_STORES)[number], number>;

async function countAll(): Promise<StoreCounts> {
  const db = await getDb();
  const tx = db.transaction(ALL_STORES, "readonly");
  const [books, chapters, segments, takes, clipMeta, clipData] =
    await Promise.all([
      tx.objectStore("books").count(),
      tx.objectStore("chapters").count(),
      tx.objectStore("segments").count(),
      tx.objectStore("takes").count(),
      tx.objectStore("clipMeta").count(),
      tx.objectStore("clipData").count(),
    ]);
  await tx.done;
  // Every store the schema declares is covered: a delete that leaked into one
  // this list forgot would be invisible here.
  expect(Array.from(db.objectStoreNames).sort()).toEqual(
    [...ALL_STORES].sort()
  );
  return { books, chapters, segments, takes, clipMeta, clipData };
}

/**
 * A book with two chapters: the first holds two recorded segments, the second
 * one recorded and one never-recorded. Deliberately not uniform — a delete that
 * walks only recorded segments, or only the first chapter, has to fail here.
 */
async function bookWithRecordings(name: string) {
  const book = await createBook(name);
  const chapterA = await addChapter(book.id);
  const chapterB = await addChapter(book.id);

  const recorded: Array<{ segmentId: SegmentId; clipId: ClipId }> = [];
  for (const chapterId of [chapterA.id, chapterA.id, chapterB.id]) {
    const segment = await addSegment(chapterId);
    const clipId = newClipId();
    await saveTake(segment.id, clipId, samples(200), CANONICAL_SAMPLE_RATE);
    recorded.push({ segmentId: segment.id, clipId });
  }
  const empty = await addSegment(chapterB.id);

  return {
    bookId: book.id,
    chapterIds: [chapterA.id, chapterB.id],
    recorded,
    emptySegmentId: empty.id,
  };
}

/** Assert that nothing of this book's tree is left anywhere in the database. */
async function expectGone(
  tree: Awaited<ReturnType<typeof bookWithRecordings>>
) {
  expect(await getBook(tree.bookId)).toBeUndefined();
  for (const chapterId of tree.chapterIds) {
    expect(await getChapter(chapterId)).toBeUndefined();
  }
  for (const { segmentId, clipId } of tree.recorded) {
    expect(await getSegment(segmentId)).toBeUndefined();
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
  }
  expect(await getSegment(tree.emptySegmentId)).toBeUndefined();

  // The take rows are keyed by their own id, not the segment's, so a walk that
  // deleted segments and clips but forgot the takes would pass every assertion
  // above and still leave the tree half-standing.
  const db = await getDb();
  const takes = await db.getAll("takes");
  const orphaned = takes.filter((t) =>
    tree.recorded.some((r) => r.segmentId === t.segmentId)
  );
  expect(orphaned).toEqual([]);
}

beforeEach(clearAllStores);

describe("deleteBook", () => {
  it("removes the book, its chapters, its segments, their takes and their clips", async () => {
    const tree = await bookWithRecordings("Mark");

    await deleteBook(tree.bookId);

    await expectGone(tree);
    // Nothing at all is left: this was the only book on the shelf.
    expect(await countAll()).toEqual({
      books: 0,
      chapters: 0,
      segments: 0,
      takes: 0,
      clipMeta: 0,
      clipData: 0,
    });
  });

  it("leaves every other book's tree completely untouched", async () => {
    const doomed = await bookWithRecordings("Practice");
    const keeper = await bookWithRecordings("Mark");
    const before = await countAll();

    await deleteBook(doomed.bookId);

    await expectGone(doomed);
    // The survivor is whole, down to the audio behind each of its takes.
    expect(await getBook(keeper.bookId)).toBeDefined();
    expect((await listBooks()).map((b) => b.name)).toEqual(["Mark"]);
    for (const chapterId of keeper.chapterIds) {
      expect(await getChapter(chapterId)).toBeDefined();
    }
    for (const { segmentId, clipId } of keeper.recorded) {
      const audio = await resolveSegmentAudio(segmentId);
      expect(audio.kind).toBe("resolved");
      expect(await getClipMeta(clipId)).toBeDefined();
    }
    expect(await getSegment(keeper.emptySegmentId)).toBeDefined();

    // Exactly the doomed book's half of the database went, and no more.
    const after = await countAll();
    expect(after).toEqual({
      books: before.books - 1,
      chapters: before.chapters - 2,
      segments: before.segments - 4,
      takes: before.takes - 3,
      clipMeta: before.clipMeta - 3,
      clipData: before.clipData - 3,
    });
  });

  it("is idempotent: a second delete resolves and writes nothing", async () => {
    const tree = await bookWithRecordings("Practice");
    const keeper = await bookWithRecordings("Mark");

    await deleteBook(tree.bookId);
    const afterFirst = await countAll();

    // A second tap, a retry after a failed reload, a stale confirm — all reach
    // here with an id that is already gone. It must resolve, not throw, and it
    // must not take anything with it.
    await expect(deleteBook(tree.bookId)).resolves.toBeUndefined();
    expect(await countAll()).toEqual(afterFirst);

    // An id that never existed is the same no-op.
    await expect(
      deleteBook(crypto.randomUUID() as BookId)
    ).resolves.toBeUndefined();
    expect(await countAll()).toEqual(afterFirst);
    expect(await getBook(keeper.bookId)).toBeDefined();
  });

  it("keeps a clip that a surviving take in another book still references", async () => {
    // Clips are NOT content-addressed today — `newClipId()` is a fresh UUID per
    // save, so nothing shares a clip in the shipped app. This state is reached
    // through the public store API all the same (`addTake` takes a caller-supplied
    // ClipId), and it is the state a future content-addressed import would make
    // ordinary. Deleting a book deletes MANY clips at once, so an unconditional
    // delete here would punch a whole book's worth of holes in another book's
    // audio. Reference-counting is the same guard `clearSegmentTake` already
    // holds (books.ts) and that #68 tracks for `addTake`.
    const doomedBook = await createBook("Practice");
    const doomedChapter = await addChapter(doomedBook.id);
    const doomedSegment = await addSegment(doomedChapter.id);
    const shared = newClipId();
    await saveTake(
      doomedSegment.id,
      shared,
      samples(300),
      CANONICAL_SAMPLE_RATE
    );

    const keeperBook = await createBook("Mark");
    const keeperChapter = await addChapter(keeperBook.id);
    const keeperSegment = await addSegment(keeperChapter.id);
    const keeperTake = await addTake(keeperSegment.id, shared, 10);

    await deleteBook(doomedBook.id);

    expect(await getSegment(doomedSegment.id)).toBeUndefined();
    // The audio survives, and the surviving segment still resolves to it.
    expect(await getClipMeta(shared)).toBeDefined();
    const audio = await resolveSegmentAudio(keeperSegment.id);
    expect(audio.kind).toBe("resolved");
    if (audio.kind === "resolved") {
      expect(audio.take.id).toBe(keeperTake.id);
      expect(audio.clip.id).toBe(shared);
    }
  });

  it("deletes a clip once the LAST take referencing it goes with the book", async () => {
    // The other side of the reference count: two segments of the SAME book
    // sharing one clip. Both takes go, so the clip has to go too — a count that
    // only ever spared clips would leak the bytes this feature exists to free.
    const book = await createBook("Practice");
    const chapter = await addChapter(book.id);
    const first = await addSegment(chapter.id);
    const second = await addSegment(chapter.id);
    const shared = newClipId();
    await saveTake(first.id, shared, samples(300), CANONICAL_SAMPLE_RATE);
    await addTake(second.id, shared, 10);

    await deleteBook(book.id);

    expect(await getClipMeta(shared)).toBeUndefined();
    expect(await getClip(shared)).toBeUndefined();
  });

  it("does not resurrect a segment or a clip when a transcode commits after the delete", async () => {
    // The sweep reads a finished segment's PCM, encodes it off the main thread,
    // and commits. A book deleted during that encode leaves an in-flight commit
    // holding ids for rows that are gone; a commit that wrote blindly would put
    // MP3 bytes back under a clip id nothing points at — audio that never frees
    // and never plays. `commitTranscode` re-checks its target inside its own
    // transaction (transcode.ts), so this is a REGRESSION test over a guard that
    // already exists, not a new one.
    const book = await createBook("Practice");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const clipId = newClipId();
    const pcm = samples(2000);
    await saveTake(segment.id, clipId, pcm, CANONICAL_SAMPLE_RATE);
    await setSegmentFinished(segment.id, true);

    // What the worker would hand back, prepared while the book still existed.
    const mp3 = encodeMp3(pcm);
    const peaks = computePeaks(pcm, 4);

    await deleteBook(book.id);

    expect(await commitTranscode(segment.id, clipId, mp3, peaks)).toBe("stale");
    expect(await getSegment(segment.id)).toBeUndefined();
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
    expect(await countAll()).toEqual({
      books: 0,
      chapters: 0,
      segments: 0,
      takes: 0,
      clipMeta: 0,
      clipData: 0,
    });
  });

  it("removes a chapter and segment orphaned from their parent's id list", async () => {
    // `book.chapterIds` is a denormalised ordering array; the `bookId` index on
    // the row is the parent link. A half-written array (an interrupted
    // `addChapter`) would leave a chapter the array does not list — and once the
    // book is gone nothing can ever reach it again. So the walk goes by the
    // index, not by the array.
    const book = await createBook("Practice");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);

    const db = await getDb();
    // Drop the chapter from the book's list and the segment from the chapter's,
    // leaving both rows pointing at their parents.
    const stored = await db.get("books", book.id);
    if (!stored) throw new Error("fixture: the book was not written");
    await db.put("books", { ...stored, chapterIds: [] });
    const storedChapter = await db.get("chapters", chapter.id);
    if (!storedChapter) throw new Error("fixture: the chapter was not written");
    await db.put("chapters", { ...storedChapter, segmentIds: [] });

    await deleteBook(book.id);

    expect(await getChapter(chapter.id)).toBeUndefined();
    expect(await getSegment(segment.id)).toBeUndefined();
  });

  it("removes a take row the segment's pointer has moved off, and its clip", async () => {
    // The walk collects EVERY take row of a segment from the `segmentId` index,
    // not just `segment.activeTakeId`. Nothing in `src/` produces a non-active
    // take row today — `writeTakeInTx` deletes the prior take when it replaces
    // one, and `clearSegmentTake` deletes it on erase — so this is a
    // future-proofing guard, and without this case its mutation survives the
    // whole suite (George stand-in P3-1). The failure it prevents is permanent:
    // a stale row would outlive its segment, and because the clip delete is
    // reference-counted against the SURVIVING take rows, that orphan would keep
    // its audio alive on the device with nothing able to reach or free it.
    const book = await createBook("Practice");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const activeClip = newClipId();
    await saveTake(segment.id, activeClip, samples(200), CANONICAL_SAMPLE_RATE);

    // A second take row for the same segment, with its own audio, that the
    // segment does NOT point at. Written directly, like the orphan fixture
    // above, because no code path in the app produces this state.
    const staleClip = newClipId();
    await putClip(staleClip, samples(120), CANONICAL_SAMPLE_RATE);
    const staleTakeId = crypto.randomUUID() as TakeId;
    const db = await getDb();
    await db.put("takes", {
      id: staleTakeId,
      segmentId: segment.id,
      clipId: staleClip,
      createdAt: Date.now(),
      durationMs: 5,
    });
    // The pointer still names the active take, so a walk keyed on it alone
    // would never see the row just written.
    const storedSegment = await db.get("segments", segment.id);
    expect(storedSegment?.activeTakeId).not.toBe(staleTakeId);
    expect(await db.getAll("takes")).toHaveLength(2);

    await deleteBook(book.id);

    expect(await db.get("takes", staleTakeId)).toBeUndefined();
    expect(await getClipMeta(staleClip)).toBeUndefined();
    expect(await getClip(staleClip)).toBeUndefined();
    // And the active one, so the case cannot pass by deleting the wrong take.
    expect(await getClipMeta(activeClip)).toBeUndefined();
    expect(await countAll()).toEqual({
      books: 0,
      chapters: 0,
      segments: 0,
      takes: 0,
      clipMeta: 0,
      clipData: 0,
    });
  });

  it("reclaims an orphan tree whose book row is already gone", async () => {
    // The walk keys on `chapters.index("bookId")`, which does not need the book
    // row to exist — so the function collects the tree first and removes the
    // book row only if it is there. With an early return on the missing book,
    // a tree whose `books` row had gone could never be reclaimed by anything:
    // `deleteBook` is the only reclamation path in the app, and it would no-op
    // on exactly the state that needs it (George stand-in P3-3).
    //
    // Unreachable in the shipped app — `deleteBook` is the only writer that
    // removes a `books` row and it is one atomic transaction — so this is the
    // same class of guard as the shared-clip reference count, and it is pinned
    // the same way rather than argued.
    const book = await createBook("Practice");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const clipId = newClipId();
    await saveTake(segment.id, clipId, samples(200), CANONICAL_SAMPLE_RATE);

    // Remove ONLY the book row, leaving the tree behind it intact.
    const db = await getDb();
    await db.delete("books", book.id);

    await deleteBook(book.id);

    expect(await getChapter(chapter.id)).toBeUndefined();
    expect(await getSegment(segment.id)).toBeUndefined();
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await countAll()).toEqual({
      books: 0,
      chapters: 0,
      segments: 0,
      takes: 0,
      clipMeta: 0,
      clipData: 0,
    });
  });
});
