import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  createBook,
  getSegment,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import {
  clearSegmentTake,
  saveTake,
  setSegmentFinished,
} from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { SegmentId } from "@/types/domain";
import { clearAllStores, recordTake } from "./support";
import { NO_STAGES_RUN } from "@/lib/audio/loudness";

/**
 * `Segment.audioRevision` (v13, #38): every write that changes the active take
 * moves it by one, in the take's own transaction, and nothing else moves it
 * (docs/design/pending-take-lifecycle.md §1, tests W1–W6). Real stores over
 * fake-indexeddb.
 */

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

const revision = async (segmentId: SegmentId): Promise<number | undefined> =>
  (await getSegment(segmentId))?.audioRevision;

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what moves the audio revision", () => {
  it("a save moves the revision by one", async () => {
    // W1 (RC-S): a first take, then a replace.
    const segmentId = await freshSegment();
    expect(await revision(segmentId)).toBe(0);
    await recordTake(segmentId);
    expect(await revision(segmentId)).toBe(1);
    await recordTake(segmentId);
    expect(await revision(segmentId)).toBe(2);
  });

  it("an erase that removes a take moves the revision by one", async () => {
    // W2 (RC-E): the case `activeTakeId === null` cannot tell from "never
    // recorded".
    const segmentId = await freshSegment();
    await recordTake(segmentId);
    await clearSegmentTake(segmentId);
    const segment = await getSegment(segmentId);
    expect(segment?.activeTakeId).toBeNull();
    expect(segment?.audioRevision).toBe(2);
  });
});

describe("what leaves the audio revision", () => {
  it("clearing a segment with no take leaves the revision", async () => {
    // W3 (NR-E): a no-op erase changes no take.
    const segmentId = await freshSegment();
    await clearSegmentTake(segmentId);
    expect(await revision(segmentId)).toBe(0);
  });

  it("the Finished toggle leaves the revision", async () => {
    // W4.
    const segmentId = await freshSegment();
    await recordTake(segmentId);
    await setSegmentFinished(segmentId, true);
    await setSegmentFinished(segmentId, false);
    expect(await revision(segmentId)).toBe(1);
  });

  it("a transcode leaves the revision", async () => {
    // W5: same take, same clip id; the bytes change out of band (§1).
    const segmentId = await freshSegment();
    const pcm = new Int16Array(2048).fill(1000);
    const clipId = newClipId();
    await saveTake(segmentId, clipId, pcm, 48_000, { finished: true });
    expect(
      await commitTranscode(
        segmentId,
        clipId,
        encodeMp3(pcm),
        computePeaks(pcm, 4),
        NO_STAGES_RUN
      )
    ).toBe("committed");
    expect(await revision(segmentId)).toBe(1);
  });

  it("a save whose take write fails leaves the revision", async () => {
    // W6: the move is in the take's transaction, so it rolls back with it.
    const segmentId = await freshSegment();
    await recordTake(segmentId);
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      if (this.name === "takes") throw new Error("injected takes put fault");
      return realPut.apply(this, args);
    });
    await expect(
      saveTake(segmentId, newClipId(), new Int16Array(10).fill(1), 48_000)
    ).rejects.toThrow("injected takes put fault");
    vi.restoreAllMocks();
    expect(await revision(segmentId)).toBe(1);
  });
});
