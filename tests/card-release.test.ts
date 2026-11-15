import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_STAGES_RUN } from "@/lib/audio/loudness";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  createBook,
  deleteBook,
  deleteSegment,
} from "@/lib/storage/books";
import { deleteClip, getClipMeta, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  clearSegmentTake,
  saveTake,
  settlePendingTake,
} from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  clearAllStores,
  recordTake,
  savedTake,
  storeOrphanClip,
  throwWhenStoreRequested,
} from "./support";
import type { ClipId, SegmentId } from "@/types/domain";

/**
 * The v15 card-store schema step (#1925, ADR 0013 §2): where a clip's bytes
 * live, and the release record a card-located clip leaves when it is let go.
 *
 * No code in `src/` writes a card location yet (that is the commit-protocol
 * child of #1456), so every card-located row here is a fixture written onto
 * the store directly. What is under test is that every path that lets go of
 * a clip records the card file it let go of, on its own transaction.
 */

const VOLUME = "0123-4567";
/** The CRC-32/ISO-HDLC check value of "123456789": above 2^31, so a signed store goes negative. */
const CRC = 0xcbf43926;

beforeEach(clearAllStores);
afterEach(() => {
  vi.restoreAllMocks();
});

async function newSegment(): Promise<{
  bookId: Awaited<ReturnType<typeof createBook>>["id"];
  segmentId: SegmentId;
}> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return { bookId: book.id, segmentId: segment.id };
}

/** Move a stored clip row onto a card file, as the commit-protocol child will. */
async function locateOnCard(clipId: ClipId): Promise<{
  volumeId: string;
  fileName: string;
  clipId: ClipId;
  byteLength: number;
  crc32: number;
}> {
  const db = await getDb();
  const meta = await db.get("clipMeta", clipId);
  if (!meta) throw new Error(`no clip row ${clipId}`);
  const fileName = `${clipId}.1.pcm`;
  await db.put("clipMeta", {
    ...meta,
    location: { kind: "card", volumeId: VOLUME, fileName, crc32: CRC },
  });
  // The record the delete must leave: the row's own volume, file, length and CRC.
  return {
    volumeId: VOLUME,
    fileName,
    clipId,
    byteLength: meta.byteLength,
    crc32: CRC,
  };
}

async function releases(): Promise<unknown[]> {
  return (await getDb()).getAll("cardReleases");
}

describe("where a clip lives (#1925)", () => {
  it("a saved take's clip is located in IndexedDB", async () => {
    const { segmentId } = await newSegment();
    const take = await recordTake(segmentId);
    expect((await getClipMeta(take.clipId))?.location).toEqual({
      kind: "idb",
    });
  });

  it("a transcode keeps the clip's location", async () => {
    const { segmentId } = await newSegment();
    const pcm = new Int16Array(100).fill(1000);
    const take = await recordTake(segmentId, { finished: true });
    const outcome = await commitTranscode(
      segmentId,
      take.clipId,
      Uint8Array.of(0xff, 0xfb, 1, 2),
      computePeaks(pcm, 4),
      NO_STAGES_RUN
    );
    expect(outcome).toBe("committed");
    const meta = await getClipMeta(take.clipId);
    expect(meta?.encoding).toBe("mp3");
    expect(meta?.location).toEqual({ kind: "idb" });
  });
});

describe("the release record (#1925, ADR 0013 §2)", () => {
  it("deleting a card-located clip writes its release record in the same transaction", async () => {
    const clipId = newClipId();
    await storeOrphanClip(clipId, new Int16Array(50).fill(3));
    const expected = await locateOnCard(clipId);

    await deleteClip(clipId);

    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
    // Keyed by the pair: the record is found by volume and file name.
    expect(
      await (await getDb()).get("cardReleases", [VOLUME, expected.fileName])
    ).toEqual(expected);
  });

  it("deleting an IndexedDB clip writes none", async () => {
    const clipId = newClipId();
    await storeOrphanClip(clipId, new Int16Array(50).fill(3));

    await deleteClip(clipId);

    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await releases()).toEqual([]);
  });

  it("a card-located clip still in use is kept, and no record is written", async () => {
    const { segmentId } = await newSegment();
    const take = await recordTake(segmentId);
    await locateOnCard(take.clipId);

    await deleteClip(take.clipId);

    expect((await getClipMeta(take.clipId))?.location.kind).toBe("card");
    expect(await releases()).toEqual([]);
  });

  it("an aborted delete leaves the row and no record", async () => {
    // The tombstone is written after the clip delete in the same transaction;
    // failing it aborts the whole delete. A record on a transaction of its own
    // would survive the abort, and this would see it.
    const { segmentId } = await newSegment();
    const take = await recordTake(segmentId);
    await locateOnCard(take.clipId);
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "tombstones",
      new Error("boom")
    );

    await expect(deleteSegment(segmentId)).rejects.toThrow("boom");
    vi.restoreAllMocks();

    expect((await getClipMeta(take.clipId))?.location.kind).toBe("card");
    expect(await releases()).toEqual([]);
  });

  it("a release record keeps an unsigned CRC32 above 2^31 exactly", async () => {
    const clipId = newClipId();
    await storeOrphanClip(clipId, new Int16Array(50).fill(3));
    await locateOnCard(clipId);

    await deleteClip(clipId);

    const [record] = (await releases()) as { crc32: number }[];
    expect(record?.crc32).toBe(3421780262);
    expect(record?.crc32).toBe(CRC);
  });
});

describe("every path that lets go of a card-located clip writes a release record (#1925)", () => {
  it("erase", async () => {
    const { segmentId } = await newSegment();
    const take = await recordTake(segmentId);
    const expected = await locateOnCard(take.clipId);

    await clearSegmentTake(segmentId);

    expect(await getClipMeta(take.clipId)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
  });

  it("segment delete", async () => {
    const { segmentId } = await newSegment();
    const take = await recordTake(segmentId);
    const expected = await locateOnCard(take.clipId);

    await deleteSegment(segmentId);

    expect(await getClipMeta(take.clipId)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
  });

  it("book delete", async () => {
    const { bookId, segmentId } = await newSegment();
    const take = await recordTake(segmentId);
    const expected = await locateOnCard(take.clipId);

    await deleteBook(bookId);

    expect(await getClipMeta(take.clipId)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
  });

  it("replaced take", async () => {
    const { segmentId } = await newSegment();
    const first = await recordTake(segmentId);
    const expected = await locateOnCard(first.clipId);

    const secondClip = newClipId();
    const second = savedTake(
      await saveTake(
        segmentId,
        secondClip,
        new Int16Array(80).fill(7),
        CANONICAL_SAMPLE_RATE
      )
    );

    expect(second.clipId).toBe(secondClip);
    expect((await getClipMeta(secondClip))?.location).toEqual({ kind: "idb" });
    expect(await getClipMeta(first.clipId)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
  });

  it("pending discard", async () => {
    // A Discard deletes the take's own clip a failed attempt may have written.
    const { segmentId } = await newSegment();
    const clipId = newClipId();
    await storeOrphanClip(clipId, new Int16Array(50).fill(3));
    const expected = await locateOnCard(clipId);

    expect(await settlePendingTake(segmentId, clipId, "discard")).toEqual({
      ok: true,
    });

    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
  });

  it("pending row end", async () => {
    // A pending row's stored base is the only use of its clip (the take that
    // named it was erased after the hold). Ending the row lets the base go.
    const { segmentId } = await newSegment();
    const baseClip = newClipId();
    await storeOrphanClip(baseClip, new Int16Array(50).fill(3));
    const expected = await locateOnCard(baseClip);
    const takeClip = newClipId();
    await (
      await getDb()
    ).put("pendingTakes", {
      segmentId,
      ordinal: 1,
      clipId: takeClip,
      base: {
        kind: "stored",
        sourceClipId: baseClip,
        generation: 0,
        frameCount: 50,
      },
      recorded: new Int16Array(10).buffer,
      sampleRate: CANONICAL_SAMPLE_RATE,
      offset: 0,
      finished: false,
      editOnly: false,
      createdAt: 1,
      baseRevision: 0,
    });

    expect(await settlePendingTake(segmentId, takeClip, "give-up")).toEqual({
      ok: true,
    });

    expect(await (await getDb()).count("pendingTakes")).toBe(0);
    expect(await getClipMeta(baseClip)).toBeUndefined();
    expect(await releases()).toEqual([expected]);
  });
});
