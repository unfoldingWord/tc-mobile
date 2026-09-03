import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import {
  addChapter,
  addSegment,
  addTake,
  createBook,
  setSegmentFinished,
} from "@/lib/storage/books";
import { newClipId, putClip } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { SegmentId } from "@/types/domain";

/**
 * `loadRecorderSegmentView` is the React-free core of `useRecorderSegment` —
 * the segment → clip walk, the empty/PCM/MP3 branches, and the view it builds.
 * This repo has no jsdom or renderer (the same constraint
 * `tests/use-erase-segment.test.ts` and `tests/save-failure.test.ts` document),
 * so the hook's `error`/`retry`/`attempt` React state and its "resume the
 * AudioContext on the retry gesture" wiring (#106/#137) are review + on-device
 * surface, not exercised here. What IS node-testable is the load itself: the
 * empty and PCM paths a translator hits every session, and the throw a missing
 * segment produces (which the hook maps to `error` and the recovery panel).
 *
 * The MP3 decode branch runs the browser's `decodeAudioData`, so it can only be
 * exercised on a device — like the rest of the audio boundary, and not yet run
 * on one at this head.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A book → chapter → one segment, optionally carrying a PCM take. */
const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook("Ruth");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return segment.id;
};

beforeEach(async () => {
  // Clear every store rather than deleting the database: `deleteDatabase`
  // blocks while any connection is open, so clearing is the deterministic reset
  // (AGENTS.md, mirrored from tests/storage.test.ts).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("loadRecorderSegmentView", () => {
  it("opens an unrecorded segment as record-only: no clip, no peaks", async () => {
    const segmentId = await freshSegment();

    const view = await loadRecorderSegmentView(segmentId);

    expect(view.hasClip).toBe(false);
    expect(view.samples).toBeNull();
    expect(view.peaks).toBeNull();
    expect(view.lengthSamples).toBe(0);
    expect(view.finished).toBe(false);
    // The breadcrumb the sheet header shows.
    expect(view.bookName).toBe("Ruth");
    expect(view.chapterNumber).toBe(1);
    expect(view.ordinal).toBe(1);
  });

  it("opens a PCM segment over its samples, with peaks and the length domain", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const pcm = samples(500);
    const meta = await putClip(clipId, pcm, CANONICAL_SAMPLE_RATE);
    await addTake(segmentId, clipId, meta.durationMs);

    const view = await loadRecorderSegmentView(segmentId);

    expect(view.hasClip).toBe(true);
    // The stored PCM is handed through untouched — no decode/align on this path.
    expect(view.samples).toEqual(pcm);
    expect(view.lengthSamples).toBe(pcm.length);
    // Peaks are computed for the waveform (a fixed bucket count, so non-null).
    expect(view.peaks).not.toBeNull();
    expect(view.finished).toBe(false);
  });

  it("carries the finished flag through for a finished PCM segment", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const meta = await putClip(clipId, samples(500), CANONICAL_SAMPLE_RATE);
    await addTake(segmentId, clipId, meta.durationMs);
    await setSegmentFinished(segmentId, true);

    const view = await loadRecorderSegmentView(segmentId);

    expect(view.finished).toBe(true);
    expect(view.hasClip).toBe(true);
  });

  it("throws on a missing segment — the failure the hook maps to the recovery panel", async () => {
    const bogus = newClipId() as unknown as SegmentId;

    await expect(loadRecorderSegmentView(bogus)).rejects.toThrow(
      "No such segment"
    );
  });
});
