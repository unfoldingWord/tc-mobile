import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { stepReporter } from "@/hooks/share-flow";
import {
  HIDDEN,
  MIN_BUSY_MS,
  type ShareProgress,
  type ShareProgressEvent,
  reduceShareProgress,
  shareProgressWakeAt,
} from "@/hooks/share-progress";

/**
 * #986: the busy phase of a PREPARE carries a truthful step count — segments
 * gathered for a chapter, chapters archived for a book — as `{ done, total }`.
 * The count is data the reducer only ever moves FORWARD, never past `total`,
 * and only while the prepare it belongs to is still running. No percent is
 * stored anywhere; a reader derives it from the two numbers.
 */

const run = (
  events: ShareProgressEvent[],
  from: ShareProgress = HIDDEN
): ShareProgress => events.reduce(reduceShareProgress, from);

const preparing = (): ShareProgress =>
  run([{ type: "begin", work: "prepare", now: 1000 }]);

const step = (done: number, total: number): ShareProgressEvent => ({
  type: "step",
  done,
  total,
});

describe("reduceShareProgress — the step event (#986)", () => {
  it("a fresh prepare carries no step count until one is reported", () => {
    const busy = preparing();
    expect(busy.phase).toBe("busy");
    expect(busy.phase === "busy" && busy.steps).toBeUndefined();
  });

  it("records {done,total} on a busy prepare and leaves since/pending untouched", () => {
    const busy = preparing();
    const next = reduceShareProgress(busy, step(0, 3));
    expect(next).toEqual({
      phase: "busy",
      work: "prepare",
      since: 1000,
      pending: null,
      steps: { done: 0, total: 3 },
    });
  });

  it("advances once per reported step, up to total", () => {
    const seen: Array<{ done: number; total: number } | undefined> = [];
    let state = preparing();
    for (const done of [0, 1, 2, 3]) {
      state = reduceShareProgress(state, step(done, 3));
      seen.push(state.phase === "busy" ? state.steps : undefined);
    }
    expect(seen).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("never passes total: a done above total changes nothing", () => {
    const at = reduceShareProgress(preparing(), step(3, 3));
    expect(reduceShareProgress(at, step(4, 3))).toBe(at);
  });

  it("never moves backward: a lower done changes nothing", () => {
    const at = reduceShareProgress(preparing(), step(2, 3));
    expect(reduceShareProgress(at, step(1, 3))).toBe(at);
  });

  it("a run's total is fixed: a step with a different total changes nothing", () => {
    const at = reduceShareProgress(preparing(), step(1, 3));
    expect(reduceShareProgress(at, step(2, 5))).toBe(at);
  });

  it("rejects a malformed count — negative, fractional, or a zero total", () => {
    const busy = preparing();
    expect(reduceShareProgress(busy, step(-1, 3))).toBe(busy);
    expect(reduceShareProgress(busy, step(0.5, 3))).toBe(busy);
    expect(reduceShareProgress(busy, step(0, 0))).toBe(busy);
    expect(reduceShareProgress(busy, step(1, Number.NaN))).toBe(busy);
  });

  it("an identical step returns the SAME object (no render, no reschedule)", () => {
    const at = reduceShareProgress(preparing(), step(1, 3));
    expect(reduceShareProgress(at, step(1, 3))).toBe(at);
  });

  it("is ignored during a send — only a prepare has steps", () => {
    const sending = run([{ type: "begin", work: "send", now: 1000 }]);
    expect(reduceShareProgress(sending, step(1, 3))).toBe(sending);
  });

  it("is ignored from hidden and from an outcome — a stale step cannot resurrect a modal", () => {
    expect(reduceShareProgress(HIDDEN, step(1, 3))).toBe(HIDDEN);
    const outcome = run([
      { type: "begin", work: "prepare", now: 0 },
      { type: "settle", settled: "failed", now: MIN_BUSY_MS },
    ]);
    expect(outcome.phase).toBe("outcome");
    expect(reduceShareProgress(outcome, step(1, 3))).toBe(outcome);
  });

  it("is ignored once the prepare has settled and is only being held — the build is over", () => {
    const held = run([
      { type: "begin", work: "prepare", now: 0 },
      step(1, 3),
      { type: "settle", settled: "failed", now: 10 },
    ]);
    expect(held.phase === "busy" && held.pending).not.toBeNull();
    expect(reduceShareProgress(held, step(2, 3))).toBe(held);
  });

  it("a held settle keeps the last count, and the outcome it releases to carries none", () => {
    const held = run([
      { type: "begin", work: "prepare", now: 0 },
      step(2, 3),
      { type: "settle", settled: "failed", now: 10 },
    ]);
    expect(held.phase === "busy" && held.steps).toEqual({ done: 2, total: 3 });
    const released = reduceShareProgress(held, {
      type: "tick",
      now: MIN_BUSY_MS,
    });
    expect(released).toEqual({
      phase: "outcome",
      settled: "failed",
      since: MIN_BUSY_MS,
      gap: undefined,
    });
    expect("steps" in released).toBe(false);
  });

  it("the prepare -> send hand-over starts the send with no count", () => {
    const readyHeld = run([
      { type: "begin", work: "prepare", now: 0 },
      step(3, 3),
      { type: "settle", settled: null, now: 10 },
    ]);
    const sending = reduceShareProgress(readyHeld, {
      type: "begin",
      work: "send",
      now: 20,
    });
    expect(sending.phase === "busy" && sending.work).toBe("send");
    expect("steps" in sending).toBe(false);
  });

  it("does not change when the hook must wake", () => {
    const busy = preparing();
    const stepped = reduceShareProgress(busy, step(1, 3));
    expect(shareProgressWakeAt(stepped)).toBe(shareProgressWakeAt(busy));
  });
});

/**
 * The hook wiring. `useShareFlow` and the two share hooks cannot run in Node
 * (no hook renderer with effects here — AGENTS.md "Testing"), so, like
 * `tests/share-flow.test.ts`'s own wiring cases, these read the source. They
 * pin only that the count is threaded through; what it does is the behavioral
 * cases above and in `tests/export-steps.test.ts`.
 */
describe("the step count is threaded from prepare() to the exports (#986)", () => {
  const src = (rel: string): string =>
    readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

  it("prepare() hands its build a stepReporter over this run's current() and the modal", () => {
    expect(src("src/hooks/share-flow.ts")).toMatch(
      /await build\(\s*current,\s*controller\.signal,\s*stepReporter\(current, modal\.dispatch\)\s*\)/
    );
  });

  it("Share Chapter forwards the build's onStep into exportChapterMp3", () => {
    const s = src("src/hooks/use-chapter-share.ts");
    expect(s).toMatch(/run\(\(isCurrent, signal, onStep\) =>/);
    expect(s).toMatch(
      /exportChapterMp3\(\s*chapterId,\s*codec,\s*isCurrent,\s*onStep\s*\)/
    );
  });

  it("Share Book forwards the build's onStep into exportBookZip", () => {
    const s = src("src/hooks/use-book-share.ts");
    expect(s).toMatch(/run\(\(isCurrent, signal, onStep\) =>/);
    expect(s).toMatch(
      /exportBookZip\(\s*bookId,\s*nameChapter,\s*codec,\s*isCurrent,\s*onStep\s*\)/
    );
  });
});

describe("stepReporter — the prepare's step callback (#986)", () => {
  it("dispatches each step while the run is current", () => {
    const dispatch = vi.fn();
    const onStep = stepReporter(() => true, dispatch);
    onStep(0, 2);
    onStep(1, 2);
    expect(dispatch.mock.calls).toEqual([[step(0, 2)], [step(1, 2)]]);
  });

  it("drops a step once the run is stale — read at call time, not at creation", () => {
    let live = true;
    const dispatch = vi.fn();
    const onStep = stepReporter(() => live, dispatch);
    onStep(1, 3);
    live = false;
    onStep(2, 3);
    expect(dispatch.mock.calls).toEqual([[step(1, 3)]]);
  });
});
