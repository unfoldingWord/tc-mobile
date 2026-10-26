import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import { mergeTake } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { NO_STAGES_RUN } from "@/lib/audio/loudness";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { getClipMeta, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  loadPendingRecipe,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import {
  saveReplayedTake,
  saveTake,
  setSegmentFinished,
} from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipId, SegmentId, StoredPendingTake } from "@/types/domain";
import { clearAllStores, ramp } from "./support";

/**
 * #163 A-14: a take is stamped with the generation of the audio the recorder
 * LOADED, not with whatever the active clip reads at save time. The sweep is
 * not paused while the recorder is open, so a Finished segment's PCM can be
 * transcoded under it (generation 0 → 1, same clip id, same `audioRevision`);
 * the buffer being saved was cut from the PCM and has had no lossy pass.
 *
 * The transcode-under-the-recorder interleaving is reached here by calling
 * `commitTranscode` between the load (or the hold) and the save; on a phone it
 * is reachable only by timing.
 */

const RATE = CANONICAL_SAMPLE_RATE;

beforeEach(async () => {
  await clearAllStores();
});

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

/**
 * A Finished segment whose PCM take (generation 0, revision 1) is still owed
 * its transcode: the state right after the Finished mark.
 */
const finishedPcmSegment = async () => {
  const segmentId = await freshSegment();
  const clipId = newClipId();
  const pcm = ramp(1152 * 4);
  await saveTake(segmentId, clipId, pcm, RATE);
  await setSegmentFinished(segmentId, true);
  return { segmentId, clipId, pcm };
};

/** The owed transcode landing: the same clip id, now MP3 at generation 1. */
const transcode = async (
  segmentId: SegmentId,
  clipId: ClipId,
  pcm: Int16Array
): Promise<void> => {
  expect(
    await commitTranscode(
      segmentId,
      clipId,
      encodeMp3(pcm),
      computePeaks(pcm, 4),
      NO_STAGES_RUN
    )
  ).toBe("committed");
  expect((await getClipMeta(clipId))?.generation).toBe(1);
};

const activeGeneration = async (segmentId: SegmentId) => {
  const db = await getDb();
  const segment = await db.get("segments", segmentId);
  const take = await db.get("takes", segment!.activeTakeId!);
  return (await db.get("clipMeta", take!.clipId))?.generation;
};

/** An append onto the loaded PCM, read at revision 1 and generation 0. */
const appendOnto = (segmentId: SegmentId, pcm: Int16Array): NewTake => ({
  segmentId,
  ordinal: 1,
  clipId: newClipId(),
  existing: pcm,
  recorded: ramp(400, 7),
  offset: pcm.length,
  finished: false,
  editOnly: false,
  baseRevision: 1,
  baseGeneration: 0,
});

describe("an ordinary save after a transcode under the recorder (A-14 interleaving A)", () => {
  it("(a) stamps the loaded generation, not the transcoded clip's", async () => {
    const { segmentId, clipId, pcm } = await finishedPcmSegment();
    await transcode(segmentId, clipId, pcm);

    const result = await saveTake(segmentId, newClipId(), pcm, RATE, {
      baseGeneration: 0,
    });

    expect(result.outcome).toBe("saved");
    expect(await activeGeneration(segmentId)).toBe(0);
  });

  it("a save that does not know its generation re-reads the replaced clip, as before", async () => {
    const { segmentId, clipId, pcm } = await finishedPcmSegment();
    await transcode(segmentId, clipId, pcm);

    await saveTake(segmentId, newClipId(), pcm, RATE, {
      baseGeneration: null,
    });

    expect(await activeGeneration(segmentId)).toBe(1);
  });
});

describe("a replay after a transcode under the held row (A-14 interleaving B)", () => {
  it("(b) the free arm stamps the row's baseGeneration", async () => {
    const { segmentId, clipId, pcm } = await finishedPcmSegment();
    const take = appendOnto(segmentId, pcm);
    expect(await writePendingTake(take)).toEqual({
      ok: true,
      outcome: "written",
    });
    // The kill, then the relaunch's sweep converts the still-Finished PCM.
    await transcode(segmentId, clipId, pcm);

    const row = await (await getDb()).get("pendingTakes", segmentId);
    const read = await loadPendingRecipe(row!, RATE);
    if (read.kind !== "recipe")
      throw new Error(`recipe expected: ${read.kind}`);
    const result = await saveReplayedTake(
      { ...read.take, baseRevision: 1 },
      mergeTake(read.take.existing, read.take.recorded, read.take.offset),
      RATE
    );

    expect(result.outcome).toBe("saved");
    expect(await activeGeneration(segmentId)).toBe(0);
  });

  it("(c) a row with no baseGeneration, as v14 writes it, replays exactly as today", async () => {
    const { segmentId, clipId, pcm } = await finishedPcmSegment();
    expect((await writePendingTake(appendOnto(segmentId, pcm))).ok).toBe(true);
    const db = await getDb();
    const written = await db.get("pendingTakes", segmentId);
    // The v14 shape: the row as a build without this field writes it.
    const v14: StoredPendingTake = { ...written! };
    delete (v14 as { baseGeneration?: number }).baseGeneration;
    expect(v14).not.toHaveProperty("baseGeneration");
    await db.put("pendingTakes", v14);
    await transcode(segmentId, clipId, pcm);

    const read = await loadPendingRecipe(v14, RATE);
    if (read.kind !== "recipe")
      throw new Error(`recipe expected: ${read.kind}`);
    expect(read.take.baseGeneration).toBeNull();
    const result = await saveReplayedTake(
      { ...read.take, baseRevision: 1 },
      mergeTake(read.take.existing, read.take.recorded, read.take.offset),
      RATE
    );

    expect(result.outcome).toBe("saved");
    // Today's re-read of the clip it replaces.
    expect(await activeGeneration(segmentId)).toBe(1);
  });
});

describe("a replay that keeps its take instead of saving it", () => {
  it("rewrites the inline row with the take's baseGeneration", async () => {
    const { segmentId, pcm } = await finishedPcmSegment();
    const take = appendOnto(segmentId, pcm);
    expect((await writePendingTake(take)).ok).toBe(true);
    const db = await getDb();
    const row = await db.get("pendingTakes", segmentId);
    const read = await loadPendingRecipe(row!, RATE);
    if (read.kind !== "recipe")
      throw new Error(`recipe expected: ${read.kind}`);
    // Removed without a record, so the replay parks it as `unexplained` and
    // writes the slot's recipe back as an inline row.
    await db.delete("pendingTakes", segmentId);

    expect(
      await saveReplayedTake(
        { ...read.take, baseRevision: 1 },
        mergeTake(read.take.existing, read.take.recorded, read.take.offset),
        RATE
      )
    ).toEqual({ outcome: "kept", verdict: "unexplained" });
    const kept = await db.get("pendingTakes", segmentId);
    expect(kept?.base.kind).toBe("inline");
    expect(kept?.baseGeneration).toBe(0);
  });
});

describe("(d) the recorder view carries the generation read with its samples", () => {
  it("is 0 for an empty segment", async () => {
    const segmentId = await freshSegment();
    expect((await loadRecorderSegmentView(segmentId)).generation).toBe(0);
  });

  it("is 0 for a PCM segment never transcoded", async () => {
    const { segmentId } = await finishedPcmSegment();
    expect((await loadRecorderSegmentView(segmentId)).generation).toBe(0);
  });

  it("is the clip's own generation for a PCM segment cut from an MP3", async () => {
    // A Finished segment, transcoded (1), then fixed: the fix is PCM that
    // has had one lossy pass, so its clip carries generation 1.
    const { segmentId, clipId, pcm } = await finishedPcmSegment();
    await transcode(segmentId, clipId, pcm);
    await saveTake(segmentId, newClipId(), pcm, RATE, { baseGeneration: 1 });

    const view = await loadRecorderSegmentView(segmentId);
    expect(view.samples).not.toBeNull();
    expect(view.generation).toBe(1);
  });
});
