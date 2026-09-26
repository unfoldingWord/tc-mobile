import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  createBook,
  deleteSegment,
  getChapter,
  getSegment,
  getSegmentsOfChapter,
  resolveChapterClipIds,
} from "@/lib/storage/books";
import { addTake, saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { getClip, getClipMeta, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { commitTranscode } from "@/lib/storage/transcode";
import type { ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Delete a Segment (#590) — T1.
 *
 * Tim's decision (verbatim, 2026-09-24, #590): "Add a menu entry to the
 * segment editor to delete the whole segment. v1-desired." This is PR1: the
 * storage half (`lib/storage/books.ts`'s `deleteSegment`). The menu entry is a
 * later PR — nothing here exercises UI.
 *
 * G4 (Gate 1, #25) drew the line the other way — "Erase Segment erases the
 * audio and keeps the row" — so this is the first op that removes a segment
 * ROW, not only its audio, and it reverses G4 for that one entry. Every case
 * below is one of the ways that goes wrong: leaving the row's audio behind
 * (unreachable bytes), taking a clip something else still points at, failing
 * a re-run, or leaving the chapter's remaining rows out of order with what
 * `Segment.index` promises.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** Row counts for the stores a segment delete touches. */
const STORES = [
  "chapters",
  "segments",
  "takes",
  "clipMeta",
  "clipData",
] as const;
type StoreCounts = Record<(typeof STORES)[number], number>;

async function countAll(): Promise<StoreCounts> {
  const db = await getDb();
  const tx = db.transaction(STORES, "readonly");
  const [chapters, segments, takes, clipMeta, clipData] = await Promise.all([
    tx.objectStore("chapters").count(),
    tx.objectStore("segments").count(),
    tx.objectStore("takes").count(),
    tx.objectStore("clipMeta").count(),
    tx.objectStore("clipData").count(),
  ]);
  await tx.done;
  return { chapters, segments, takes, clipMeta, clipData };
}

/**
 * Make the NEXT transaction opened on this connection throw the moment
 * `deleteSegment` asks it for `storeName`. The same seam
 * `tests/delete-book.test.ts` uses: the native `IDBDatabase.transaction`,
 * reached with `unwrap` past idb's proxy, since `deleteSegment` does not
 * return its transaction for a test to inspect directly.
 */
function throwWhenStoreRequested(
  raw: IDBDatabase,
  storeName: string,
  error: Error
) {
  const open = raw.transaction.bind(raw);
  return vi
    .spyOn(raw, "transaction")
    .mockImplementation((...args: Parameters<IDBDatabase["transaction"]>) => {
      const tx = open(...args);
      const objectStore = tx.objectStore.bind(tx);
      Object.defineProperty(tx, "objectStore", {
        configurable: true,
        value: (name: string) => {
          if (name === storeName) throw error;
          return objectStore(name);
        },
      });
      return tx;
    });
}

async function chapterWithSegments(
  n: number
): Promise<{ chapterId: ChapterId; segmentIds: SegmentId[] }> {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  const segmentIds: SegmentId[] = [];
  for (let i = 0; i < n; i++) {
    segmentIds.push((await addSegment(chapter.id)).id);
  }
  return { chapterId: chapter.id, segmentIds };
}

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

describe("deleteSegment", () => {
  it("removes the segment and its take/clip, shrinks segmentIds, and renumbers the rest", async () => {
    const { chapterId, segmentIds } = await chapterWithSegments(3);
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const clipId = newClipId();
    await saveTake(s2, clipId, samples(200), CANONICAL_SAMPLE_RATE);

    const renumbered = await deleteSegment(s2);

    expect(await getSegment(s2)).toBeUndefined();
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
    expect((await getChapter(chapterId))!.segmentIds).toEqual([s1, s3]);
    expect(renumbered?.map((r) => [r.id, r.index])).toEqual([
      [s1, 1],
      [s3, 2],
    ]);
    expect((await getSegment(s1))!.index).toBe(1);
    expect((await getSegment(s3))!.index).toBe(2);
    expect((await getSegmentsOfChapter(chapterId)).map((r) => r.id)).toEqual([
      s1,
      s3,
    ]);
  });

  it("keeps a clip a surviving take in the same chapter still references", async () => {
    const { segmentIds } = await chapterWithSegments(2);
    const [s1, s2] = segmentIds as [SegmentId, SegmentId];
    const shared = newClipId();
    await saveTake(s1, shared, samples(300), CANONICAL_SAMPLE_RATE);
    await addTake(s2, shared, 10);

    await deleteSegment(s1);

    expect(await getClipMeta(shared)).toBeDefined();
    expect(await getClip(shared)).toBeDefined();
    expect((await getSegment(s2))!.activeTakeId).not.toBeNull();
  });

  it("deletes the clip once the last take referencing it goes with the segment", async () => {
    const { segmentIds } = await chapterWithSegments(1);
    const [s1] = segmentIds as [SegmentId];
    const clipId = newClipId();
    await saveTake(s1, clipId, samples(200), CANONICAL_SAMPLE_RATE);

    await deleteSegment(s1);

    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
  });

  it("is idempotent: a second delete, and a delete of an id that never existed, are no-ops", async () => {
    const { chapterId, segmentIds } = await chapterWithSegments(2);
    const [s1, s2] = segmentIds as [SegmentId, SegmentId];
    await deleteSegment(s1);
    const after = await countAll();

    await expect(deleteSegment(s1)).resolves.toBeNull();
    expect(await countAll()).toEqual(after);
    expect((await getChapter(chapterId))!.segmentIds).toEqual([s2]);

    await expect(
      deleteSegment(crypto.randomUUID() as SegmentId)
    ).resolves.toBeNull();
    expect(await countAll()).toEqual(after);
  });

  it("no longer appears in the chapter's export clip ids", async () => {
    const { chapterId, segmentIds } = await chapterWithSegments(2);
    const [s1, s2] = segmentIds as [SegmentId, SegmentId];
    const clip1 = newClipId();
    const clip2 = newClipId();
    await saveTake(s1, clip1, samples(200), CANONICAL_SAMPLE_RATE);
    await saveTake(s2, clip2, samples(200), CANONICAL_SAMPLE_RATE);

    await deleteSegment(s1);

    const { clipIds, missing } = await resolveChapterClipIds(chapterId);
    expect(clipIds).toEqual([clip2]);
    expect(missing).toBe(0);
  });

  it("does not resurrect a segment or a clip when a transcode commits after the delete", async () => {
    // The sweep re-checks its target inside `commitTranscode`'s own
    // transaction (`lib/storage/transcode.ts`) — this is a regression test
    // over a guard that already exists, the same shape
    // `tests/delete-book.test.ts` pins for `deleteBook`, not a new one.
    const { segmentIds } = await chapterWithSegments(1);
    const [s1] = segmentIds as [SegmentId];
    const clipId = newClipId();
    const pcm = samples(2000);
    await saveTake(s1, clipId, pcm, CANONICAL_SAMPLE_RATE);
    await setSegmentFinished(s1, true);
    const mp3 = encodeMp3(pcm);
    const peaks = computePeaks(pcm, 4);

    await deleteSegment(s1);

    expect(await commitTranscode(s1, clipId, mp3, peaks)).toBe("stale");
    expect(await getSegment(s1)).toBeUndefined();
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
  });

  it("leaves every store untouched when the walk throws mid-transaction", async () => {
    const { segmentIds } = await chapterWithSegments(2);
    const [s1] = segmentIds as [SegmentId, SegmentId];
    const clipId = newClipId();
    await saveTake(s1, clipId, samples(200), CANONICAL_SAMPLE_RATE);
    const before = await countAll();

    const injected = new Error("injected mid-delete failure");
    const raw = unwrap(await getDb()) as IDBDatabase;
    throwWhenStoreRequested(raw, "clipMeta", injected);

    await expect(deleteSegment(s1)).rejects.toThrow(injected);

    // Nothing moved: the take and its clip are exactly as they were, and the
    // segment is still there. A commit here would have dropped the take/clip
    // while leaving the segment row and chapter's `segmentIds` unchanged —
    // audio orphaned with a row still pointing nowhere useful.
    vi.restoreAllMocks();
    expect(await countAll()).toEqual(before);
    expect(await getSegment(s1)).toBeDefined();
    expect(await getClipMeta(clipId)).toBeDefined();
    expect(await getClip(clipId)).toBeDefined();
  });
});
