import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildChapterPlaylist } from "@/lib/audio/chapter-queue";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  addChapter,
  addSegment,
  chapterPlayCandidates,
  createBook,
  getSegmentsOfChapter,
  resolveChapterClipIds,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import { saveTake } from "@/lib/storage/takes";
import type { ClipId, SegmentId } from "@/types/domain";
import { clearAllStores, ramp } from "./support";

/**
 * The storage read behind chapter play (#1468 slice b): a chapter's
 * membership, in `chapter.segmentIds` order, each segment probed for audio
 * without reading samples. `buildChapterPlaylist` (slice a) turns it into the
 * playlist; these tests hold the read to the same answers the Segments list
 * and the export walk already give.
 */

// The real probe, wrapped so one test can hold every probe open at once.
vi.mock("@/lib/storage/segment-audio", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/storage/segment-audio")>();
  return { ...real, resolveSegmentAudio: vi.fn(real.resolveSegmentAudio) };
});

beforeEach(clearAllStores);
afterEach(() => {
  vi.mocked(resolveSegmentAudio).mockRestore();
});

async function chapterWith(lengths: (number | null)[]) {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const ids: SegmentId[] = [];
  const clips: ClipId[] = [];
  for (const len of lengths) {
    const segment = await addSegment(chapter.id);
    ids.push(segment.id);
    if (len !== null) {
      const clipId = newClipId();
      clips.push(clipId);
      await saveTake(segment.id, clipId, ramp(len), CANONICAL_SAMPLE_RATE);
    }
  }
  return { chapterId: chapter.id, ids, clips };
}

describe("chapterPlayCandidates", () => {
  it("lists every member in order, with recorded lengths in frames", async () => {
    const { chapterId, ids } = await chapterWith([3000, null, 5000]);

    const candidates = await chapterPlayCandidates(chapterId);

    expect(candidates).toEqual([
      {
        segmentId: ids[0],
        startChapterId: chapterId,
        audio: { kind: "playable", frames: 3000 },
      },
      {
        segmentId: ids[1],
        startChapterId: chapterId,
        audio: { kind: "unrecorded" },
      },
      {
        segmentId: ids[2],
        startChapterId: chapterId,
        audio: { kind: "playable", frames: 5000 },
      },
    ]);
  });

  it("counts a take whose audio is gone as broken, as the export walk does", async () => {
    const { chapterId, ids, clips } = await chapterWith([3000, 4000]);
    const db = await getDb();
    const gone = clips[1];
    if (!gone) throw new Error("no clip");
    await db.delete("clipData", gone);

    const playlist = buildChapterPlaylist(
      chapterId,
      await chapterPlayCandidates(chapterId)
    );
    const exported = await resolveChapterClipIds(chapterId);

    expect(playlist.entries.map((e) => e.segmentId)).toEqual([ids[0]]);
    expect(playlist.broken).toEqual([ids[1]]);
    // The same skip set as the export: one clip resolved, one missing.
    expect(exported.clipIds).toHaveLength(playlist.entries.length);
    expect(exported.missing).toBe(1);
  });

  it("counts a member with no segment row as broken, in this chapter", async () => {
    const { chapterId, ids } = await chapterWith([3000]);
    const db = await getDb();
    const chapter = await db.get("chapters", chapterId);
    if (!chapter) throw new Error("no chapter");
    const ghost = "ghost-segment" as SegmentId;
    await db.put("chapters", {
      ...chapter,
      segmentIds: [...chapter.segmentIds, ghost],
    });

    const playlist = buildChapterPlaylist(
      chapterId,
      await chapterPlayCandidates(chapterId)
    );

    expect(playlist.entries.map((e) => e.segmentId)).toEqual([ids[0]]);
    expect(playlist.broken).toEqual([ghost]);
  });

  it("plays exactly the Segments list's recorded members", async () => {
    const { chapterId } = await chapterWith([3000, null, 2000, 1000]);

    const playlist = buildChapterPlaylist(
      chapterId,
      await chapterPlayCandidates(chapterId)
    );
    const listed = await getSegmentsOfChapter(chapterId);

    expect(playlist.entries.map((e) => e.segmentId)).toEqual(
      listed.filter((s) => s.activeTakeId !== null).map((s) => s.id)
    );
  });

  it("is empty for a chapter that does not exist", async () => {
    expect(await chapterPlayCandidates("nope" as never)).toEqual([]);
  });

  it("probes every member at once, and keeps the chapter's order (#1747)", async () => {
    const { chapterId, ids } = await chapterWith([3000, null, 5000]);
    const real = await vi.importActual<
      typeof import("@/lib/storage/segment-audio")
    >("@/lib/storage/segment-audio");
    const started: SegmentId[] = [];
    const gates: (() => void)[] = [];
    vi.mocked(resolveSegmentAudio).mockImplementation(async (segmentId) => {
      started.push(segmentId);
      await new Promise<void>((open) => gates.push(open));
      return real.resolveSegmentAudio(segmentId);
    });

    const pending = chapterPlayCandidates(chapterId);
    for (let i = 0; i < 50 && started.length < ids.length; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }

    // A serial walk would have started one probe and be waiting on it.
    expect(started).toEqual(ids);
    // Answers that arrive last-first still come back in membership order.
    for (const open of [...gates].reverse()) open();
    const candidates = await pending;
    expect(candidates.map((c) => c.segmentId)).toEqual(ids);
    expect(candidates.map((c) => c.audio.kind)).toEqual([
      "playable",
      "unrecorded",
      "playable",
    ]);
  });
});
