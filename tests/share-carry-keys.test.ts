import "fake-indexeddb/auto";

import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bookShareItems,
  chapterShareItems,
  shareO4View,
  type ShareChip,
  type ShareO4View,
} from "@/components/share-o4-view";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import { stepReporter } from "@/hooks/share-flow";
import {
  HIDDEN,
  carryFromPrepare,
  reduceShareProgress,
  type ShareCarry,
  type ShareProgress,
  type ShareProgressEvent,
} from "@/hooks/share-progress";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import { exportBookZip, memoryArchiveSink } from "@/lib/export/book";
import { exportChapterMp3, withEncodeSteps } from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  resolveBookChapters,
} from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { ChapterRow, SegmentRow } from "@/types/view";
import { one, render } from "./render";
import { clearAllStores, noTrimDecode, ramp, testCodec } from "./support";

/**
 * #1044: the export names the items it counted (`keys`), and that list rides
 * from the export's step reports through the progress machine and the carry
 * to the O4 chips. An export leaves some items out BEFORE it fixes its count
 * (a segment with no resolvable audio, a dangling chapter id), so the chips
 * cannot map count positions onto the screen's items by position; these
 * cases run the real export, the real reporter and the real reducer, and read
 * the chips the O4 view draws from the result.
 */

beforeEach(clearAllStores);

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A chip row: `-` stays, `o` waiting, `v` finished, `*` current. */
function row(chips: readonly ShareChip[]): string {
  const mark = { stays: "-", waiting: "o", finished: "v", current: "*" };
  return chips.map((c) => mark[c.state]).join("");
}

/** The chip row's accessible label, as the O4 panel renders it. */
function goOutLabel(view: ShareO4View): string | null {
  const container = render(
    createElement(ShareProgressPanel, {
      role: "status",
      icon: "share-busy",
      text: "status",
      o4: view,
    })
  );
  return one(container, ".share-o4-chips").getAttribute("aria-label");
}

/** A reducer the reporter dispatches into, starting from a busy prepare. */
function machine() {
  let state = reduceShareProgress(HIDDEN, {
    type: "begin",
    work: "prepare",
    now: 0,
  });
  const dispatch = (event: ShareProgressEvent): void => {
    state = reduceShareProgress(state, event);
  };
  return { dispatch, state: () => state };
}

/** A busy send carrying the prepare's snapshot, as `useShareFlow` builds it. */
function sendCarrying(carried: ShareCarry): ShareProgress {
  const send = reduceShareProgress(HIDDEN, {
    type: "begin",
    work: "send",
    now: 0,
  });
  return reduceShareProgress(send, { type: "carry", carried });
}

function segmentRow(ordinal: number, clipId: ClipId): SegmentRow {
  return {
    segmentId: `s${ordinal}` as SegmentId,
    ordinal,
    label: null,
    hasClip: true,
    finished: false,
    clipId,
    peaks: null,
    durationMs: null,
  };
}

function chapterRow(chapterId: ChapterId, number: number): ChapterRow {
  return {
    chapterId,
    number,
    name: null,
    finishedCount: 0,
    totalCount: 1,
    recordedCount: 1,
  };
}

describe("Share Chapter: a segment left out before the count (#1044)", () => {
  it("is grey on the chips, through the prepare and the hand-off", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    // The screen read three segments with playable audio; the middle one's
    // take was gone by the time the gather walked the chapter.
    const clipIds = [newClipId(), newClipId(), newClipId()];
    for (const [i, clipId] of clipIds.entries()) {
      const seg = await addSegment(chapter.id);
      if (i !== 1)
        await saveTake(
          seg.id,
          clipId,
          samples(100, i + 1),
          CANONICAL_SAMPLE_RATE
        );
    }
    const screen = chapterShareItems(
      clipIds.map((clipId, i) => segmentRow(i + 1, clipId))
    );
    const m = machine();
    const onStep = stepReporter(() => true, m.dispatch);

    const result = await withEncodeSteps(
      onStep,
      () => true,
      (codec, inner) => exportChapterMp3(chapter.id, codec, undefined, inner)
    )(testCodec());

    expect(result?.segments).toBe(2);
    const after = m.state();
    expect(after.phase === "busy" && after.steps?.keys).toEqual([
      clipIds[0],
      clipIds[2],
    ]);
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(row(shareO4View(after, "chapter", screen).chips)).toBe("v-v");
    const carried = carryFromPrepare(after);
    expect(carried).toBeDefined();
    const send = sendCarrying(carried!);
    if (send.phase === "hidden") throw new Error("expected a busy send");
    expect(row(shareO4View(send, "chapter", screen).chips)).toBe("v-v");
  });
});

describe("Share Chapter, all Finished (joined, #1004): a segment left out before the count", () => {
  it("carries the keys, so the omitted segment is grey and the label counts 2 of 3", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    // Three segments on screen; the middle one's take was gone by the time the
    // export walked the chapter. The other two are Finished, so the chapter is
    // all MP3 and takes the join path, not the gather.
    const clipIds = [newClipId(), newClipId(), newClipId()];
    for (const [i, clipId] of clipIds.entries()) {
      const seg = await addSegment(chapter.id);
      if (i === 1) continue;
      const pcm = Int16Array.from({ length: 5_000 }, (_, k) => (k % 300) + i);
      await saveTake(seg.id, clipId, pcm, CANONICAL_SAMPLE_RATE);
      await setSegmentFinished(seg.id, true);
      expect(
        await commitTranscode(
          seg.id,
          clipId,
          encodeMp3(pcm),
          computePeaks(pcm, 4)
        )
      ).toBe("committed");
    }
    const screen = chapterShareItems(
      clipIds.map((clipId, i) => segmentRow(i + 1, clipId))
    );
    const m = machine();
    const codec = testCodec();

    const result = await withEncodeSteps(
      stepReporter(() => true, m.dispatch),
      () => true,
      (counted, inner) =>
        exportChapterMp3(chapter.id, counted, undefined, inner)
    )(codec);

    expect(result?.segments).toBe(2);
    // The joined path ran: no encode, no decode.
    expect(codec.encodeMp3).not.toHaveBeenCalled();
    expect(codec.decodeMp3).not.toHaveBeenCalled();
    const after = m.state();
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(after.steps?.keys).toEqual([clipIds[0], clipIds[2]]);
    const prepareView = shareO4View(after, "chapter", screen);
    expect(row(prepareView.chips)).toBe("v-v");
    expect(goOutLabel(prepareView)).toBe("2 of 3 go out");
    const send = sendCarrying(carryFromPrepare(after)!);
    if (send.phase === "hidden") throw new Error("expected a busy send");
    const sendView = shareO4View(send, "chapter", screen);
    expect(row(sendView.chips)).toBe("v-v");
    expect(goOutLabel(sendView)).toBe("2 of 3 go out");
  });
});

/**
 * #1004 residual 2, coordinator follow-up on PR #1068: the join path now
 * reports progress per clip as it reads them (`joinFinishedChapter`), so a
 * chapter whose join attempt gets partway through before a LATER clip turns
 * out not joinable will have already reported some steps before the export
 * falls back to `fillChapterPcm`'s own restart at `(0, n)`. #1049's progress
 * machine fixes a run's `total` and `keys` at its FIRST step and rejects any
 * later step that disagrees (`withStep`, `hooks/share-progress.ts`) — so this
 * must be proven safe through the real counting caller
 * (`withEncodeSteps`/`stepReporter`, as `use-chapter-share-steps.test.ts` and
 * the describe above do), not just argued safe from the source.
 *
 * It is: `withEncodeSteps` fixes `segments` (hence `total`) and `keys` from
 * the join attempt's own first report, and its `report()` only ever forwards
 * a `done` that moves the count forward — the fallback's own `(0, n)` restart
 * is silently absorbed there (dropped for not exceeding `last`) rather than
 * reaching the reducer as a new run with a different `total`. Both `total`
 * and `keys` are therefore identical between the join attempt's reports and
 * the fallback's, because both come from the SAME `plan.present` list
 * (`exportChapterMp3` builds one `plan` and hands it to both the join
 * attempt and the fallback) — nothing here depends on `withEncodeSteps`
 * papering over an actual disagreement.
 */
describe("Share Chapter, all Finished (joined, #1004): a later clip that is not joinable falls back without stalling or losing keys", () => {
  it.each([1, 2])(
    "reaches its total, drops no step, and the fallback's keys equal the join attempt's (clip index %i refused)",
    async (notJoinableIndex) => {
      const book = await createBook("b");
      const chapter = await addChapter(book.id);
      const clipIds = [newClipId(), newClipId(), newClipId()];
      const pcms = [ramp(5_000, 1_000), ramp(5_000, 5_000), ramp(5_000, 9_000)];
      for (const [i, clipId] of clipIds.entries()) {
        const seg = await addSegment(chapter.id);
        await saveTake(seg.id, clipId, pcms[i]!, CANONICAL_SAMPLE_RATE);
        await setSegmentFinished(seg.id, true);
        const encoded = encodeMp3(pcms[i]!);
        // The refused clip's stored bytes are trailing bytes that are not an
        // ID3v1 tag — the same shape `chapter-export.test.ts`'s "falls back
        // to decode and encode" case uses. It is still a perfectly decodable
        // MP3 (`noTrimDecode` below): only the JOIN refuses it, not the
        // decoder, which is what forces the whole-chapter fallback rather
        // than a per-segment skip.
        const bytes =
          i === notJoinableIndex
            ? new Uint8Array([...encoded, 1, 2, 3])
            : encoded;
        expect(
          await commitTranscode(
            seg.id,
            clipId,
            bytes,
            computePeaks(pcms[i]!, 4)
          )
        ).toBe("committed");
      }
      const screen = chapterShareItems(
        clipIds.map((clipId, i) => segmentRow(i + 1, clipId))
      );
      const m = machine();
      // Every event this run actually dispatches, so the assertions below can
      // replay them one at a time and prove none was silently dropped by the
      // reducer — not just check the state the run happened to land in.
      const dispatched: ShareProgressEvent[] = [];
      const dispatch = (event: ShareProgressEvent): void => {
        dispatched.push(event);
        m.dispatch(event);
      };
      let decodeCall = 0;
      // The fallback decodes every segment in `plan.present` order (a
      // sequential `for` loop, one `await` at a time), so the Nth decode
      // call is always segment N's own bytes — no need to match on content.
      const codec = testCodec(async (bytes) =>
        noTrimDecode(pcms[decodeCall++]!, bytes)
      );

      const result = await withEncodeSteps(
        stepReporter(() => true, dispatch),
        () => true,
        (counted, inner) =>
          exportChapterMp3(chapter.id, counted, undefined, inner)
      )(codec);

      expect(result?.segments).toBe(3);
      expect(result?.missing).toBe(0);
      // The fallback ran (a stored MP3 the join refuses still decodes fine),
      // not the join: the whole chapter is decoded and re-encoded once.
      expect(codec.decodeMp3).toHaveBeenCalledTimes(3);
      expect(codec.encodeMp3).toHaveBeenCalledTimes(1);

      // Replay every dispatched `step` event against a fresh reducer: an
      // ACCEPTED step always returns a new object (`withStep`'s `{...state,
      // steps: ...}`), a REJECTED one returns the very same reference back.
      // If the join attempt's partial progress and the fallback's restart
      // ever disagreed on `total` or `keys`, the fallback's steps would come
      // back rejected here and `replay.steps?.done` would stall.
      const stepEvents = dispatched.filter(
        (e): e is Extract<ShareProgressEvent, { type: "step" }> =>
          e.type === "step"
      );
      expect(stepEvents.length).toBeGreaterThan(0);
      let replay: ShareProgress = reduceShareProgress(HIDDEN, {
        type: "begin",
        work: "prepare",
        now: 0,
      });
      for (const event of stepEvents) {
        const before = replay;
        replay = reduceShareProgress(replay, event);
        expect(replay).not.toBe(before);
        expect(replay.phase === "busy" && replay.steps?.done).toBe(event.done);
      }

      const after = m.state();
      if (after.phase !== "busy") throw new Error("expected a busy prepare");
      // The count reached its total — the 3 segments plus the encode
      // stretch — not just some partial value from the abandoned attempt.
      expect(after.steps?.done).toBe(after.steps?.total);
      // The keys the fallback finished with are exactly the keys the join
      // attempt opened with: the SAME `plan.present` list, not a second,
      // possibly-different list `withStep` would have had to reject.
      expect(after.steps?.keys).toEqual(clipIds);
      const prepareView = shareO4View(after, "chapter", screen);
      expect(row(prepareView.chips)).toBe("vvv");
      expect(goOutLabel(prepareView)).toBe("3 of 3 go out");
      const carried = carryFromPrepare(after);
      expect(carried).toBeDefined();
      const send = sendCarrying(carried!);
      if (send.phase === "hidden") throw new Error("expected a busy send");
      const sendView = shareO4View(send, "chapter", screen);
      expect(row(sendView.chips)).toBe("vvv");
      expect(goOutLabel(sendView)).toBe("3 of 3 go out");
    }
  );
});

/**
 * Review bench round 2 on PR #1068 (Frank, chapter.ts:438 as it stood at
 * 39891f53): the per-clip `onStep` used to fire the moment a clip was read,
 * BEFORE the join as a whole was known to succeed. A clip already reported
 * present there can vanish before a later, independent re-read — and once
 * that clip's "present" step has already reached the reducer, a re-read that
 * discovers it missing cannot correct the record: `withStep`'s hollow
 * placement infers a skip's POSITION from the `done`/`skipped` delta between
 * two reports it actually received, not from an explicit index, so a
 * dropped or delayed intermediate report makes it attribute the hollow to
 * the wrong item. This reproduces that exact scenario end to end (through
 * `withEncodeSteps`/`stepReporter`/`reduceShareProgress`, the real counting
 * path) and pins the CORRECT outcome: the hollow lands on the clip that
 * actually vanished, not a neighbour.
 */
describe("Share Chapter, all Finished (joined, #1004 bench round 2): a later clip not joinable AND an earlier clip vanishing before the re-read", () => {
  it("places the hollow on the vanished clip's position, not a neighbouring one", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const clipIds = [newClipId(), newClipId(), newClipId()];
    const pcms = [ramp(5_000, 1_000), ramp(5_000, 5_000), ramp(5_000, 9_000)];
    for (const [i, clipId] of clipIds.entries()) {
      const seg = await addSegment(chapter.id);
      await saveTake(seg.id, clipId, pcms[i]!, CANONICAL_SAMPLE_RATE);
      await setSegmentFinished(seg.id, true);
      const encoded = encodeMp3(pcms[i]!);
      // Clip 1 (the middle one) is refused by the JOIN — not missing, just
      // not byte-joinable — which is what forces the whole-chapter fallback
      // rather than a per-segment skip.
      const bytes = i === 1 ? new Uint8Array([...encoded, 1, 2, 3]) : encoded;
      expect(
        await commitTranscode(seg.id, clipId, bytes, computePeaks(pcms[i]!, 4))
      ).toBe("committed");
    }
    const screen = chapterShareItems(
      clipIds.map((clipId, i) => segmentRow(i + 1, clipId))
    );
    const m = machine();
    const dispatched: ShareProgressEvent[] = [];
    const dispatch = (event: ShareProgressEvent): void => {
      dispatched.push(event);
      m.dispatch(event);
    };
    const real = clips.getClip.bind(clips);
    const readsOf = new Map<string, number>();
    // Clip 0 is present on its FIRST read (whatever pass reads it first) and
    // gone on every read after that — "vanishes before the fallback's
    // re-read" without assuming which pass reads it first.
    const spy = vi.spyOn(clips, "getClip").mockImplementation(async (id) => {
      const n = (readsOf.get(id) ?? 0) + 1;
      readsOf.set(id, n);
      if (id === clipIds[0] && n >= 2) return undefined;
      return real(id);
    });
    let decodeCall = 0;
    const codec = testCodec(async (bytes) =>
      noTrimDecode(pcms[decodeCall++]!, bytes)
    );

    const result = await withEncodeSteps(
      stepReporter(() => true, dispatch),
      () => true,
      (counted, inner) =>
        exportChapterMp3(chapter.id, counted, undefined, inner)
    )(codec).finally(() => spy.mockRestore());

    // Clip 0 vanished before the fallback could decode it; the other two
    // (clip 1's join-unsafe bytes still decode fine, clip 2 is untouched)
    // contributed audio.
    expect(result?.segments).toBe(2);
    expect(result?.missing).toBe(1);

    const stepEvents = dispatched.filter(
      (e): e is Extract<ShareProgressEvent, { type: "step" }> =>
        e.type === "step"
    );
    expect(stepEvents.length).toBeGreaterThan(0);
    let replay: ShareProgress = reduceShareProgress(HIDDEN, {
      type: "begin",
      work: "prepare",
      now: 0,
    });
    for (const event of stepEvents) {
      const before = replay;
      replay = reduceShareProgress(replay, event);
      // Every dispatched step must be ACCEPTED (a fresh object), never
      // rejected (the same reference back) — the failure mode this test
      // pins is a MISPLACED hollow, not just a dropped step, but a dropped
      // step is what would let a stale value stand uncorrected.
      expect(replay).not.toBe(before);
    }

    const after = m.state();
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(after.steps?.done).toBe(after.steps?.total);
    expect(after.steps?.keys).toEqual(clipIds);
    // The hollow is clip 0's position (index 0) — not clip 1's (index 1),
    // which is what the bug produced.
    expect(after.steps?.hollow).toEqual([0]);
    const prepareView = shareO4View(after, "chapter", screen);
    // Clip 0 (vanished, hollow) reads as excluded ("-"); clips 1 and 2
    // (both contributed audio in the end) read as finished ("v").
    expect(row(prepareView.chips)).toBe("-vv");
    expect(goOutLabel(prepareView)).toBe("2 of 3 go out");
    const send = sendCarrying(carryFromPrepare(after)!);
    if (send.phase === "hidden") throw new Error("expected a busy send");
    const sendView = shareO4View(send, "chapter", screen);
    expect(row(sendView.chips)).toBe("-vv");
    expect(goOutLabel(sendView)).toBe("2 of 3 go out");
  });
});

/**
 * Review bench round 2 on PR #1068 (George, chapter.ts:441-443 as it stood at
 * 39891f53): the per-clip read loop could already report `done` reaching the
 * join's own total BEFORE `joinMp3` (the byte-level join across every piece)
 * had even run — every individual clip can parse fine
 * (`parseJoinableMp3`) while `joinMp3` itself still refuses the set (its own,
 * stricter checks: matching format across pieces, and each piece actually
 * covering the length pass 1 reserved for it, `coversRecording`). Once that
 * refusal forced the fallback, `withEncodeSteps`'s forward-only guard
 * (`report()`'s `done > last`) swallowed every one of the fallback's own
 * fresh reports, because `last` already sat at the join's total — so the
 * visible count parked there until the encoder's own fractional progress
 * (which this test's codec never sends) happened to push past it. This pins
 * that the fallback's OWN steps — not just the final "the encode resolved"
 * push — reach the reducer and move the count.
 */
describe("Share Chapter, all Finished (joined, #1004 bench round 2): joinMp3 refuses a chapter every clip individually parsed", () => {
  it("moves the visible count through the fallback's own steps, not just the encode's final push", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const clipIds = [newClipId(), newClipId(), newClipId()];
    // What each segment actually RECORDED (fixes `frameCount`/`recorded`).
    const recorded = [
      ramp(5_000, 1_000),
      ramp(5_000, 5_000),
      ramp(5_000, 9_000),
    ];
    // What was actually STORED as the Finished transcode: a much longer
    // encode than the segment recorded. Every one of these still parses as a
    // perfectly valid mono MPEG-1 stream (`parseJoinableMp3` succeeds for
    // each), but `joinMp3`'s `coversRecording` check refuses a piece whose
    // granule count does not cover its OWN `recorded` length — so the WHOLE
    // join refuses, even though nothing failed a per-clip parse.
    const stored = [
      ramp(50_000, 1_000),
      ramp(50_000, 5_000),
      ramp(50_000, 9_000),
    ];
    for (const [i, clipId] of clipIds.entries()) {
      const seg = await addSegment(chapter.id);
      await saveTake(seg.id, clipId, recorded[i]!, CANONICAL_SAMPLE_RATE);
      await setSegmentFinished(seg.id, true);
      expect(
        await commitTranscode(
          seg.id,
          clipId,
          encodeMp3(stored[i]!),
          computePeaks(recorded[i]!, 4)
        )
      ).toBe("committed");
    }
    const screen = chapterShareItems(
      clipIds.map((clipId, i) => segmentRow(i + 1, clipId))
    );
    const m = machine();
    const dispatched: ShareProgressEvent[] = [];
    const dispatch = (event: ShareProgressEvent): void => {
      dispatched.push(event);
      m.dispatch(event);
    };
    let decodeCall = 0;
    // What the machine's own `done` reads at the moment EACH decode call
    // starts. This is the assertion that actually distinguishes the bug from
    // the fix: if every clip parses fine (as here) the join's own per-clip
    // reads already carry `done` up to the join's raw total before `joinMp3`
    // even runs — so a naive value-sequence check on the FINAL dispatched
    // events looks identical whether the fallback's reports get through or
    // are silently dropped (the same numbers arrive either way, just from a
    // different source). Reading the machine live, from INSIDE the decode
    // call that is the fallback's actual work, is what tells them apart: the
    // count must still read what the fallback ITSELF has gathered so far —
    // not a value the doomed join attempt already claimed.
    const doneAtDecode: number[] = [];
    const codec = testCodec(async (bytes) => {
      const state = m.state();
      doneAtDecode.push(
        state.phase === "busy" ? (state.steps?.done ?? -1) : -1
      );
      return noTrimDecode(stored[decodeCall++]!, bytes);
    });

    const result = await withEncodeSteps(
      stepReporter(() => true, dispatch),
      () => true,
      (counted, inner) =>
        exportChapterMp3(chapter.id, counted, undefined, inner)
    )(codec);

    expect(result?.segments).toBe(3);
    expect(result?.missing).toBe(0);
    // The fallback ran (decode every clip, encode once) — the join itself
    // never got to build a file.
    expect(codec.decodeMp3).toHaveBeenCalledTimes(3);
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);

    // The fallback decodes clip 0, 1, 2 in order (a sequential loop, one
    // `await` at a time): at each one's OWN decode, the visible count must
    // read only what has ACTUALLY been gathered by then (0, 1, 2 — the
    // fallback's own progress), never the join's already-claimed 3. Reading
    // 3 here would mean the ring showed "gather done" before the audio that
    // sentence describes had actually been produced — the parking bug.
    expect(doneAtDecode).toEqual([0, 1, 2]);

    const stepEvents = dispatched.filter(
      (e): e is Extract<ShareProgressEvent, { type: "step" }> =>
        e.type === "step"
    );
    let replay: ShareProgress = reduceShareProgress(HIDDEN, {
      type: "begin",
      work: "prepare",
      now: 0,
    });
    for (const event of stepEvents) {
      const before = replay;
      replay = reduceShareProgress(replay, event);
      expect(replay).not.toBe(before);
    }

    const after = m.state();
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(after.steps?.done).toBe(after.steps?.total);
    expect(after.steps?.keys).toEqual(clipIds);
    const prepareView = shareO4View(after, "chapter", screen);
    expect(row(prepareView.chips)).toBe("vvv");
    expect(goOutLabel(prepareView)).toBe("3 of 3 go out");
  });
});

describe("Share Book: a dangling chapter left out before the count (#1044)", () => {
  it("is grey on the chips, through the prepare and the hand-off", async () => {
    const book = await createBook("b");
    for (let i = 0; i < 3; i++) {
      const chapter = await addChapter(book.id);
      const seg = await addSegment(chapter.id);
      await saveTake(
        seg.id,
        newClipId(),
        samples(100, i + 1),
        CANONICAL_SAMPLE_RATE
      );
    }
    const chapters = (await resolveBookChapters(book.id)).chapters;
    // The screen loaded all three chapters; the second's record went before
    // the export resolved the book.
    const screen = bookShareItems(
      chapters.map((c, i) => chapterRow(c.id, i + 1))
    );
    const db = await getDb();
    await db.delete("chapters", chapters[1]!.id);
    const m = machine();

    const result = await exportBookZip(
      book.id,
      (n) => `Chapter ${n}.mp3`,
      testCodec(),
      memoryArchiveSink(),
      undefined,
      stepReporter(() => true, m.dispatch)
    );

    expect(result?.chapters).toBe(2);
    const after = m.state();
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(after.steps?.keys).toEqual([chapters[0]!.id, chapters[2]!.id]);
    expect(row(shareO4View(after, "book", screen).chips)).toBe("v-v");
    const send = sendCarrying(carryFromPrepare(after)!);
    if (send.phase === "hidden") throw new Error("expected a busy send");
    expect(row(shareO4View(send, "book", screen).chips)).toBe("v-v");
  });
});

describe("reduceShareProgress — the counted items' keys (#1044)", () => {
  const prepare = (): ShareProgress =>
    reduceShareProgress(HIDDEN, { type: "begin", work: "prepare", now: 0 });
  const run = (events: ShareProgressEvent[]): ShareProgress =>
    events.reduce(reduceShareProgress, prepare());
  const keysOf = (s: ShareProgress) =>
    s.phase === "busy" ? s.steps?.keys : undefined;

  it("records the keys the first step names, and keeps them on a step without", () => {
    const s = run([
      { type: "step", done: 0, total: 2, keys: ["a", "b"] },
      { type: "step", done: 1, total: 2 },
    ]);
    expect(keysOf(s)).toEqual(["a", "b"]);
  });

  it("takes a later step that repeats the same keys", () => {
    const s = run([
      { type: "step", done: 0, total: 2, keys: ["a", "b"] },
      { type: "step", done: 1, total: 2, keys: ["a", "b"] },
    ]);
    expect(s.phase === "busy" && s.steps?.done).toBe(1);
  });

  it("rejects a step whose keys change, or arrive after a first step without them", () => {
    const keyed = run([{ type: "step", done: 0, total: 2, keys: ["a", "b"] }]);
    expect(
      reduceShareProgress(keyed, {
        type: "step",
        done: 1,
        total: 2,
        keys: ["a", "c"],
      })
    ).toBe(keyed);
    const bare = run([{ type: "step", done: 0, total: 2 }]);
    expect(
      reduceShareProgress(bare, {
        type: "step",
        done: 1,
        total: 2,
        keys: ["a", "b"],
      })
    ).toBe(bare);
  });

  it("rejects keys that do not name exactly one per item", () => {
    const p = prepare();
    for (const event of [
      { type: "step", done: 0, total: 2, keys: ["a"] },
      { type: "step", done: 0, total: 102, items: 2, keys: ["a", "b", "c"] },
    ] as const)
      expect(reduceShareProgress(p, event)).toBe(p);
    expect(
      keysOf(
        reduceShareProgress(p, {
          type: "step",
          done: 0,
          total: 102,
          items: 2,
          keys: ["a", "b"],
        })
      )
    ).toEqual(["a", "b"]);
  });

  it("carryFromPrepare takes the keys onto the snapshot", () => {
    const s = run([
      { type: "step", done: 0, total: 102, items: 2, keys: ["a", "b"] },
    ]);
    expect(carryFromPrepare(s)).toEqual({
      items: 2,
      hollow: [],
      keys: ["a", "b"],
    });
  });

  it("a carry is rejected when its keys disagree with its items or its hollow", () => {
    const send = reduceShareProgress(HIDDEN, {
      type: "begin",
      work: "send",
      now: 0,
    });
    for (const carried of [
      { items: 3, hollow: [], keys: ["a", "b"] },
      { hollow: [2], keys: ["a", "b"] },
    ])
      expect(reduceShareProgress(send, { type: "carry", carried })).toBe(send);
    const ok = reduceShareProgress(send, {
      type: "carry",
      carried: { items: 2, hollow: [1], keys: ["a", "b"] },
    });
    expect(ok.phase === "busy" && ok.carried?.keys).toEqual(["a", "b"]);
  });
});
