import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The commit is made to fail once in each case, so the hold's row is still on
// disk to be read: a non-quota failure keeps it for a relaunch to find.
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return { ...actual, saveTake: vi.fn(actual.saveTake) };
});
// Node has no `decodeAudioData`: the Finished (MP3) case decodes to a stand-in
// buffer, which is all the load needs to open the segment.
vi.mock("@/hooks/audio-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/audio-io")>();
  return {
    ...actual,
    decodeMp3ToCanonical: vi.fn(async () => new Int16Array(1200).fill(900)),
  };
});
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

import { withObservedRevision } from "@/hooks/observed-revision";
import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import { createTakeSlot } from "@/hooks/use-save-take";
import { cut, insertAt } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { NO_STAGES_RUN } from "@/lib/audio/loudness";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  listPendingTakes,
  loadPendingRecipe,
} from "@/lib/storage/pending-takes";
import { saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { ClipId, SegmentId, StoredPendingTake } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * #1545: a recording added to the stored PCM clip the recorder loaded,
 * unchanged, is held with a `stored` base (the clip named, not copied); any
 * other buffer is held `inline`.
 *
 * Run through the save path the recorder's `saveRecording` takes: the view the
 * recorder opens on (`loadRecorderSegmentView`), the take built from it
 * (`withObservedRevision`), and the slot (`createTakeSlot`), whose attempt
 * holds the take before the commit. The commit is failed once so the row stays
 * on disk to be read.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return segment.id;
};

/**
 * A segment holding one PCM clip of `frames` frames, a ramp so that moving a
 * phrase changes the content; returns both ids.
 */
const pcmSegment = async (
  frames = 800
): Promise<{ segmentId: SegmentId; clipId: ClipId }> => {
  const segmentId = await freshSegment();
  const clipId = newClipId();
  const ramp = Int16Array.from({ length: frames }, (_, i) => i);
  await saveTake(segmentId, clipId, ramp, CANONICAL_SAMPLE_RATE);
  return { segmentId, clipId };
};

/**
 * Hand the slot a take over `existing`, as `saveRecording` does, with the
 * commit failed once; resolves with the row the hold wrote.
 */
async function holdOver(
  segmentId: SegmentId,
  existing: Int16Array,
  opts: { recorded?: Int16Array; editOnly?: boolean } = {}
): Promise<StoredPendingTake> {
  const recorded = opts.recorded ?? samples(50, 7);
  vi.mocked(saveTake).mockRejectedValueOnce(new Error("commit refused"));
  const slot = createTakeSlot(() => {}, { requestSweep: () => {} });
  const saved = await slot.save(
    withObservedRevision({
      segmentId,
      ordinal: 1,
      clipId: newClipId(),
      existing,
      recorded,
      offset: existing.length,
      finished: false,
      editOnly: opts.editOnly ?? false,
    })
  );
  expect(saved).toBe(false);
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  expect(listed.rows).toHaveLength(1);
  return listed.rows[0]!;
}

beforeEach(async () => {
  await clearAllStores();
  vi.mocked(saveTake).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pending base of a take recorded over the loaded segment (#1545)", () => {
  it("is stored when the buffer is the loaded PCM clip unchanged", async () => {
    const { segmentId, clipId } = await pcmSegment(800);
    const view = await loadRecorderSegmentView(segmentId);

    const row = await holdOver(segmentId, view.samples!);

    expect(row.base).toEqual({
      kind: "stored",
      sourceClipId: clipId,
      generation: 0,
      frameCount: 800,
    });
  });

  it("is inline when the buffer was cut and pasted this session", async () => {
    const { segmentId } = await pcmSegment(800);
    const view = await loadRecorderSegmentView(segmentId);
    // A phrase cut and pasted back at the head: what the editor then holds is
    // a new buffer, as long as the clip, with other content. The length check
    // in `encodePendingBase` cannot tell it from the clip; only the recorder
    // knowing an edit ran can.
    const { remaining, removed } = cut(view.samples!, { start: 100, end: 200 });
    const edited = insertAt(remaining, removed, 0);
    expect(edited.length).toBe(800);

    const row = await holdOver(segmentId, edited);

    expect(row.base.kind).toBe("inline");
    if (row.base.kind !== "inline") return;
    expect(new Int16Array(row.base.samples)).toEqual(edited);
  });

  it("is inline on an edit-only save, even of the unchanged buffer", async () => {
    const { segmentId } = await pcmSegment(800);
    const view = await loadRecorderSegmentView(segmentId);

    const row = await holdOver(segmentId, view.samples!, {
      recorded: new Int16Array(0),
      editOnly: true,
    });

    expect(row.base.kind).toBe("inline");
  });

  it("is inline on a Finished segment, whose clip is an MP3", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const pcm = samples(1152);
    await saveTake(segmentId, clipId, pcm, CANONICAL_SAMPLE_RATE);
    await setSegmentFinished(segmentId, true);
    expect(
      await commitTranscode(
        segmentId,
        clipId,
        encodeMp3(pcm),
        computePeaks(pcm, 4),
        NO_STAGES_RUN
      )
    ).toBe("committed");
    const view = await loadRecorderSegmentView(segmentId);
    expect(view.samples).not.toBeNull();

    const row = await holdOver(segmentId, view.samples!);

    expect(row.base.kind).toBe("inline");
  });

  it("is inline when the loaded clip changed on disk before the hold", async () => {
    const { segmentId, clipId } = await pcmSegment(800);
    const view = await loadRecorderSegmentView(segmentId);
    // Another pass over the same clip id since the load: the clip on disk is
    // no longer the one the buffer was read from.
    const db = await getDb();
    const meta = await db.get("clipMeta", clipId);
    await db.put("clipMeta", { ...meta!, generation: meta!.generation + 1 });

    const row = await holdOver(segmentId, view.samples!);

    expect(row.base.kind).toBe("inline");
  });

  it("makes the replay's base-missing refusal reachable from a real hold", async () => {
    const { segmentId, clipId } = await pcmSegment(800);
    const view = await loadRecorderSegmentView(segmentId);
    const row = await holdOver(segmentId, view.samples!);
    expect(row.base.kind).toBe("stored");

    const db = await getDb();
    await db.delete("clipMeta", clipId);

    expect(await loadPendingRecipe(row, CANONICAL_SAMPLE_RATE)).toEqual({
      kind: "base-missing",
    });
  });
});
