import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { stepReporter } from "@/hooks/share-flow";
import {
  HIDDEN,
  type ShareProgress,
  type ShareProgressEvent,
  reduceShareProgress,
} from "@/hooks/share-progress";
import { encodeMp3 } from "@/lib/audio/mp3";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { exportBookZip } from "@/lib/export/book";
import {
  ENCODE_STEPS,
  exportChapterMp3,
  gatherChapterPcm,
  withEncodeSteps,
} from "@/lib/export/chapter";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import type { BookId, ChapterId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * #996: Share Chapter's count covers the MP3 encode, and every count says how
 * many of its finished items contributed no audio (`skipped`).
 *
 * #986 counted segments gathered; the encode that follows is the slow part and
 * reported nothing, so a ring drawn from that count sat full while the phone
 * was still working. `withEncodeSteps` puts the encode on the same count, as a
 * fixed stretch of `ENCODE_STEPS` after the gather, fed by the codec's encode
 * progress — and holds the last step back until the MP3 exists.
 */

type Spec = { n: number; v: number } | null;
type Call = [done: number, total: number, skipped: number | undefined];

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, (_, i) => (value + i) % 1000);

const nameChapter = (n: number): string => `Chapter ${n}.mp3`;

beforeEach(clearAllStores);

async function addRecordedChapter(bookId: BookId, specs: Spec[]) {
  const chapter = await addChapter(bookId);
  for (const spec of specs) {
    const seg = await addSegment(chapter.id);
    if (spec)
      await saveTake(
        seg.id,
        newClipId(),
        samples(spec.n, spec.v),
        CANONICAL_SAMPLE_RATE
      );
  }
  return chapter.id;
}

async function chapterWith(specs: Spec[]): Promise<ChapterId> {
  const book = await createBook("b");
  return addRecordedChapter(book.id, specs);
}

async function bookWith(chapters: Spec[][]): Promise<BookId> {
  const book = await createBook("b");
  for (const specs of chapters) await addRecordedChapter(book.id, specs);
  return book.id;
}

function recorder() {
  const calls: Call[] = [];
  const onStep = (done: number, total: number, skipped?: number): void => {
    calls.push([done, total, skipped]);
  };
  return { calls, onStep };
}

/** Let the gather's IndexedDB reads and the encode's start settle. */
const settle = () => new Promise((r) => setTimeout(r, 20));

/**
 * A codec whose encode the TEST drives: it reports progress and resolves (or
 * rejects) only when told to, so a case can look at the count at every point
 * of the encode, not just before and after it.
 */
function scriptedCodec() {
  let onProgress: ((fraction: number) => void) | undefined;
  let finish!: () => void;
  let fail!: (cause: unknown) => void;
  let started = false;
  const codec: AudioCodec = {
    encodeMp3: (_samples, progress) =>
      new Promise((resolve, reject) => {
        started = true;
        onProgress = progress;
        finish = () => resolve(new Uint8Array([0xff]));
        fail = reject;
      }),
    decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
  };
  return {
    codec,
    started: () => started,
    progress: (fraction: number) => onProgress?.(fraction),
    finish: () => finish(),
    fail: (cause: unknown) => fail(cause),
  };
}

/** The Share Chapter build the hook runs, minus the hook. */
function shareChapter(
  chapterId: ChapterId,
  codec: AudioCodec,
  onStep: (done: number, total: number, skipped?: number) => void,
  shouldContinue: () => boolean = () => true
) {
  return withEncodeSteps(onStep, shouldContinue, (counted, countedStep) =>
    exportChapterMp3(chapterId, counted, shouldContinue, countedStep)
  )(codec);
}

describe("withEncodeSteps — the encode is on Share Chapter's count (#996)", () => {
  it("fixes one total up front: the segments plus the encode stretch", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
    ]);
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    const done = shareChapter(chapterId, s.codec, onStep);
    await settle();
    s.finish();
    await done;
    const total = 2 + ENCODE_STEPS;
    expect(new Set(calls.map(([, t]) => t))).toEqual(new Set([total]));
    expect(calls.slice(0, 3)).toEqual([
      [0, total, 0],
      [1, total, 0],
      [2, total, 0],
    ]);
  });

  it("moves through the encode stretch as the codec reports progress", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
    ]);
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    const done = shareChapter(chapterId, s.codec, onStep);
    await settle();
    expect(s.started()).toBe(true);
    const total = 2 + ENCODE_STEPS;
    s.progress(0.25);
    s.progress(0.5);
    expect(calls.slice(3)).toEqual([
      [2 + Math.floor(0.25 * ENCODE_STEPS), total, 0],
      [2 + Math.floor(0.5 * ENCODE_STEPS), total, 0],
    ]);
    s.finish();
    await done;
  });

  it("cannot read total before the MP3 exists — even when the encoder says 1", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
    ]);
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    const done = shareChapter(chapterId, s.codec, onStep);
    await settle();
    const total = 2 + ENCODE_STEPS;
    s.progress(0.999);
    s.progress(1);
    // The encoder's own last word is not the MP3 in hand.
    expect(Math.max(...calls.map(([d]) => d))).toBe(total - 1);
    s.finish();
    const result = await done;
    expect(result).not.toBeNull();
    expect(calls.at(-1)).toEqual([total, total, 0]);
  });

  it("only moves forward: a repeated or lower fraction reports nothing", async () => {
    const chapterId = await chapterWith([{ n: 100, v: 1 }]);
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    const done = shareChapter(chapterId, s.codec, onStep);
    await settle();
    s.progress(0.5);
    const before = calls.length;
    s.progress(0.5);
    s.progress(0.2);
    s.progress(Number.NaN);
    expect(calls.length).toBe(before);
    s.finish();
    await done;
    for (let i = 1; i < calls.length; i++)
      expect(calls[i]![0]).toBeGreaterThan(calls[i - 1]![0]);
  });

  it("a cancel mid-encode stops the count: no progress step and no final step after it", async () => {
    const chapterId = await chapterWith([{ n: 100, v: 1 }]);
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    let live = true;
    const done = shareChapter(chapterId, s.codec, onStep, () => live);
    await settle();
    s.progress(0.3);
    const seen = calls.length;
    live = false;
    s.progress(0.6);
    s.finish();
    await done;
    expect(calls.length).toBe(seen);
    expect(calls.at(-1)![0]).toBe(1 + Math.floor(0.3 * ENCODE_STEPS));
  });

  it("an encode that rejects (the abort) reaches no final step", async () => {
    const chapterId = await chapterWith([{ n: 100, v: 1 }]);
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    const done = shareChapter(chapterId, s.codec, onStep);
    await settle();
    s.progress(0.4);
    s.fail(new DOMException("cancelled", "AbortError"));
    await expect(done).rejects.toThrow("cancelled");
    const total = 1 + ENCODE_STEPS;
    expect(calls.every(([d]) => d < total)).toBe(true);
  });

  it("reaches total, forward-only, with the real encoder's own progress", async () => {
    const chapterId = await chapterWith([
      { n: 20_000, v: 1 },
      { n: 20_000, v: 7 },
    ]);
    const codec: AudioCodec = {
      encodeMp3: async (pcm, onProgress) => encodeMp3(pcm, { onProgress }),
      decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
    };
    const { calls, onStep } = recorder();
    const result = await shareChapter(chapterId, codec, onStep);
    expect(result?.mp3.length).toBeGreaterThan(0);
    const total = 2 + ENCODE_STEPS;
    // More than the gather's three reports: the encode moved the count.
    expect(calls.filter(([d]) => d > 2).length).toBeGreaterThan(1);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i]![0]).toBeGreaterThan(calls[i - 1]![0]);
    expect(calls.at(-2)![0]).toBeLessThan(total);
    expect(calls.at(-1)).toEqual([total, total, 0]);
  });

  it("carries skipped through: a vanished clip is a hollow step, and the count still completes", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
    ]);
    const real = clips.getClip.bind(clips);
    let call = 0;
    const spy = vi
      .spyOn(clips, "getClip")
      .mockImplementation((id) =>
        ++call === 1 ? Promise.resolve(undefined) : real(id)
      );
    const s = scriptedCodec();
    const { calls, onStep } = recorder();
    const done = shareChapter(chapterId, s.codec, onStep);
    await settle();
    spy.mockRestore();
    s.finish();
    await done;
    const total = 2 + ENCODE_STEPS;
    expect(calls.slice(0, 3)).toEqual([
      [0, total, 0],
      [1, total, 1],
      [2, total, 1],
    ]);
    expect(calls.at(-1)).toEqual([total, total, 1]);
  });
});

describe("skipped — items that finished but contributed no audio (#996)", () => {
  it("gatherChapterPcm counts a vanished clip as skipped", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
      { n: 100, v: 3 },
    ]);
    const real = clips.getClip.bind(clips);
    let call = 0;
    const spy = vi
      .spyOn(clips, "getClip")
      .mockImplementation((id) =>
        ++call === 2 ? Promise.resolve(undefined) : real(id)
      );
    const { calls, onStep } = recorder();
    await gatherChapterPcm(
      chapterId,
      { decodeMp3: () => Promise.reject(new Error("no")) },
      undefined,
      onStep
    );
    spy.mockRestore();
    expect(calls).toEqual([
      [0, 3, 0],
      [1, 3, 0],
      [2, 3, 1],
      [3, 3, 1],
    ]);
  });

  it("exportBookZip counts a chapter with no audio as skipped", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [null],
      [{ n: 100, v: 3 }],
    ]);
    const codec: AudioCodec = {
      encodeMp3: async (pcm) => encodeMp3(pcm),
      decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
    };
    const { calls, onStep } = recorder();
    await exportBookZip(bookId, nameChapter, codec, undefined, onStep);
    expect(calls).toEqual([
      [0, 3, 0],
      [1, 3, 0],
      [2, 3, 1],
      [3, 3, 1],
    ]);
  });
});

const run = (
  events: ShareProgressEvent[],
  from: ShareProgress = HIDDEN
): ShareProgress => events.reduce(reduceShareProgress, from);

const preparing = (): ShareProgress =>
  run([{ type: "begin", work: "prepare", now: 1000 }]);

const step = (
  done: number,
  total: number,
  skipped?: number
): ShareProgressEvent =>
  skipped === undefined
    ? { type: "step", done, total }
    : { type: "step", done, total, skipped };

const stepsOf = (state: ShareProgress) =>
  state.phase === "busy" ? state.steps : undefined;

describe("reduceShareProgress — the skipped count (#996)", () => {
  it("records skipped beside done and total", () => {
    const state = run([step(0, 3, 0), step(1, 3, 1)], preparing());
    expect(stepsOf(state)).toEqual({ done: 1, total: 3, skipped: 1 });
  });

  it("rejects skipped above done", () => {
    const at = reduceShareProgress(preparing(), step(1, 3, 0));
    expect(reduceShareProgress(at, step(2, 3, 3))).toBe(at);
  });

  it("rejects a skipped count that runs backward", () => {
    const at = run([step(1, 3, 1)], preparing());
    expect(reduceShareProgress(at, step(2, 3, 0))).toBe(at);
  });

  it("rejects a malformed skipped", () => {
    const busy = preparing();
    expect(reduceShareProgress(busy, step(1, 3, -1))).toBe(busy);
    expect(reduceShareProgress(busy, step(1, 3, 0.5))).toBe(busy);
  });

  it("a step without skipped keeps the last skipped count", () => {
    const state = run([step(1, 3, 1), step(2, 3)], preparing());
    expect(stepsOf(state)).toEqual({ done: 2, total: 3, skipped: 1 });
  });
});

describe("stepReporter forwards skipped (#996)", () => {
  it("dispatches the skipped count with the step", () => {
    const dispatch = vi.fn();
    stepReporter(() => true, dispatch)(2, 3, 1);
    expect(dispatch.mock.calls).toEqual([
      [{ type: "step", done: 2, total: 3, skipped: 1 }],
    ]);
  });
});

/**
 * The hook wiring. `useChapterShare` cannot run in Node (no hook renderer with
 * effects — AGENTS.md "Testing"), so, like `tests/share-progress-steps.test.ts`,
 * this reads the source. It pins only that Share Chapter runs its build through
 * `withEncodeSteps`; what that does is the behavioral cases above.
 */
describe("Share Chapter builds through withEncodeSteps (#996)", () => {
  it("wraps the chapter export's codec and onStep", () => {
    const s = readFileSync(
      path.resolve(import.meta.dirname, "..", "src/hooks/use-chapter-share.ts"),
      "utf8"
    );
    expect(s).toMatch(
      /withEncoder\(\s*signal,\s*withEncodeSteps\(\s*onStep,\s*isCurrent,\s*async \(codec, onStep\) =>/
    );
  });
});
