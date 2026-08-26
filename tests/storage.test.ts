import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteClip,
  getClip,
  getClipMeta,
  newClipId,
  putClip,
  totalClipBytes,
} from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import {
  addChapter,
  addSegment,
  addTake,
  chapterProgress,
  clearSegmentTake,
  createBook,
  createNextBook,
  getBook,
  getChapter,
  getSegment,
  getSegmentsOfChapter,
  isFinished,
  listBooks,
  resolveChapterClipIds,
  setSegmentFinished,
} from "@/lib/storage/books";
import {
  danglingReason,
  loadSegmentClip,
  resolveSegmentAudio,
} from "@/lib/storage/segment-audio";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { RecordingStatus } from "@/types/domain";

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/**
 * A clip id with audio actually behind it.
 *
 * `addTake` takes a `ClipId` on trust, so `addTake(seg, newClipId(), …)`
 * builds a take pointing at nothing. That is a real state — it is what a
 * failed or half-rolled-back save leaves — but it is not what "recorded"
 * means, and tests that used it as a stand-in were the reason the export path
 * could return clip ids for audio that did not exist.
 */
const storedClip = async (frames = 100) => {
  const id = newClipId();
  await putClip(id, samples(frames), CANONICAL_SAMPLE_RATE);
  return id;
};

/** A book → chapter → one segment, and the ids to address it by. */
const oneSegment = async () => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return { chapterId: chapter.id, segmentId: segment.id };
};

beforeEach(async () => {
  // Clear every store rather than deleting the database.
  //
  // `deleteDatabase` blocks indefinitely while any connection is open, and a
  // harness that resolves on `onblocked` silently leaves the previous test's
  // data in place — which is exactly the flake this replaced. Clearing is
  // deterministic and needs no connection juggling.
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("clip storage", () => {
  it("round-trips samples exactly", async () => {
    const id = newClipId();
    const original = Int16Array.from([0, -32768, 32767, 42]);
    await putClip(id, original, CANONICAL_SAMPLE_RATE);

    const loaded = await getClip(id);
    expect(loaded).toBeDefined();
    expect(Array.from(loaded!.samples)).toEqual(Array.from(original));
  });

  it("derives duration from the frame count", async () => {
    const id = newClipId();
    await putClip(id, samples(CANONICAL_SAMPLE_RATE), CANONICAL_SAMPLE_RATE);
    const meta = await getClipMeta(id);
    expect(meta?.durationMs).toBe(1000);
    expect(meta?.frameCount).toBe(CANONICAL_SAMPLE_RATE);
  });

  it("stores only the trimmed audio when given a subarray view", async () => {
    // Guards the copy in putClip: a view onto a large buffer must not drag
    // the whole backing buffer into IndexedDB.
    const backing = samples(10_000);
    const id = newClipId();
    await putClip(id, backing.subarray(0, 100), CANONICAL_SAMPLE_RATE);
    const loaded = await getClip(id);
    expect(loaded?.samples.length).toBe(100);
  });

  it("makes a deleted clip unreadable", async () => {
    // The name is deliberately narrow: these two calls both go through
    // `clipMeta`, so they say nothing about the samples. That is the test
    // below.
    const id = newClipId();
    await putClip(id, samples(10), CANONICAL_SAMPLE_RATE);
    await deleteClip(id);
    expect(await getClipMeta(id)).toBeUndefined();
    expect(await getClip(id)).toBeUndefined();
  });

  it("deletes the samples too, not just the metadata", async () => {
    // The test above cannot see this: `getClip` returns undefined as soon as
    // the metadata is gone (clips.ts:58), so a `deleteClip` that dropped only
    // `clipMeta` and left the PCM in `clipData` passes it, and
    // `totalClipBytes` sums `clipMeta` so it cannot see the orphan either.
    // Discarding a failed take deletes its clip precisely to give the bytes
    // back on a phone that has just run out of room, so the data store is
    // checked directly.
    const id = newClipId();
    await putClip(id, samples(1000), CANONICAL_SAMPLE_RATE);
    const db = await getDb();
    expect(await db.get("clipData", id)).toBeDefined();

    await deleteClip(id);
    expect(await db.get("clipData", id)).toBeUndefined();
  });

  it("refuses to store a 0-frame clip", async () => {
    // George R4: a 0-frame clip resolves as playable silent audio and can be
    // counted finished — the ghost take. The store rejects it rather than
    // trusting callers, the same way setSegmentFinished guards its own invariant.
    await expect(
      putClip(newClipId(), new Int16Array(0), CANONICAL_SAMPLE_RATE)
    ).rejects.toThrow();
  });

  it("reports total bytes held on device", async () => {
    await putClip(newClipId(), samples(100), CANONICAL_SAMPLE_RATE);
    await putClip(newClipId(), samples(50), CANONICAL_SAMPLE_RATE);
    expect(await totalClipBytes()).toBe(300); // 150 frames * 2 bytes
  });

  it("returns undefined for an unknown clip", async () => {
    expect(await getClip(newClipId())).toBeUndefined();
  });
});

describe("book tree", () => {
  it("auto-names concurrent New Book taps distinctly (race-safe)", async () => {
    // Two taps before the first write lands must not both become "Book 001":
    // the name comes from the count on disk inside one readwrite transaction,
    // which IndexedDB serialises, so the second sees the first.
    const [a, b] = await Promise.all([createNextBook(), createNextBook()]);
    const names = [a.name, b.name].sort();
    expect(names).toEqual(["Book 001", "Book 002"]);
    const third = await createNextBook();
    expect(third.name).toBe("Book 003");
  });

  it("creates and lists books newest-updated first", async () => {
    // Create in the OPPOSITE order to the expected sort, with explicit and
    // distinct timestamps, so an unsorted `getAll` (primary-key/uuid order)
    // fails deterministically rather than passing by luck.
    const older = await createBook("older", "nukak", 1000);
    const newer = await createBook("newer", null, 2000);

    const all = await listBooks();
    expect(all.map((b) => b.id)).toEqual([newer.id, older.id]);
    expect(all[0]?.chapterIds).toEqual([]);
    expect(all[1]?.languageCode).toBe("nukak");
  });

  it("numbers chapters max+1 and parents them to the book", async () => {
    const book = await createBook("b");
    const c1 = await addChapter(book.id);
    const c2 = await addChapter(book.id);

    expect(c1.number).toBe(1);
    expect(c2.number).toBe(2); // max+1, not a constant
    expect(c1.bookId).toBe(book.id);

    const updated = await getBook(book.id);
    expect(updated?.chapterIds).toEqual([c1.id, c2.id]);
  });

  it("appends segments with a sequential index and empty defaults", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    const s2 = await addSegment(chapter.id);
    const s3 = await addSegment(chapter.id);

    expect([s1.index, s2.index, s3.index]).toEqual([1, 2, 3]);

    const updated = await getChapter(chapter.id);
    expect(updated?.segmentIds).toEqual([s1.id, s2.id, s3.id]);

    for (const s of [s1, s2, s3]) {
      expect(s.status).toBe("not-started");
      expect(s.activeTakeId).toBeNull();
      expect(s.reference).toBeNull();
    }
  });

  it("reads one segment by id, and nothing for an unknown id", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s = await addSegment(chapter.id);

    const found = await getSegment(s.id);
    expect(found?.id).toBe(s.id);
    expect(found?.chapterId).toBe(chapter.id);

    const db = await getDb();
    await db.delete("segments", s.id);
    expect(await getSegment(s.id)).toBeUndefined();
  });

  it("returns a chapter's segments in declared order, dropping dangling ids", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const a = await addSegment(chapter.id);
    const b = await addSegment(chapter.id);
    const c = await addSegment(chapter.id);

    // Corrupt the middle segment out from under the chapter's id list.
    const db = await getDb();
    await db.delete("segments", b.id);

    const segments = await getSegmentsOfChapter(chapter.id);
    // Order preserved, dangling id dropped (not returned as undefined).
    expect(segments.map((s) => s.id)).toEqual([a.id, c.id]);
  });

  it("maps the finished toggle onto the status enum", async () => {
    const { segmentId } = await oneSegment();
    await addTake(segmentId, await storedClip(), 100);
    const db = await getDb();

    await setSegmentFinished(segmentId, true);
    expect((await db.get("segments", segmentId))?.status).toBe("affirmed");

    await setSegmentFinished(segmentId, false);
    expect((await db.get("segments", segmentId))?.status).toBe("draft");
  });

  it("refuses to mark a never-recorded segment finished", async () => {
    const { segmentId } = await oneSegment();
    await expect(setSegmentFinished(segmentId, true)).rejects.toThrow(
      /no recording/
    );
    const db = await getDb();
    // Status unchanged — the reject must not have written anything.
    expect((await db.get("segments", segmentId))?.status).toBe("not-started");
  });

  it("does not fabricate a draft when unfinishing an empty segment", async () => {
    // M1: `setSegmentFinished(seg, false)` on a segment with no take must not
    // write "draft". "draft" claims a recording exists; the row still renders
    // empty (F3 keys on hasClip) but a Phase-2 reader of the enum would be lied
    // to. Empty stays "not-started".
    const { segmentId } = await oneSegment();
    await setSegmentFinished(segmentId, false);
    const db = await getDb();
    expect((await db.get("segments", segmentId))?.status).toBe("not-started");
  });

  it("reads only affirmed as finished", () => {
    expect(isFinished("affirmed")).toBe(true);
    const notFinished: RecordingStatus[] = [
      "not-started",
      "partly-recorded",
      "draft",
      "refined",
    ];
    for (const status of notFinished) expect(isFinished(status)).toBe(false);
  });

  it("rolls up finished/total for the chapter counter", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    await addSegment(chapter.id);
    await addSegment(chapter.id);
    await addTake(s1.id, await storedClip(), 100);
    await setSegmentFinished(s1.id, true);

    expect(await chapterProgress(chapter.id)).toEqual({
      finished: 1,
      total: 3,
    });

    // An empty chapter is 0/0 — the UI hides the counter when total === 0.
    const empty = await addChapter(book.id);
    expect(await chapterProgress(empty.id)).toEqual({ finished: 0, total: 0 });
  });

  it("replaces the take on re-record, deleting the superseded clip (1:1)", async () => {
    // M2: a segment has at most ONE take. Re-recording REPLACES it — no stacked
    // history, and the old PCM is reclaimed, not left unreachable (#2/D3).
    const { segmentId } = await oneSegment();
    const firstClip = await storedClip();
    const first = await addTake(segmentId, firstClip, 1000);
    // Approve it, so the re-record's demotion is observable.
    await setSegmentFinished(segmentId, true);

    const secondClip = await storedClip();
    const second = await addTake(segmentId, secondClip, 1200);

    const db = await getDb();
    // Exactly one take row for the segment, and it is the newest.
    const takesForSegment = await db.getAllFromIndex(
      "takes",
      "segmentId",
      segmentId
    );
    expect(takesForSegment.map((t) => t.id)).toEqual([second.id]);

    const segment = await db.get("segments", segmentId);
    expect(segment?.activeTakeId).toBe(second.id);
    // Re-recording demotes an affirmed segment back to draft.
    expect(segment?.status).toBe("draft");

    // The old take row and its audio are gone — no orphan clip after re-record.
    expect(await db.get("takes", first.id)).toBeUndefined();
    expect(await db.get("clipMeta", firstClip)).toBeUndefined();
    expect(await db.get("clipData", firstClip)).toBeUndefined();
    // The new clip is intact.
    expect(await db.get("clipData", secondClip)).toBeDefined();
  });

  it("lands a take finished when the recorder carried an explicit mark", async () => {
    // The recorder's Finished checkbox rides the take rather than a separate
    // write after it: addTake sets the final status in the SAME transaction, so
    // a save-failure retry re-applies the mark instead of dropping it. `true`
    // means the translator explicitly marked THIS take done.
    const { segmentId } = await oneSegment();
    const take = await addTake(segmentId, await storedClip(), 100, {
      finished: true,
    });
    const db = await getDb();
    const segment = await db.get("segments", segmentId);
    expect(segment?.activeTakeId).toBe(take.id);
    expect(segment?.status).toBe("affirmed");
    expect(isFinished(segment!.status)).toBe(true);
  });

  it("defaults a take to draft, so an unmarked re-record demotes", async () => {
    // The default is what protects the demote invariant: a re-record the
    // translator did NOT mark finished must not carry an earlier approval
    // forward. `addTake` with no finished option, and with `false`, both land
    // draft.
    const { segmentId } = await oneSegment();
    await addTake(segmentId, await storedClip(), 100, { finished: true });

    const demoted = await addTake(segmentId, await storedClip(), 120);
    const db = await getDb();
    expect((await db.get("segments", segmentId))?.status).toBe("draft");
    void demoted;

    await addTake(segmentId, await storedClip(), 130, { finished: false });
    expect((await db.get("segments", segmentId))?.status).toBe("draft");
  });

  it("bumps the book's updatedAt when a segment is recorded (shelf recency)", async () => {
    // listBooks sorts by updatedAt; recording is activity, so the book being
    // worked in must float up, not sink under one that only got a new chapter.
    const book = await createBook("b", null, 1000);
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    await addTake(segment.id, await storedClip(), 100, { now: 5000 });
    expect((await getBook(book.id))?.updatedAt).toBe(5000);
  });

  it("keeps the audio when a re-record reuses the same clip id", async () => {
    // The pending-take retry path re-runs the save with the SAME clipId
    // (retrySave keeps it; putClip is an upsert). addTake then sees
    // prior.clipId === new clipId, and deleting "the superseded clip" would
    // strand the take it just wrote — the guard at books.ts is the only thing
    // stopping that, and nothing else exercises it.
    const { segmentId } = await oneSegment();
    const clipId = await storedClip(1000);
    await addTake(segmentId, clipId, 1000);

    // Same id again, as a retry does: re-store (upsert) then re-add.
    await putClip(clipId, samples(1000), CANONICAL_SAMPLE_RATE);
    const second = await addTake(segmentId, clipId, 1000);

    const db = await getDb();
    expect((await db.get("segments", segmentId))?.activeTakeId).toBe(second.id);
    // The audio the active take points at must still be present.
    expect(await db.get("clipMeta", clipId)).toBeDefined();
    expect(await db.get("clipData", clipId)).toBeDefined();
    const audio = await loadSegmentClip(segmentId);
    expect(audio.kind).toBe("resolved");
  });

  it("clears a segment back to never-recorded, deleting the take and its clip", async () => {
    // B5 cut-to-nothing lands here: an empty edited buffer must NOT persist as a
    // 0-frame take (which would resolve as a real, silent recording). The take,
    // the pointer, and the PCM all go, and the segment reads not-started again.
    const { segmentId } = await oneSegment();
    const clipId = await storedClip(1000);
    const take = await addTake(segmentId, clipId, 1000, { finished: true });

    await clearSegmentTake(segmentId);

    const db = await getDb();
    const segment = await db.get("segments", segmentId);
    expect(segment?.activeTakeId).toBeNull();
    expect(segment?.status).toBe("not-started");
    expect(await db.get("takes", take.id)).toBeUndefined();
    expect(await db.get("clipMeta", clipId)).toBeUndefined();
    expect(await db.get("clipData", clipId)).toBeUndefined();
    // And nothing downstream can mistake it for playable audio.
    expect((await loadSegmentClip(segmentId)).kind).not.toBe("resolved");
  });

  it("is an idempotent no-op on a segment that has no take", async () => {
    const { segmentId } = await oneSegment();
    await clearSegmentTake(segmentId); // never recorded
    const db = await getDb();
    const segment = await db.get("segments", segmentId);
    expect(segment?.activeTakeId).toBeNull();
    expect(segment?.status).toBe("not-started");
    // A second clear is still safe.
    await expect(clearSegmentTake(segmentId)).resolves.toBeUndefined();
  });

  it("keeps a clip that another take still references when clearing", async () => {
    // Frank R4: clips are 1:1 today, but if two takes ever share a clipId,
    // clearing one segment must NOT delete the audio the other still plays.
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    const s2 = await addSegment(chapter.id);
    const shared = await storedClip(500);
    await addTake(s1.id, shared, 100);
    await addTake(s2.id, shared, 100); // both point at the same clip

    await clearSegmentTake(s1.id);

    const db = await getDb();
    expect((await db.get("segments", s1.id))?.activeTakeId).toBeNull();
    // The shared clip survives because s2 still references it.
    expect(await db.get("clipMeta", shared)).toBeDefined();
    expect(await db.get("clipData", shared)).toBeDefined();
    expect((await loadSegmentClip(s2.id)).kind).toBe("resolved");
  });

  it("leaves other segments untouched when one is cleared", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    const s2 = await addSegment(chapter.id);
    await addTake(s1.id, await storedClip(), 100);
    const keep = await addTake(s2.id, await storedClip(), 100);

    await clearSegmentTake(s1.id);

    const db = await getDb();
    expect((await db.get("segments", s1.id))?.activeTakeId).toBeNull();
    expect((await db.get("segments", s2.id))?.activeTakeId).toBe(keep.id);
    expect((await loadSegmentClip(s2.id)).kind).toBe("resolved");
  });

  it("resolves export order across segments and counts gaps", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    const s2 = await addSegment(chapter.id); // left unrecorded
    const s3 = await addSegment(chapter.id);

    const t1 = await addTake(s1.id, await storedClip(), 100);
    const t3 = await addTake(s3.id, await storedClip(), 100);
    void s2;

    const { clipIds, missing } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([t1.clipId, t3.clipId]);
    expect(missing).toBe(1);
  });

  it("counts a segment whose active take has vanished as missing", async () => {
    // The gap test above only exercises the `activeTakeId === null` branch.
    // This is the other one: the segment still points at a take row that is no
    // longer there. Dropping it from the export without counting it would make
    // the UI report a chapter as complete while a segment is silently absent
    // from the MP3.
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    const s2 = await addSegment(chapter.id);
    const t1 = await addTake(s1.id, await storedClip(), 100);
    const dangling = await addTake(s2.id, await storedClip(), 100);

    const db = await getDb();
    await db.delete("takes", dangling.id);

    const { clipIds, missing } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([t1.clipId]);
    expect(missing).toBe(1);
  });

  it("counts a segment whose active take points at no stored clip", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const s1 = await addSegment(chapter.id);
    const s2 = await addSegment(chapter.id);

    const t1 = await addTake(s1.id, await storedClip(), 100);
    // The take row is fine. The audio it names was never written — a save
    // that failed after `addTake`, or a clip deleted from under it.
    await addTake(s2.id, newClipId(), 100);

    const { clipIds, missing } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([t1.clipId]);
    expect(missing).toBe(1);
  });

  it("rejects takes against an unknown segment", async () => {
    await expect(addTake("nope" as never, newClipId(), 100)).rejects.toThrow(
      /No such segment/
    );
  });
});

/**
 * The segment -> take -> clip walk.
 *
 * These are the cases the three former copies of this walk disagreed about.
 * Every one of them is reachable in the model today: nothing enforces that a
 * take's `clipId` names a stored clip, and nothing deletes a segment's
 * `activeTakeId` when the take row goes.
 */
describe("segment audio resolution", () => {
  it("resolves a segment whose take has stored audio", async () => {
    const { segmentId } = await oneSegment();
    const clipId = await storedClip(150);
    const take = await addTake(segmentId, clipId, 1000);

    const meta = await resolveSegmentAudio(segmentId);
    expect(meta.kind).toBe("resolved");
    if (meta.kind !== "resolved") return;
    expect(meta.take.id).toBe(take.id);
    expect(meta.clip.id).toBe(clipId);
    expect(meta.clip.frameCount).toBe(150);

    const full = await loadSegmentClip(segmentId);
    expect(full.kind).toBe("resolved");
    if (full.kind !== "resolved") return;
    expect(full.clip.samples.length).toBe(150);
    expect(danglingReason(full)).toBeNull();
  });

  it("reports a segment nobody has recorded, and calls it no fault", async () => {
    const { segmentId } = await oneSegment();

    const meta = await resolveSegmentAudio(segmentId);
    expect(meta.kind).toBe("no-active-take");
    // The distinction the whole union exists for: this is the empty case, not
    // a broken one, and it must not be reported as damage.
    expect(danglingReason(meta)).toBeNull();
    expect((await loadSegmentClip(segmentId)).kind).toBe("no-active-take");
  });

  it("reports a segment whose active take row is gone", async () => {
    const { segmentId } = await oneSegment();
    const take = await addTake(segmentId, await storedClip(), 100);
    const db = await getDb();
    await db.delete("takes", take.id);

    for (const audio of [
      await resolveSegmentAudio(segmentId),
      await loadSegmentClip(segmentId),
    ]) {
      expect(audio.kind).toBe("take-missing");
      // Not "no-active-take": the segment still claims a recording.
      expect(danglingReason(audio)).toMatch(/not in the database/);
    }
  });

  it("reports a take whose clip was never stored", async () => {
    const { segmentId } = await oneSegment();
    // `addTake` takes the clip id on trust — nothing checks the clip exists,
    // which is how a chapter can hold takes pointing at no audio at all.
    const take = await addTake(segmentId, newClipId(), 100);

    for (const audio of [
      await resolveSegmentAudio(segmentId),
      await loadSegmentClip(segmentId),
    ]) {
      expect(audio.kind).toBe("clip-missing");
      expect(danglingReason(audio)).toMatch(new RegExp(take.clipId));
    }
  });

  it("reports a clip whose samples went without its metadata", async () => {
    const { segmentId } = await oneSegment();
    const clipId = await storedClip();
    await addTake(segmentId, clipId, 100);
    const db = await getDb();
    await db.delete("clipData", clipId);

    // Both variants miss. `resolveSegmentAudio` probes the samples key
    // without reading it, so "resolved" means the audio is actually there —
    // the export path counts on that word.
    expect((await resolveSegmentAudio(segmentId)).kind).toBe("clip-missing");
    expect((await loadSegmentClip(segmentId)).kind).toBe("clip-missing");
  });

  it("counts a metadata-only clip as missing from a chapter export", async () => {
    const { chapterId, segmentId } = await oneSegment();
    const clipId = await storedClip();
    await addTake(segmentId, clipId, 100);
    const db = await getDb();
    await db.delete("clipData", clipId);

    // The regression this whole module exists for: a chapter must not read as
    // complete on the strength of a row that names audio the database cannot
    // produce. A gap the count admits to is recoverable; one it does not is not.
    const { clipIds, missing } = await resolveChapterClipIds(chapterId);
    expect(clipIds).toEqual([]);
    expect(missing).toBe(1);
  });

  it("reports a segment id with no row behind it", async () => {
    const audio = await resolveSegmentAudio("gone" as never);
    expect(audio.kind).toBe("no-segment");
    expect(danglingReason(audio)).toMatch(/not in the database/);
  });

  it("resolves again once the missing clip is stored", async () => {
    const { segmentId } = await oneSegment();
    const clipId = newClipId();
    await addTake(segmentId, clipId, 100);
    expect((await loadSegmentClip(segmentId)).kind).toBe("clip-missing");

    // The resolver reads; it does not repair and it does not latch. Storing
    // the audio under the id the take already names is enough.
    await putClip(clipId, samples(40), CANONICAL_SAMPLE_RATE);
    expect((await loadSegmentClip(segmentId)).kind).toBe("resolved");
  });
});
