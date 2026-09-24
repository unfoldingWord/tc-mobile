import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import {
  addChapter,
  addSegment,
  addTake,
  createBook,
  renameSegment,
  setSegmentFinished,
} from "@/lib/storage/books";
import { newClipId, putClip } from "@/lib/storage/clips";
import { commitTranscode } from "@/lib/storage/transcode";
import { closeDb, getDb } from "@/lib/storage/db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import * as peaksModule from "@/lib/audio/peaks";
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
 * The MP3 decode branch runs the browser's `decodeAudioData`, so a SUCCESSFUL
 * decode can only be exercised on a device — like the rest of the audio
 * boundary, and not yet run on one at this head. What IS pinned here is the
 * invariant that a finished MP3 segment REJECTS rather than opening as empty
 * (which would let the translator record over the clip): in Node the decode
 * throws, and the load must propagate that, not swallow it into `hasClip: false`.
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
  it("opens an unrecorded segment as record-only: no clip, no samples", async () => {
    const segmentId = await freshSegment();

    const view = await loadRecorderSegmentView(segmentId);

    expect(view.hasClip).toBe(false);
    expect(view.samples).toBeNull();
    expect(view.finished).toBe(false);
    // The breadcrumb the sheet header shows.
    expect(view.bookName).toBe("Ruth");
    expect(view.chapterNumber).toBe(1);
    expect(view.ordinal).toBe(1);
    expect(view.segmentLabel).toBeNull();
  });

  it("carries the segment's label for the breadcrumb (#591)", async () => {
    const segmentId = await freshSegment();
    await renameSegment(segmentId, "verses 3–4");

    const view = await loadRecorderSegmentView(segmentId);

    expect(view.ordinal).toBe(1);
    expect(view.segmentLabel).toBe("verses 3–4");
  });

  it("opens a PCM segment over its samples, byte for byte", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const pcm = samples(500);
    const meta = await putClip(clipId, pcm, CANONICAL_SAMPLE_RATE);
    await addTake(segmentId, clipId, meta.durationMs);
    const computePeaksSpy = vi.spyOn(peaksModule, "computePeaks");

    const view = await loadRecorderSegmentView(segmentId);

    expect(view.hasClip).toBe(true);
    // The stored PCM is handed through untouched — no decode/align on this
    // path, and no peaks pass: the sheet draws `editor.peaks` over the working
    // buffer, so peaks computed here would only be redrawn over (L-9, #160).
    expect(view.samples).toEqual(pcm);
    expect(view.finished).toBe(false);
    // Pins the absence of a full-PCM computePeaks pass on this path (#708 item
    // 2, George round-1 P3 on #702). Nothing in this open path is INCORRECT if
    // it returns — the byte-for-byte assertion above would still pass — it is
    // wasted work on every recorder open, on the phones least able to spare it.
    expect(computePeaksSpy).not.toHaveBeenCalled();
    computePeaksSpy.mockRestore();
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

  it("rejects a finished MP3 segment rather than opening it as empty (#137 invariant)", async () => {
    // A finished segment whose take has been transcoded to MP3 (the Finished
    // sweep's product): same clip id, `encoding: "mp3"`.
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const pcm = samples(500);
    const meta = await putClip(clipId, pcm, CANONICAL_SAMPLE_RATE);
    await addTake(segmentId, clipId, meta.durationMs);
    await setSegmentFinished(segmentId, true);
    const outcome = await commitTranscode(
      segmentId,
      clipId,
      encodeMp3(pcm),
      computePeaks(pcm, 4)
    );
    expect(outcome).toBe("committed");

    // The load must NOT swallow the MP3 into `hasClip: false` — that would open
    // the finished segment as empty and let the translator record over the clip,
    // the exact invariant the hook's JSDoc claims. It must REJECT so the hook
    // maps it to the recovery panel. The reject is what matters; the message is
    // environment noise (no Web Audio in Node), so this asserts only that it
    // throws rather than resolving with a clip.
    await expect(loadRecorderSegmentView(segmentId)).rejects.toThrow();
  });
});
