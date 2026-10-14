import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { newClipId } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { saveTake } from "@/lib/storage/takes";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { ClipId, SegmentId } from "@/types/domain";
import { recordTake } from "./support";

/**
 * The take write's prior-clip delete is reference-counted (#68).
 *
 * Replacing a segment's take deletes the clip the superseded take pointed at.
 * That delete must ask whether any OTHER take still names the clip, the same
 * question `clearSegmentTake` asks, or a clip shared by two segments loses its
 * audio when one of them is re-recorded.
 *
 * Nothing in `src/` shares a clip between takes today: every save mints its
 * clip id with `newClipId()` (`crypto.randomUUID()`). So these cases build the
 * sharing themselves, by handing two segments the same clip id through
 * `saveTake`, the commit write the recorder reaches (use-save-take.ts). They
 * pin a store invariant; they do not reproduce a path the app reaches.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** Two segments of one chapter, both pointing at ONE stored clip. */
const twoSegmentsSharingAClip = async () => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const s1 = await addSegment(chapter.id);
  const s2 = await addSegment(chapter.id);
  const shared = newClipId();
  await recordTake(s1.id, { clipId: shared, frames: 500 });
  await recordTake(s2.id, { clipId: shared, frames: 500 });
  return { s1: s1.id, s2: s2.id, shared };
};

const clipPresent = async (clipId: ClipId) => {
  const db = await getDb();
  return {
    meta: (await db.get("clipMeta", clipId)) !== undefined,
    data: (await db.get("clipData", clipId)) !== undefined,
  };
};

const takesOf = async (segmentId: SegmentId) => {
  const db = await getDb();
  return db.getAllFromIndex("takes", "segmentId", segmentId);
};

beforeEach(async () => {
  // Clear every store rather than deleting the database: `deleteDatabase`
  // blocks while a connection is open (AGENTS.md, Testing).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("take write: the superseded clip is deleted only when nothing else names it", () => {
  it("keeps a shared clip when one segment is re-recorded through saveTake", async () => {
    // `saveTake` is the path the recorder's commit reaches (use-save-take.ts).
    const { s1, s2, shared } = await twoSegmentsSharingAClip();

    await saveTake(s1, newClipId(), samples(300), CANONICAL_SAMPLE_RATE);

    expect(await clipPresent(shared)).toEqual({ meta: true, data: true });
    expect((await loadSegmentClip(s2)).kind).toBe("resolved");
  });

  it("deletes the clip once its last take is replaced, so nothing leaks", async () => {
    const { s1, s2, shared } = await twoSegmentsSharingAClip();

    await recordTake(s1);
    // s2 still names the clip, so it survives this far (the case above).
    expect(await clipPresent(shared)).toEqual({ meta: true, data: true });

    await saveTake(s2, newClipId(), samples(300), CANONICAL_SAMPLE_RATE);

    // The last reference is gone, so the clip goes with it.
    expect(await clipPresent(shared)).toEqual({ meta: false, data: false });
  });

  it("deletes an unshared superseded clip", async () => {
    const { s1, shared } = await twoSegmentsSharingAClip();
    const { clipId: own } = await recordTake(s1);

    await recordTake(s1);

    expect(await clipPresent(own)).toEqual({ meta: false, data: false });
    // The shared clip is still named by s2.
    expect(await clipPresent(shared)).toEqual({ meta: true, data: true });
  });

  it("is idempotent: re-running the same save leaves the same state", async () => {
    // A save-failure retry re-runs `saveTake` with the SAME clip id
    // (use-save-take.ts keeps it). Running it twice must converge: one take row
    // for the segment, the new clip present, and the shared clip untouched.
    const { s1, s2, shared } = await twoSegmentsSharingAClip();
    const clipId = newClipId();

    await saveTake(s1, clipId, samples(300), CANONICAL_SAMPLE_RATE);
    const second = await saveTake(
      s1,
      clipId,
      samples(300),
      CANONICAL_SAMPLE_RATE
    );

    expect((await takesOf(s1)).map((t) => t.id)).toEqual([second.id]);
    expect(await clipPresent(clipId)).toEqual({ meta: true, data: true });
    expect((await loadSegmentClip(s1)).kind).toBe("resolved");
    expect(await clipPresent(shared)).toEqual({ meta: true, data: true });
    expect((await loadSegmentClip(s2)).kind).toBe("resolved");
    const db = await getDb();
    expect(await db.count("takes")).toBe(2);
    expect(await db.count("clipMeta")).toBe(2);
  });
});
