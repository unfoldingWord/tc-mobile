import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { writePendingTake } from "@/lib/storage/pending-takes";
import { saveReplayedTake, saveTake } from "@/lib/storage/takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipId, SegmentId } from "@/types/domain";
import { clearAllStores, ramp } from "./support";

/**
 * The clip bytes as the `clipData` store holds them, read past the seam
 * (#1751): these cases pin the IndexedDB layout itself, so they read the
 * store directly rather than through `lib/storage/clip-bytes.ts`.
 *
 * `saveTake` and `commitTranscode` already have both pins (the subarray case
 * in `tests/storage.test.ts`, the view case in `tests/transcode.test.ts`, and
 * the #38 atomicity case beside it). `saveReplayedTake`, the third writer
 * (#38 launch replay), had neither at the byte store.
 */

const RATE = CANONICAL_SAMPLE_RATE;

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

/** A first take on an empty segment, read at revision 0. */
const firstTake = (
  segmentId: SegmentId
): NewTake & { readonly baseRevision: number } => ({
  segmentId,
  ordinal: 1,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: ramp(40),
  offset: 0,
  finished: false,
  editOnly: false,
  baseRevision: 0,
  baseGeneration: null,
});

/** {@link firstTake}, held, so the replay's verdict is `free`. */
const heldFirstTake = async (segmentId: SegmentId) => {
  const take = firstTake(segmentId);
  expect(await writePendingTake(take, { source: null })).toEqual({
    ok: true,
    outcome: "written",
  });
  return take;
};

const storedBytes = async (clipId: ClipId): Promise<ArrayBuffer | undefined> =>
  (await getDb()).get("clipData", clipId);

/** Fail every `put` into `takes`, after the clip bytes are already written. */
const failTakeWrites = () => {
  const realPut = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === "takes") throw new Error("injected takes fault");
    return realPut.apply(this, args);
  });
};

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clip bytes at the store (#1751)", () => {
  it("saveReplayedTake stores only a view's own bytes", async () => {
    const segmentId = await freshSegment();
    const take = await heldFirstTake(segmentId);
    // The merged audio is a view onto a larger buffer, offset into it.
    const backing = ramp(500);
    const merged = backing.subarray(100, 140);

    const result = await saveReplayedTake(take, merged, RATE);

    expect(result.outcome).toBe("saved");
    const bytes = await storedBytes(take.clipId);
    expect(bytes?.byteLength).toBe(merged.byteLength);
    expect(Array.from(new Int16Array(bytes!))).toEqual(Array.from(merged));
  });

  it("saveReplayedTake leaves no clip bytes when the take write fails", async () => {
    const segmentId = await freshSegment();
    const take = await heldFirstTake(segmentId);
    failTakeWrites();

    await expect(saveReplayedTake(take, ramp(40), RATE)).rejects.toThrow(
      "injected takes fault"
    );
    vi.restoreAllMocks();

    expect(await storedBytes(take.clipId)).toBeUndefined();
  });

  it("saveTake leaves no clip bytes when the take write fails", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    failTakeWrites();

    await expect(saveTake(segmentId, clipId, ramp(40), RATE)).rejects.toThrow(
      "injected takes fault"
    );
    vi.restoreAllMocks();

    expect(await storedBytes(clipId)).toBeUndefined();
  });
});
