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
  deleteMedia,
  getMedia,
  hasMedia,
  putMedia,
  totalMediaBytes,
} from "@/lib/storage/media";
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
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { SectionRef } from "@/types/domain";

const ref = (n: number): SectionRef => ({ book: "RUT", scope: `1:${n}` });

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

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

  it("deletes both metadata and samples", async () => {
    const id = newClipId();
    await putClip(id, samples(10), CANONICAL_SAMPLE_RATE);
    await deleteClip(id);
    expect(await getClipMeta(id)).toBeUndefined();
    expect(await getClip(id)).toBeUndefined();
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

    const first = await addTake(segment.id, newClipId(), 1000);
    const second = await addTake(segment.id, newClipId(), 1200);

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

    const t1 = await addTake(s1.segment.id, newClipId(), 100);
    const t3 = await addTake(s3.segment.id, newClipId(), 100);
    void s2;

    const { clipIds, missing } = await resolveChapterClipIds(chapter.id);
    expect(clipIds).toEqual([t1.clipId, t3.clipId]);
    expect(missing).toBe(1);
  });

  it("rejects takes against an unknown segment", async () => {
    await expect(addTake("nope" as never, newClipId(), 100)).rejects.toThrow(
      /No such segment/
    );
  });
});

describe("reference media cache", () => {
  const url = "https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg";

  it("round-trips a blob", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "image/jpeg",
    });
    await putMedia(url, blob);

    const got = await getMedia(url);
    expect(got?.bytes).toBe(4);
    expect(got?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await got!.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4])
    );
  });

  it("reports presence without loading the blob", async () => {
    expect(await hasMedia(url)).toBe(false);
    await putMedia(url, new Blob(["x"], { type: "image/jpeg" }));
    expect(await hasMedia(url)).toBe(true);
  });

  it("sums bytes across entries for the storage budget", async () => {
    await putMedia("a", new Blob([new Uint8Array(100)]));
    await putMedia("b", new Blob([new Uint8Array(50)]));
    expect(await totalMediaBytes()).toBe(150);
  });

  it("deletes one entry without disturbing the others", async () => {
    await putMedia("a", new Blob(["aa"]));
    await putMedia("b", new Blob(["bb"]));
    await deleteMedia("a");
    expect(await hasMedia("a")).toBe(false);
    expect(await hasMedia("b")).toBe(true);
  });

  it("keeps media separate from recorded clips", async () => {
    // Guards against the two ever sharing a store: deleting a downloaded
    // story must never be able to remove a translator's recordings.
    await putMedia("a", new Blob(["aa"]));
    const clip = newClipId();
    await putClip(clip, samples(10), CANONICAL_SAMPLE_RATE);
    await deleteMedia("a");
    expect(await getClip(clip)).toBeDefined();
    expect(await totalClipBytes()).toBe(20);
  });
});
