import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  addChapter,
  addSegment,
  createBook,
  getBook,
  getChapter,
  getSegment,
  listBooks,
  moveChapter,
  moveSegment,
  moveToIndex,
  renameChapter,
  renameSegment,
  resolveBookChapters,
  resolveChapterClipIds,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import type { BookId, ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Reorder storage (#953 PR1): `moveChapter` and `moveSegment`.
 *
 * The confirmed scope is the #953 comment "Scope for #953: the storage change
 * behind reorder", with the DRI's picks: no schema change, dense renumbering,
 * chapter names untouched, and a chapter move does not bump the book up the
 * shelf. The target is ABSOLUTE and counts only the rows a screen shows (ids
 * whose record resolves); a dangling id keeps its stored slot.
 */

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

async function bookOf(
  n: number,
  name = "b"
): Promise<{ bookId: BookId; chapterIds: ChapterId[] }> {
  const book = await createBook(name);
  const chapterIds: ChapterId[] = [];
  for (let i = 0; i < n; i++) chapterIds.push((await addChapter(book.id)).id);
  return { bookId: book.id, chapterIds };
}

async function chapterOf(
  n: number
): Promise<{ chapterId: ChapterId; segmentIds: SegmentId[] }> {
  const { chapterIds } = await bookOf(1);
  const chapterId = chapterIds[0]!;
  const segmentIds: SegmentId[] = [];
  for (let i = 0; i < n; i++) segmentIds.push((await addSegment(chapterId)).id);
  return { chapterId, segmentIds };
}

const storedChapterIds = async (bookId: BookId) =>
  (await getBook(bookId))!.chapterIds;
const storedSegmentIds = async (chapterId: ChapterId) =>
  (await getChapter(chapterId))!.segmentIds;
const numbersOf = async (ids: readonly ChapterId[]) =>
  Promise.all(ids.map(async (id) => (await getChapter(id))?.number));
const indexesOf = async (ids: readonly SegmentId[]) =>
  Promise.all(ids.map(async (id) => (await getSegment(id))?.index));

/** Count IndexedDB writes at the boundary — a re-put of an equal row leaves the
 * stored value unchanged, so only the call itself shows a write happened. */
const spyPut = () => vi.spyOn(IDBObjectStore.prototype, "put");

/** Let the first `okCalls` puts through, then throw on the next — a failure
 * injected mid-transaction, after at least one write has been issued. */
function failPutAfter(okCalls: number) {
  const real = IDBObjectStore.prototype.put;
  let calls = 0;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    calls++;
    if (calls > okCalls) throw new Error("injected put failure");
    return real.apply(this, args);
  });
}

describe("moveToIndex", () => {
  it("moves one item to an absolute position", () => {
    expect(moveToIndex(["a", "b", "c", "d"], 3, 1)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
    expect(moveToIndex(["a", "b", "c", "d"], 0, 3)).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
  });

  it("clamps an out-of-range target to the ends", () => {
    expect(moveToIndex(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveToIndex(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    // -1 is "before the first row", never splice's "one from the end".
    expect(moveToIndex(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveToIndex(["a", "b", "c"], 2, -1)).toEqual(["c", "a", "b"]);
  });

  it("refuses a non-integer target", () => {
    expect(() => moveToIndex(["a", "b"], 0, 0.5)).toThrow(RangeError);
    expect(() => moveToIndex(["a", "b"], 0, Number.NaN)).toThrow(RangeError);
  });

  it("does not mutate its input", () => {
    const items = ["a", "b", "c"];
    moveToIndex(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("moveChapter (#953)", () => {
  it("reorders the book's array and renumbers every chapter densely", async () => {
    const { bookId, chapterIds } = await bookOf(4);
    const [c1, c2, c3, c4] = chapterIds as [
      ChapterId,
      ChapterId,
      ChapterId,
      ChapterId,
    ];

    const order = await moveChapter(c4, 1);

    expect(await storedChapterIds(bookId)).toEqual([c1, c4, c2, c3]);
    expect(await numbersOf([c1, c4, c2, c3])).toEqual([1, 2, 3, 4]);
    // The return is the new visible order, with the numbers it now holds.
    expect(order.map((c) => [c.id, c.number])).toEqual([
      [c1, 1],
      [c4, 2],
      [c2, 3],
      [c3, 4],
    ]);
  });

  it("leaves a chapter's name alone — only the number follows position", async () => {
    const { chapterIds } = await bookOf(3);
    await renameChapter(chapterIds[2]!, "Mark 6");

    await moveChapter(chapterIds[2]!, 0);

    const moved = await getChapter(chapterIds[2]!);
    expect(moved?.name).toBe("Mark 6");
    expect(moved?.number).toBe(1);
  });

  it("does not bump the book's updatedAt, so the shelf order holds", async () => {
    // A strictly increasing clock, so every write that DOES bump gets a
    // distinct `updatedAt` and the shelf order is not left to a tie.
    let clock = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 10));
    const first = await bookOf(3, "first");
    const second = await bookOf(1, "second");
    const before = await getBook(first.bookId);
    const shelfBefore = (await listBooks()).map((b) => b.id);
    // `second` is newest, so `first` is NOT at the front; a bump would move it.
    expect(shelfBefore[0]).toBe(second.bookId);

    await moveChapter(first.chapterIds[2]!, 0);

    expect((await getBook(first.bookId))?.updatedAt).toBe(before?.updatedAt);
    expect((await listBooks()).map((b) => b.id)).toEqual(shelfBefore);
  });

  it("writes nothing when the chapter is already at the target", async () => {
    const { bookId, chapterIds } = await bookOf(3);
    const before = await getBook(bookId);
    const put = spyPut();

    await moveChapter(chapterIds[1]!, 1);
    // A target past the end clamps to the last slot — where it already is.
    await moveChapter(chapterIds[2]!, 99);

    expect(put).not.toHaveBeenCalled();
    expect(await getBook(bookId)).toEqual(before);
  });

  it("is idempotent: the same absolute move run twice lands once", async () => {
    const { bookId, chapterIds } = await bookOf(4);
    await moveChapter(chapterIds[3]!, 1);
    const afterFirst = await storedChapterIds(bookId);
    const numbersAfterFirst = await numbersOf(chapterIds);

    const put = spyPut();
    await moveChapter(chapterIds[3]!, 1);

    expect(put).not.toHaveBeenCalled();
    expect(await storedChapterIds(bookId)).toEqual(afterFirst);
    expect(await numbersOf(chapterIds)).toEqual(numbersAfterFirst);
  });

  it("keeps a dangling id in its stored slot, unnumbered, and still counted missing", async () => {
    const { bookId, chapterIds } = await bookOf(4);
    const [c1, gone, c3, c4] = chapterIds as [
      ChapterId,
      ChapterId,
      ChapterId,
      ChapterId,
    ];
    await (await getDb()).delete("chapters", gone);

    // Visible rows are [c1, c3, c4]; move c4 to the top.
    await moveChapter(c4, 0);

    expect(await storedChapterIds(bookId)).toEqual([c4, gone, c1, c3]);
    expect(await numbersOf([c4, c1, c3])).toEqual([1, 2, 3]);
    expect(await getChapter(gone)).toBeUndefined();
    const { chapters, missing } = await resolveBookChapters(bookId);
    expect(chapters.map((c) => c.id)).toEqual([c4, c1, c3]);
    expect(missing).toBe(1);
  });

  it("counts the target over visible rows, not stored slots", async () => {
    const { bookId, chapterIds } = await bookOf(4);
    const [c1, gone, c3, c4] = chapterIds as [
      ChapterId,
      ChapterId,
      ChapterId,
      ChapterId,
    ];
    await (await getDb()).delete("chapters", gone);

    // Visible [c1, c3, c4] -> [c3, c1, c4]. Stored index 1 is the dangling
    // slot; read as a stored index, this would be a different result.
    await moveChapter(c1, 1);

    expect(await storedChapterIds(bookId)).toEqual([c3, gone, c1, c4]);
    expect(await numbersOf([c3, c1, c4])).toEqual([1, 2, 3]);
  });

  it("rolls back the array AND the numbers when a write fails mid-transaction", async () => {
    const { bookId, chapterIds } = await bookOf(4);
    const arrayBefore = await storedChapterIds(bookId);
    const numbersBefore = await numbersOf(chapterIds);

    // The first put (the book's array) goes through; the next (a chapter's
    // number) throws. One transaction, so the array must roll back too.
    failPutAfter(1);
    await expect(moveChapter(chapterIds[3]!, 0)).rejects.toThrow(
      /injected put failure/
    );
    vi.restoreAllMocks();

    expect(await storedChapterIds(bookId)).toEqual(arrayBefore);
    expect(await numbersOf(chapterIds)).toEqual(numbersBefore);
  });

  it("rejects an unknown chapter and writes nothing", async () => {
    await bookOf(2);
    const put = spyPut();
    await expect(moveChapter("nope" as ChapterId, 0)).rejects.toThrow(
      /No such chapter/
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a non-integer target and writes nothing", async () => {
    const { chapterIds } = await bookOf(3);
    const put = spyPut();
    await expect(moveChapter(chapterIds[0]!, 1.5)).rejects.toThrow(RangeError);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("moveSegment (#953)", () => {
  it("reorders the chapter's array and renumbers only the segments that moved", async () => {
    const { chapterId, segmentIds } = await chapterOf(4);
    const [s1, s2, s3, s4] = segmentIds as [
      SegmentId,
      SegmentId,
      SegmentId,
      SegmentId,
    ];
    const put = spyPut();

    const order = await moveSegment(s3, 1);

    expect(await storedSegmentIds(chapterId)).toEqual([s1, s3, s2, s4]);
    expect(await indexesOf([s1, s3, s2, s4])).toEqual([1, 2, 3, 4]);
    expect(order.map((s) => [s.id, s.index])).toEqual([
      [s1, 1],
      [s3, 2],
      [s2, 3],
      [s4, 4],
    ]);
    // The chapter row, s3 and s2 — s1 and s4 kept their index, so no write.
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("leaves labels, takes and status alone", async () => {
    const { segmentIds } = await chapterOf(3);
    await renameSegment(segmentIds[2]!, "verses 3–4");
    const before = await getSegment(segmentIds[2]!);

    await moveSegment(segmentIds[2]!, 0);

    expect(await getSegment(segmentIds[2]!)).toEqual({ ...before, index: 1 });
  });

  it("does not touch the book (no shelf bump)", async () => {
    const { chapterId, segmentIds } = await chapterOf(3);
    const bookId = (await getChapter(chapterId))!.bookId;
    const before = await getBook(bookId);

    await moveSegment(segmentIds[0]!, 2);

    expect(await getBook(bookId)).toEqual(before);
  });

  it("writes nothing when the segment is already at the target", async () => {
    const { chapterId, segmentIds } = await chapterOf(3);
    const before = await getChapter(chapterId);
    const put = spyPut();

    await moveSegment(segmentIds[0]!, 0);
    await moveSegment(segmentIds[0]!, -3); // clamps to 0: still a no-op

    expect(put).not.toHaveBeenCalled();
    expect(await getChapter(chapterId)).toEqual(before);
  });

  it("is idempotent: the same absolute move run twice lands once", async () => {
    const { chapterId, segmentIds } = await chapterOf(4);
    await moveSegment(segmentIds[0]!, 2);
    const afterFirst = await storedSegmentIds(chapterId);
    const indexesAfterFirst = await indexesOf(segmentIds);

    const put = spyPut();
    await moveSegment(segmentIds[0]!, 2);

    expect(put).not.toHaveBeenCalled();
    expect(await storedSegmentIds(chapterId)).toEqual(afterFirst);
    expect(await indexesOf(segmentIds)).toEqual(indexesAfterFirst);
  });

  it("keeps a dangling id in its stored slot and counts the target over visible rows", async () => {
    const { chapterId, segmentIds } = await chapterOf(4);
    const [s1, gone, s3, s4] = segmentIds as [
      SegmentId,
      SegmentId,
      SegmentId,
      SegmentId,
    ];
    await (await getDb()).delete("segments", gone);

    // Visible [s1, s3, s4] -> [s3, s1, s4].
    await moveSegment(s1, 1);

    expect(await storedSegmentIds(chapterId)).toEqual([s3, gone, s1, s4]);
    expect(await indexesOf([s3, s1, s4])).toEqual([1, 2, 3]);
    expect(await getSegment(gone)).toBeUndefined();
  });

  it("rolls back the array AND the indexes when a write fails mid-transaction", async () => {
    const { chapterId, segmentIds } = await chapterOf(4);
    const arrayBefore = await storedSegmentIds(chapterId);
    const indexesBefore = await indexesOf(segmentIds);

    failPutAfter(1);
    await expect(moveSegment(segmentIds[3]!, 0)).rejects.toThrow(
      /injected put failure/
    );
    vi.restoreAllMocks();

    expect(await storedSegmentIds(chapterId)).toEqual(arrayBefore);
    expect(await indexesOf(segmentIds)).toEqual(indexesBefore);
  });

  it("rejects an unknown segment", async () => {
    await chapterOf(2);
    await expect(moveSegment("nope" as SegmentId, 0)).rejects.toThrow(
      /No such segment/
    );
  });

  it("moves the chapter's export concatenation order with it", async () => {
    const { chapterId, segmentIds } = await chapterOf(3);
    const clipOf = new Map<SegmentId, string>();
    for (const id of segmentIds) {
      const clipId = newClipId();
      await saveTake(
        id,
        clipId,
        Int16Array.from({ length: 100 }, () => 1),
        CANONICAL_SAMPLE_RATE
      );
      clipOf.set(id, clipId);
    }

    await moveSegment(segmentIds[2]!, 0);

    const { clipIds, missing } = await resolveChapterClipIds(chapterId);
    expect(missing).toBe(0);
    expect(clipIds).toEqual(
      [segmentIds[2]!, segmentIds[0]!, segmentIds[1]!].map((id) =>
        clipOf.get(id)
      )
    );
  });
});
