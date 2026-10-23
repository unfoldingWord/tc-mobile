import "fake-indexeddb/auto";

import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { NORMALIZE_STAGES, NO_STAGES_RUN } from "@/lib/audio/loudness";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { getClipMeta, newClipId } from "@/lib/storage/clips";
import { closeDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec, ClipProcessing, NormalizedPcm } from "@/types/audio";
import type { ClipId } from "@/types/domain";

/**
 * U6c across the v14 upgrade (#1433, Frank R1 P2 on #1679).
 *
 * A segment Finished before v14 whose transcode was still owed at upgrade (an
 * encoder stall, a full phone) is still PCM, so the first sweep after the
 * upgrade picks it up. It must be encoded as it was, never normalized:
 * "already-finished segments stay as they were". A segment Finished after
 * the upgrade still normalizes by default. Real storage end to end; only the
 * worker codec is faked, because it needs a browser.
 */

vi.mock("@/hooks/mp3-codec");

const DB_NAME = "tc-mobile";
const RATE = 44_100;
const ORIGINAL = [100, -200, 300, -400];

const RECORD: ClipProcessing = {
  stages: NORMALIZE_STAGES,
  measuredLufs: -30,
  measuredTruePeakDbtp: -10,
  appliedGainDb: 11,
};

const encoded: number[][] = [];
const normalizePcm = vi.fn<
  (samples: Int16Array, sampleRate: number) => Promise<NormalizedPcm>
>(async (samples) => ({
  samples: Int16Array.from(samples, (v) => v * 2),
  processing: RECORD,
}));

async function wipe(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

/** The v13 schema exactly as db.ts builds it, holding one Finished segment still owed its transcode. */
async function seedV13FinishedPcm(clipId: string): Promise<void> {
  const db = await openDB(DB_NAME, 13, {
    upgrade(db) {
      db.createObjectStore("books", { keyPath: "id" });
      db.createObjectStore("chapters", { keyPath: "id" }).createIndex(
        "bookId",
        "bookId"
      );
      db.createObjectStore("segments", { keyPath: "id" }).createIndex(
        "chapterId",
        "chapterId"
      );
      db.createObjectStore("takes", { keyPath: "id" }).createIndex(
        "segmentId",
        "segmentId"
      );
      db.createObjectStore("clipMeta", { keyPath: "id" });
      db.createObjectStore("clipData");
      db.createObjectStore("failures", { autoIncrement: true });
      db.createObjectStore("tombstones", { autoIncrement: true });
      db.createObjectStore("pendingTakes", {
        keyPath: "segmentId",
      }).createIndex("bySourceClip", "base.sourceClipId");
      db.createObjectStore("takeDispositions", {
        keyPath: "clipId",
      }).createIndex("bySegment", "segmentId");
    },
  });
  await db.put("segments", {
    id: "old-seg",
    chapterId: "ch",
    index: 1,
    reference: null,
    label: null,
    activeTakeId: "old-take",
    status: "affirmed",
    createdAt: null,
    modifiedAt: null,
    templateKey: null,
    audioRevision: 0,
  });
  await db.put("takes", {
    id: "old-take",
    segmentId: "old-seg",
    clipId,
    createdAt: 1,
    durationMs: 1,
  });
  // As a v13 build wrote it: no `processing`.
  await db.put("clipMeta", {
    id: clipId,
    sampleRate: RATE,
    frameCount: ORIGINAL.length,
    durationMs: 1,
    createdAt: 1,
    encoding: "pcm",
    generation: 0,
    byteLength: ORIGINAL.length * 2,
    transcodeStallCount: 1,
    peaks: null,
  });
  await db.put("clipData", Int16Array.from(ORIGINAL).buffer, clipId);
  db.close();
}

beforeEach(async () => {
  await wipe();
  encoded.length = 0;
  normalizePcm.mockClear();
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work({
      encodeMp3: async (samples) => {
        encoded.push(Array.from(samples));
        return Uint8Array.of(1, 2, 3);
      },
      decodeMp3: () => Promise.reject(new Error("no decode in a sweep")),
      normalizePcm: normalizePcm as unknown as AudioCodec["normalizePcm"],
    })
  );
});

afterEach(wipe);

describe("normalize on Finished across the v14 upgrade (#1433, U6c)", () => {
  it("encodes a segment Finished before v14 as it was, and records that no stage ran", async () => {
    const clipId = "old-clip";
    await seedV13FinishedPcm(clipId);

    // The preference is unset (no window here): normalization is on.
    await requestTranscodeSweep();

    expect(normalizePcm).not.toHaveBeenCalled();
    expect(encoded).toEqual([ORIGINAL]);
    const meta = await getClipMeta(clipId as ClipId);
    expect(meta?.encoding).toBe("mp3");
    expect(meta?.processing).toEqual(NO_STAGES_RUN);
  });

  it("still normalizes a segment Finished after the upgrade", async () => {
    await seedV13FinishedPcm("old-clip");
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const clipId = newClipId();
    await saveTake(segment.id, clipId, Int16Array.of(5, 6, 7), RATE, {
      finished: true,
    });

    await requestTranscodeSweep();

    expect(normalizePcm).toHaveBeenCalledTimes(1);
    expect(Array.from(normalizePcm.mock.calls[0]![0])).toEqual([5, 6, 7]);
    expect(encoded).toContainEqual([10, 12, 14]);
    expect((await getClipMeta(clipId))?.processing).toEqual(RECORD);
    // The pre-v14 clip in the same sweep still went through untouched.
    expect(encoded).toContainEqual(ORIGINAL);
    expect((await getClipMeta("old-clip" as ClipId))?.processing).toEqual(
      NO_STAGES_RUN
    );
  });
});
