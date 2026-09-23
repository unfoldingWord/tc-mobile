import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  createBook,
  resolveChapterClipIds,
} from "@/lib/storage/books";
import {
  clearSegmentTake,
  saveTake,
  setSegmentFinished,
} from "@/lib/storage/takes";
import {
  getClip,
  getClipMeta,
  newClipId,
  putClip,
  totalClipBytes,
} from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  loadSegmentClip,
  resolveSegmentAudio,
} from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
  recordTranscodeStall,
} from "@/lib/storage/transcode";
import type { ClipId, SegmentId } from "@/types/domain";
import { clearAllStores, samplesOf } from "./support";

/**
 * Transcode on Finished (B8, D3) — the storage half, T1.
 *
 * `commitTranscode` replaces the only copy of a translator's audio with a lossy
 * transcode. Every case here is about the two things that must never happen: the
 * PCM going without the MP3 landing, and an MP3 landing over audio that is no
 * longer the audio it was encoded from. The encoder is the real one; what is
 * faked is nothing — a tone is recorded, encoded, and committed.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A recorded segment: the ids to address it and the PCM it holds. */
async function recordedSegment(frames = 2000, value = 1000) {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  const clipId = newClipId();
  const pcm = samples(frames, value);
  await saveTake(segment.id, clipId, pcm, CANONICAL_SAMPLE_RATE);
  return { chapterId: chapter.id, segmentId: segment.id, clipId, pcm };
}

/** What a sweep would hand `commitTranscode` for a clip: its MP3 and row peaks. */
function encoded(pcm: Int16Array) {
  return { mp3: encodeMp3(pcm), peaks: computePeaks(pcm, 4) };
}

/** The raw bytes under a clip id, as the Int16 view a PCM clip is. */
async function storedPcm(clipId: ClipId): Promise<Int16Array | undefined> {
  const data = await (await getDb()).get("clipData", clipId);
  return data ? new Int16Array(data) : undefined;
}

beforeEach(clearAllStores);

describe("listPcmFinishedSegments", () => {
  it("lists a finished segment whose clip is still PCM, and nothing else", async () => {
    const finished = await recordedSegment();
    await setSegmentFinished(finished.segmentId, true);

    // Recorded but not finished: PCM is the right encoding for it — not owed.
    const draft = await recordedSegment();
    // Never recorded: nothing to transcode.
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const empty = await addSegment(chapter.id);
    void draft;
    void empty;

    expect(await listPcmFinishedSegments()).toEqual([
      { segmentId: finished.segmentId, clipId: finished.clipId },
    ]);
  });

  it("drops a segment once its clip is MP3", async () => {
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const { mp3, peaks } = encoded(pcm);
    await commitTranscode(segmentId, clipId, mp3, peaks);

    expect(await listPcmFinishedSegments()).toEqual([]);
  });

  it("orders owed PCM by durable stall count", async () => {
    const first = await recordedSegment(2000, 100);
    await setSegmentFinished(first.segmentId, true);
    const second = await recordedSegment(2000, 200);
    await setSegmentFinished(second.segmentId, true);

    await recordTranscodeStall(first.clipId);

    expect(await listPcmFinishedSegments()).toEqual([
      { segmentId: second.segmentId, clipId: second.clipId },
      { segmentId: first.segmentId, clipId: first.clipId },
    ]);
    expect((await getClipMeta(first.clipId))?.transcodeStallCount).toBe(1);
    expect((await getClipMeta(second.clipId))?.transcodeStallCount).toBe(0);
  });

  it("skips a finished segment whose take or clip is dangling", async () => {
    // Nothing to encode from: a sweep must not try to load audio the database
    // cannot produce. (Corrupt by construction; `addTake` demotes so only external
    // loss reaches this.)
    const { segmentId } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const db = await getDb();
    const segment = await db.get("segments", segmentId);
    await db.delete("takes", segment!.activeTakeId!);

    expect(await listPcmFinishedSegments()).toEqual([]);
  });
});

describe("commitTranscode", () => {
  it("lands the MP3 over the PCM in one step and keeps the duration", async () => {
    const { chapterId, segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const before = await getClipMeta(clipId);
    const { mp3, peaks } = encoded(pcm);

    expect(await commitTranscode(segmentId, clipId, mp3, peaks)).toBe(
      "committed"
    );

    // The bytes under the clip id ARE the MP3 now — the PCM is gone with them.
    const db = await getDb();
    const data = await db.get("clipData", clipId);
    expect(Array.from(new Uint8Array(data!))).toEqual(Array.from(mp3));

    const meta = await getClipMeta(clipId);
    expect(meta?.encoding).toBe("mp3");
    expect(meta?.generation).toBe(1);
    expect(meta?.byteLength).toBe(mp3.byteLength);
    expect(meta?.peaks).toEqual(peaks);
    // The original length and duration survive: they are what the export sizes
    // its slot by and what the row shows.
    expect(meta?.frameCount).toBe(before?.frameCount);
    expect(meta?.durationMs).toBe(before?.durationMs);
    expect(meta?.createdAt).toBe(before?.createdAt);

    // Every reader sees an MP3 clip, and the segment still resolves as recorded.
    const clip = await getClip(clipId);
    expect(clip?.encoding).toBe("mp3");
    if (clip?.encoding === "mp3")
      expect(Array.from(clip.mp3)).toEqual(Array.from(mp3));
    const audio = await loadSegmentClip(segmentId);
    expect(audio.kind).toBe("resolved");
    if (audio.kind === "resolved") expect(audio.clip.encoding).toBe("mp3");
    expect((await resolveSegmentAudio(segmentId)).kind).toBe("resolved");
    expect(await resolveChapterClipIds(chapterId)).toEqual({
      clipIds: [clipId],
      missing: 0,
    });
    // Storage pressure is reported at the MP3's size — the saving D3 is for.
    expect(await totalClipBytes()).toBe(mp3.byteLength);
    expect(mp3.byteLength).toBeLessThan(pcm.length * 2);
  });

  it("is stale, and writes nothing, when the segment was un-finished meanwhile", async () => {
    // D3: PCM while a segment is being worked on. A translator who un-ticks
    // Finished during the encode must keep the PCM.
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const { mp3, peaks } = encoded(pcm);
    await setSegmentFinished(segmentId, false);

    expect(await commitTranscode(segmentId, clipId, mp3, peaks)).toBe("stale");

    expect((await getClipMeta(clipId))?.encoding).toBe("pcm");
    expect(Array.from((await storedPcm(clipId))!)).toEqual(Array.from(pcm));
    expect(samplesOf(await getClip(clipId)).length).toBe(pcm.length);
  });

  it("is stale when the take was replaced by a new clip meanwhile", async () => {
    // Edited or re-recorded during the encode: the clip the MP3 came from is
    // gone (1:1 replace) and the new one is PCM under a NEW id. The MP3 of the
    // OLD audio must not land anywhere.
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const { mp3, peaks } = encoded(pcm);
    const newer = samples(3000, -500);
    const newClip = newClipId();
    await saveTake(segmentId, newClip, newer, CANONICAL_SAMPLE_RATE, {
      finished: true,
    });

    expect(await commitTranscode(segmentId, clipId, mp3, peaks)).toBe("stale");

    expect((await getClipMeta(newClip))?.encoding).toBe("pcm");
    expect(Array.from((await storedPcm(newClip))!)).toEqual(Array.from(newer));
    expect(await getClipMeta(clipId)).toBeUndefined(); // reaped by the replace
  });

  it("is stale when the encoded clip is no longer the segment's, even if it still exists", async () => {
    // The clip-id check on its own. In the replace case above the old clip is
    // also reaped, so `!meta` would call it stale without the id check ever
    // running; here the encoded clip is put back (the pending-take retry path
    // re-stores under the same id) while the take points at a NEWER clip. The
    // MP3 of the old audio must not land on an orphan the segment does not own.
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const { mp3, peaks } = encoded(pcm);
    await saveTake(
      segmentId,
      newClipId(),
      samples(3000, -500),
      CANONICAL_SAMPLE_RATE,
      {
        finished: true,
      }
    );
    await putClip(clipId, pcm, CANONICAL_SAMPLE_RATE); // the old clip, back as an orphan

    expect(await commitTranscode(segmentId, clipId, mp3, peaks)).toBe("stale");

    expect((await getClipMeta(clipId))?.encoding).toBe("pcm");
    expect(Array.from((await storedPcm(clipId))!)).toEqual(Array.from(pcm));
  });

  it("is stale when the segment is gone", async () => {
    const { pcm } = await recordedSegment();
    const { mp3, peaks } = encoded(pcm);
    expect(
      await commitTranscode("gone" as SegmentId, newClipId(), mp3, peaks)
    ).toBe("stale");
  });

  it("reports an already-MP3 clip without touching it", async () => {
    // Two sweeps overlapping (two screens, a fast double-toggle): the second
    // finds MP3 and must not stack a second lossy generation.
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const first = encoded(pcm);
    await commitTranscode(segmentId, clipId, first.mp3, first.peaks);
    const second = encoded(samples(2000, 7)); // different bytes, on purpose

    expect(
      await commitTranscode(segmentId, clipId, second.mp3, second.peaks)
    ).toBe("already");

    const meta = await getClipMeta(clipId);
    expect(meta?.generation).toBe(1);
    const data = await (await getDb()).get("clipData", clipId);
    expect(Array.from(new Uint8Array(data!))).toEqual(Array.from(first.mp3));
  });

  it("refuses an empty MP3 and leaves the PCM intact", async () => {
    // An encoder that produced nothing must not take the only copy with it.
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    await expect(
      commitTranscode(
        segmentId,
        clipId,
        new Uint8Array(0),
        computePeaks(pcm, 4)
      )
    ).rejects.toThrow(/empty/);

    expect((await getClipMeta(clipId))?.encoding).toBe("pcm");
    expect(Array.from((await storedPcm(clipId))!)).toEqual(Array.from(pcm));
  });

  it("stores only the MP3 bytes when handed a view onto a larger buffer", async () => {
    // The same trap `putClip` guards: a subarray view would serialise its whole
    // backing buffer into IndexedDB.
    const { segmentId, clipId, pcm } = await recordedSegment();
    await setSegmentFinished(segmentId, true);
    const { mp3, peaks } = encoded(pcm);
    const backing = new Uint8Array(mp3.length + 10_000);
    backing.set(mp3, 5000);
    const view = backing.subarray(5000, 5000 + mp3.length);

    await commitTranscode(segmentId, clipId, view, peaks);

    const data = await (await getDb()).get("clipData", clipId);
    expect(data!.byteLength).toBe(mp3.length);
    expect((await getClipMeta(clipId))?.byteLength).toBe(mp3.length);
  });
});

describe("the lossy-generation count (Q5)", () => {
  it("counts each transcode, carries through an edit, and resets on erase", async () => {
    // 0: fresh PCM. 1: transcoded on Finished. An edit decodes that MP3 and
    // saves PCM again — still 1 lossy pass in the audio's history. Finishing
    // again: 2. Erase and record fresh: back to 0.
    const { segmentId, clipId, pcm } = await recordedSegment();
    expect((await getClipMeta(clipId))?.generation).toBe(0);

    await setSegmentFinished(segmentId, true);
    let enc = encoded(pcm);
    await commitTranscode(segmentId, clipId, enc.mp3, enc.peaks);
    expect((await getClipMeta(clipId))?.generation).toBe(1);

    // The recorder's edit-save: a replacement take, PCM, new clip id. It
    // inherits the count of the clip it replaces.
    const edited = newClipId();
    await saveTake(
      segmentId,
      edited,
      samples(2500, 900),
      CANONICAL_SAMPLE_RATE
    );
    const editedMeta = await getClipMeta(edited);
    expect(editedMeta?.encoding).toBe("pcm");
    expect(editedMeta?.generation).toBe(1);

    await setSegmentFinished(segmentId, true);
    enc = encoded(samples(2500, 900));
    await commitTranscode(segmentId, edited, enc.mp3, enc.peaks);
    expect((await getClipMeta(edited))?.generation).toBe(2);

    // Erase clears the take; the next recording has no prior to inherit from.
    await clearSegmentTake(segmentId);
    const fresh = newClipId();
    await saveTake(segmentId, fresh, samples(100), CANONICAL_SAMPLE_RATE);
    expect((await getClipMeta(fresh))?.generation).toBe(0);
  });

  it("starts a first recording at 0", async () => {
    const { clipId } = await recordedSegment();
    expect((await getClipMeta(clipId))?.generation).toBe(0);
  });
});
