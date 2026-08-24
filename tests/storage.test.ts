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
  addSection,
  addTake,
  createProject,
  getSectionsOfChapter,
  listProjects,
  resolveChapterClipIds,
  setActiveTake,
} from "@/lib/storage/projects";
import {
  danglingReason,
  loadSegmentClip,
  resolveSegmentAudio,
} from "@/lib/storage/segment-audio";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { SectionRef } from "@/types/domain";

const ref = (n: number): SectionRef => ({ book: "RUT", scope: `1:${n}` });

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

  it("reports total bytes held on device", async () => {
    await putClip(newClipId(), samples(100), CANONICAL_SAMPLE_RATE);
    await putClip(newClipId(), samples(50), CANONICAL_SAMPLE_RATE);
    expect(await totalClipBytes()).toBe(300); // 150 frames * 2 bytes
  });

  it("returns undefined for an unknown clip", async () => {
    expect(await getClip(newClipId())).toBeUndefined();
  });
});

describe("project tree", () => {
  it("creates and lists a project", async () => {
    const project = await createProject("Nukak OBS", "nukak");
    const all = await listProjects();
    expect(all.map((p) => p.id)).toEqual([project.id]);
    expect(all[0]?.languageCode).toBe("nukak");
  });

  it("creates each section with one segment ready to record", async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const { section, segment } = await addSection(chapter.id, ref(1));
    expect(section.segmentIds).toEqual([segment.id]);
    expect(segment.activeTakeId).toBeNull();
    expect(segment.status).toBe("not-started");
  });

  it("preserves section order as declared, not as stored", async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const a = await addSection(chapter.id, ref(1));
    const b = await addSection(chapter.id, ref(2));
    const c = await addSection(chapter.id, ref(3));

    const sections = await getSectionsOfChapter(chapter.id);
    expect(sections.map((s) => s.id)).toEqual([
      a.section.id,
      b.section.id,
      c.section.id,
    ]);
  });

  it("keeps prior takes and makes the newest active", async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const { segment } = await addSection(chapter.id, ref(1));

    const first = await addTake(segment.id, await storedClip(), 1000);
    const second = await addTake(segment.id, await storedClip(), 1200);

    const { clipIds } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([second.clipId]);

    // The first take still exists and can be restored.
    await setActiveTake(segment.id, first.id);
    const after = await resolveChapterClipIds(chapter.id);
    expect(after.clipIds).toEqual([first.clipId]);
  });

  it("refuses to activate a take from another segment", async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const one = await addSection(chapter.id, ref(1));
    const two = await addSection(chapter.id, ref(2));
    const foreign = await addTake(two.segment.id, newClipId(), 500);

    await expect(setActiveTake(one.segment.id, foreign.id)).rejects.toThrow(
      /does not belong/
    );
  });

  it("resolves export order across sections and counts gaps", async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const s1 = await addSection(chapter.id, ref(1));
    const s2 = await addSection(chapter.id, ref(2)); // left unrecorded
    const s3 = await addSection(chapter.id, ref(3));

    const t1 = await addTake(s1.segment.id, await storedClip(), 100);
    const t3 = await addTake(s3.segment.id, await storedClip(), 100);
    void s2;

    const { clipIds, missing } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([t1.clipId, t3.clipId]);
    expect(missing).toBe(1);
  });

  it("counts a segment whose active take has vanished as missing", async () => {
    // The gap test above only exercises the `activeTakeId === null` branch.
    // This is the other one: the segment still points at a take row that is no
    // longer there. Dropping it from the export without counting it would make
    // the UI report a chapter as complete while a section is silently absent
    // from the MP3.
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const s1 = await addSection(chapter.id, ref(1));
    const s2 = await addSection(chapter.id, ref(2));
    const t1 = await addTake(s1.segment.id, await storedClip(), 100);
    const dangling = await addTake(s2.segment.id, await storedClip(), 100);

    const db = await getDb();
    await db.delete("takes", dangling.id);

    const { clipIds, missing } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([t1.clipId]);
    expect(missing).toBe(1);
  });

  it("counts a segment whose active take points at no stored clip", async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const s1 = await addSection(chapter.id, ref(1));
    const s2 = await addSection(chapter.id, ref(2));

    const t1 = await addTake(s1.segment.id, await storedClip(), 100);
    // The take row is fine. The audio it names was never written — a save
    // that failed after `addTake`, or a clip deleted from under it.
    await addTake(s2.segment.id, newClipId(), 100);

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
  /** A section with one segment, and the ids to address it by. */
  const oneSegment = async () => {
    const project = await createProject("p");
    const chapter = await addChapter(project.id, 1);
    const { segment } = await addSection(chapter.id, ref(1));
    return { chapterId: chapter.id, segmentId: segment.id };
  };

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
