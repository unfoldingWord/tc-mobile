import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import { rowAudio } from "@/hooks/use-chapter-segments";
import {
  addChapter,
  addSegment,
  createBook,
  saveTake,
  setSegmentFinished,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import * as segmentAudio from "@/lib/storage/segment-audio";
import { commitTranscode } from "@/lib/storage/transcode";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";
import { clearAllStores, ramp } from "./support";

/**
 * The Segments row's audio read (B8), and the interleaving round 3 found: the
 * row reads metadata, then — for a PCM clip — the samples, in two transactions,
 * and the transcode sweep can land between them. The second read then returns
 * an MP3 clip, which is a recorded, finished segment and must draw as one.
 */

beforeEach(clearAllStores);

async function recorded(pcm: Int16Array) {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  const clipId = newClipId();
  await saveTake(segment.id, clipId, pcm, CANONICAL_SAMPLE_RATE);
  return { segmentId: segment.id, clipId };
}

describe("rowAudio", () => {
  it("computes a PCM row's peaks from its samples", async () => {
    const pcm = ramp(3000);
    const { segmentId, clipId } = await recorded(pcm);
    const row = await rowAudio(segmentId);
    expect(row?.clipId).toBe(clipId);
    expect(row?.peaks).toEqual(computePeaks(pcm, ROW_PEAK_BUCKETS));
  });

  it("draws a finished (MP3) row from its stored peaks without loading bytes", async () => {
    const pcm = ramp(3000);
    const { segmentId, clipId } = await recorded(pcm);
    await setSegmentFinished(segmentId, true);
    const peaks = computePeaks(pcm, ROW_PEAK_BUCKETS);
    await commitTranscode(segmentId, clipId, encodeMp3(pcm), peaks);
    const load = vi.spyOn(segmentAudio, "loadSegmentClip");

    const row = await rowAudio(segmentId);

    expect(row?.peaks).toEqual(peaks);
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
  });

  it("still resolves when the sweep lands between the metadata read and the samples read", async () => {
    // The clip is MP3 on disk. Make the FIRST read report the PCM it would have
    // seen a moment earlier; the second read then returns the MP3 clip. Round 3's
    // code returned null here — a finished, transcoded segment drawn as
    // never-recorded (flat line, red Record, no Play) until the next reload.
    const pcm = ramp(3000);
    const { segmentId, clipId } = await recorded(pcm);
    await setSegmentFinished(segmentId, true);
    const peaks = computePeaks(pcm, ROW_PEAK_BUCKETS);
    await commitTranscode(segmentId, clipId, encodeMp3(pcm), peaks);
    const real = segmentAudio.resolveSegmentAudio;
    const stale = vi
      .spyOn(segmentAudio, "resolveSegmentAudio")
      .mockImplementation(async (id) => {
        const now = await real(id);
        if (now.kind !== "resolved") return now;
        return { ...now, clip: { ...now.clip, encoding: "pcm" } };
      });

    const row = await rowAudio(segmentId);

    expect(row).not.toBeNull();
    expect(row?.clipId).toBe(clipId);
    expect(row?.peaks).toEqual(peaks);
    stale.mockRestore();
  });

  it("reads a never-recorded segment as no audio", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    expect(await rowAudio(segment.id)).toBeNull();
  });
});
