import "fake-indexeddb/auto";

import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { shareO4View } from "@/components/share-o4-view";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import { readReporter, stepReporter } from "@/hooks/share-flow";
import {
  HIDDEN,
  reduceShareProgress,
  type ShareProgress,
  type ShareProgressEvent,
} from "@/hooks/share-progress";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import { exportChapterMp3, withEncodeSteps } from "@/lib/export/chapter";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { ChapterId } from "@/types/domain";
import { render } from "./render";
import { clearAllStores, noTrimDecode, ramp, testCodec } from "./support";
import { NO_STAGES_RUN } from "@/lib/audio/loudness";

/**
 * #1078: an all-Finished chapter's clip reads (the joined-MP3 path, #1004)
 * show as their OWN phase, a `read` count beside the step count, never in it.
 * #1068's bench rounds showed why a read cannot be a step: whether a clip's
 * step is true depends on the whole chapter joining, which is not known until
 * every clip is read and `joinMp3` has run. So the read is reported live on
 * its own channel, and the step count still starts only once the join has
 * succeeded or the decode-and-encode fallback has begun.
 */

beforeEach(clearAllStores);

const prepare = (): ShareProgress =>
  reduceShareProgress(HIDDEN, { type: "begin", work: "prepare", now: 0 });

const read = (done: number, total: number): ShareProgressEvent => ({
  type: "read",
  done,
  total,
});

function busy(state: ShareProgress) {
  if (state.phase !== "busy") throw new Error("expected a busy phase");
  return state;
}

describe("reduceShareProgress — the read phase (#1078)", () => {
  it("advances the read count and counts no step", () => {
    let state = prepare();
    for (const done of [0, 1, 2, 3])
      state = reduceShareProgress(state, read(done, 3));
    expect(busy(state).reading).toEqual({ done: 3, total: 3 });
    expect(busy(state).steps).toBeUndefined();
  });

  it("only moves forward within one total, and only on a busy prepare still building", () => {
    const at1 = reduceShareProgress(prepare(), read(1, 3));
    expect(reduceShareProgress(at1, read(1, 3))).toBe(at1);
    expect(reduceShareProgress(at1, read(0, 3))).toBe(at1);
    expect(reduceShareProgress(at1, read(2, 4))).toBe(at1);
    expect(reduceShareProgress(prepare(), read(4, 3))).toEqual(prepare());
    expect(reduceShareProgress(prepare(), read(0, 0))).toEqual(prepare());
    expect(reduceShareProgress(prepare(), read(0.5, 3))).toEqual(prepare());
    expect(reduceShareProgress(HIDDEN, read(1, 3))).toBe(HIDDEN);
    const send = reduceShareProgress(HIDDEN, {
      type: "begin",
      work: "send",
      now: 0,
    });
    expect(reduceShareProgress(send, read(1, 3))).toBe(send);
    const held = reduceShareProgress(prepare(), {
      type: "settle",
      settled: null,
      now: 1,
    });
    expect(reduceShareProgress(held, read(1, 3))).toBe(held);
  });

  it("is over once the step count begins: a later read changes nothing", () => {
    let state = reduceShareProgress(prepare(), read(2, 3));
    state = reduceShareProgress(state, {
      type: "step",
      done: 0,
      total: 103,
      items: 3,
    });
    expect(reduceShareProgress(state, read(3, 3))).toBe(state);
  });

  it("a decode-and-encode fallback after the read never retracts a claimed step", () => {
    // The join read two of three clips, then refused the chapter; the
    // fallback's own count follows. Every step it reports must be accepted
    // and the count must never move backward, because the read claimed none.
    let state = prepare();
    const doneSeen: number[] = [];
    const events: ShareProgressEvent[] = [
      read(0, 3),
      read(1, 3),
      read(2, 3),
      { type: "step", done: 0, total: 103, items: 3 },
      { type: "step", done: 1, total: 103, items: 3 },
      { type: "step", done: 2, total: 103, items: 3 },
      { type: "step", done: 3, total: 103, items: 3 },
      { type: "step", done: 103, total: 103, items: 3 },
    ];
    for (const event of events) {
      const before = state;
      state = reduceShareProgress(state, event);
      expect(state).not.toBe(before);
      const steps = busy(state).steps;
      if (steps !== undefined) doneSeen.push(steps.done);
    }
    expect(doneSeen).toEqual([0, 1, 2, 3, 103]);
  });
});

/** Three Finished segments whose stored MP3s `joinMp3` refuses as a set. */
async function refusedChapter(): Promise<{
  chapterId: ChapterId;
  stored: Int16Array[];
}> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const recorded = [ramp(5_000, 1_000), ramp(5_000, 5_000), ramp(5_000, 9_000)];
  // Stored much longer than recorded: each parses, but `coversRecording`
  // refuses the whole join (the #1068 "joinMp3 refuses" fixture).
  const stored = [
    ramp(50_000, 1_000),
    ramp(50_000, 5_000),
    ramp(50_000, 9_000),
  ];
  for (const [i, pcm] of recorded.entries()) {
    const seg = await addSegment(chapter.id);
    const clipId = newClipId();
    await saveTake(seg.id, clipId, pcm, CANONICAL_SAMPLE_RATE);
    await setSegmentFinished(seg.id, true);
    expect(
      await commitTranscode(
        seg.id,
        clipId,
        encodeMp3(stored[i]!),
        computePeaks(pcm, 4),
        NO_STAGES_RUN
      )
    ).toBe("committed");
  }
  return { chapterId: chapter.id, stored };
}

/** Three Finished segments whose stored MP3s join. */
async function joinableChapter(): Promise<ChapterId> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  for (const base of [1_000, 5_000, 9_000]) {
    const pcm = ramp(5_000, base);
    const seg = await addSegment(chapter.id);
    const clipId = newClipId();
    await saveTake(seg.id, clipId, pcm, CANONICAL_SAMPLE_RATE);
    await setSegmentFinished(seg.id, true);
    expect(
      await commitTranscode(
        seg.id,
        clipId,
        encodeMp3(pcm),
        computePeaks(pcm, 4),
        NO_STAGES_RUN
      )
    ).toBe("committed");
  }
  return chapter.id;
}

describe("Share Chapter, all Finished: the export reports its reads on their own channel (#1078)", () => {
  it("a chapter that joins reports every read before its first step", async () => {
    const chapterId = await joinableChapter();
    const log: string[] = [];
    const result = await withEncodeSteps(
      (done, total) => log.push(`step ${done}/${total}`),
      () => true,
      (codec, onStep) => exportChapterMp3(chapterId, codec, undefined, onStep),
      (done, total) => log.push(`read ${done}/${total}`)
    )(testCodec());
    expect(result?.segments).toBe(3);
    expect(log.slice(0, 5)).toEqual([
      "read 0/3",
      "read 1/3",
      "read 2/3",
      "read 3/3",
      "step 0/103",
    ]);
    expect(log.at(-1)).toBe("step 103/103");
  });

  it("joinMp3 refuses: the reads showed, and the fallback's count still starts at 0 with every step accepted", async () => {
    const { chapterId, stored } = await refusedChapter();
    let state = prepare();
    const dispatched: ShareProgressEvent[] = [];
    const dispatch = (event: ShareProgressEvent): void => {
      dispatched.push(event);
      const before = state;
      state = reduceShareProgress(state, event);
      // Nothing either channel reports is refused by the machine.
      expect(state).not.toBe(before);
    };
    const doneAtDecode: number[] = [];
    let decodeCall = 0;
    const codec = testCodec(async (bytes) => {
      doneAtDecode.push(busy(state).steps?.done ?? -1);
      return noTrimDecode(stored[decodeCall++]!, bytes);
    });
    const result = await withEncodeSteps(
      stepReporter(() => true, dispatch),
      () => true,
      (counted, inner) =>
        exportChapterMp3(chapterId, counted, undefined, inner),
      readReporter(() => true, dispatch)
    )(codec);
    expect(result?.segments).toBe(3);
    expect(codec.decodeMp3).toHaveBeenCalledTimes(3);
    const reads = dispatched.filter((e) => e.type === "read");
    // The exact prefix the refused join reported, not merely "some reads".
    expect(reads).toEqual([read(0, 3), read(1, 3), read(2, 3), read(3, 3)]);
    // Every read came before the first step: the read is its own phase.
    const firstStep = dispatched.findIndex((e) => e.type === "step");
    expect(dispatched.slice(firstStep).some((e) => e.type === "read")).toBe(
      false
    );
    // The fallback's count reads only its own work at each decode.
    expect(doneAtDecode).toEqual([0, 1, 2]);
    expect(busy(state).steps?.done).toBe(busy(state).steps?.total);
  });

  it("a cancelled run reports no read", async () => {
    const chapterId = await joinableChapter();
    const reads: number[] = [];
    // The join's OWN cancel flag is the one armed (`shouldEncode`); the
    // wrapper's `shouldContinue` stays true, so an empty `reads` cannot be the
    // wrapper dropping the callback.
    const result = await withEncodeSteps(
      () => {},
      () => true,
      (codec, onStep) =>
        exportChapterMp3(chapterId, codec, () => false, onStep),
      (done) => reads.push(done)
    )(testCodec());
    expect(result).toBeNull();
    expect(reads).toEqual([]);
  });

  it("readReporter drops a superseded run's read", () => {
    const events: ShareProgressEvent[] = [];
    readReporter(
      () => false,
      (e) => events.push(e)
    )(1, 3);
    readReporter(
      () => true,
      (e) => events.push(e)
    )(2, 3);
    expect(events).toEqual([{ type: "read", done: 2, total: 3 }]);
  });
});

describe("the share circle draws the read apart from the count (#1078)", () => {
  it("draws the read fraction, no count ring and an unvalued meter, before any step", () => {
    const state = reduceShareProgress(prepare(), read(1, 4));
    if (state.phase === "hidden") throw new Error("expected busy");
    const view = shareO4View(state, "chapter");
    expect(view.read).toBe(0.25);
    expect(view.ring).toBeNull();
    expect(view.meter).toEqual({ now: null });
  });

  it("stops drawing the read once the count begins", () => {
    let state = reduceShareProgress(prepare(), read(3, 3));
    state = reduceShareProgress(state, {
      type: "step",
      done: 0,
      total: 103,
      items: 3,
    });
    if (state.phase === "hidden") throw new Error("expected busy");
    const view = shareO4View(state, "chapter");
    expect(view.read).toBeUndefined();
    expect(view.ring).toBe(0);
  });

  it("renders the read as a decorative arc, only while there is one", () => {
    const state = reduceShareProgress(prepare(), read(1, 2));
    if (state.phase === "hidden") throw new Error("expected busy");
    const withRead = render(
      createElement(ShareProgressPanel, {
        role: "status",
        text: "status",
        o4: shareO4View(state, "chapter"),
      })
    );
    const arc = withRead.querySelector(".share-o4-read");
    expect(arc).not.toBeNull();
    expect(arc?.closest("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(withRead.querySelector(".share-o4-fill")).toBeNull();
    const without = render(
      createElement(ShareProgressPanel, {
        role: "status",
        text: "status",
        o4: shareO4View(busy(prepare()), "chapter"),
      })
    );
    expect(without.querySelector(".share-o4-read")).toBeNull();
    expect(without.querySelector(".share-o4-ring")).toBeNull();
  });
});
