import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `raceAudioResume` bounds the one blocking `await resumeAudioContext()` in
 * `start()` (use-recorder.ts, between `getUserMedia` and `new MediaRecorder`,
 * #108). WebKit's `resume()` from `"interrupted"` can hang; an unbounded await
 * there leaves the recorder stuck in `requesting` forever, with the mic already
 * hot. This bounds the WAIT — proceeding once `RESUME_START_TIMEOUT_MS`
 * elapses — without ever letting a resume rejection escape unhandled or go
 * unreported, and without ever calling `raceAudioResume` again.
 *
 * `resumeAudioContext` is called SYNCHRONOUSLY as the first statement (so the
 * user-gesture timing `start()`'s own comments rely on is unchanged); the
 * function itself never rejects (a caller that awaited a rejection here would
 * break the "the mic is live either way" contract `start()` already relies on
 * for its generation check). A late rejection is routed to `reportFailure`
 * instead of being swallowed silently or left as an unhandled rejection on the
 * losing side of the race.
 *
 * The helper resolves a boolean — `true` when its timer won — and writes NO
 * row for that (George R1 P2 on #498): the #475 `"recorder-start-resume-
 * timeout"` row is `start()`'s to write, behind its generation check, so a
 * Record tap cancelled during the wait never lands one. The cases below pin
 * the boolean and the helper's silence under that key; the `start()` half is
 * the textual gate in `tests/recorder-failure-rows.test.ts` (#475).
 *
 * Mirrors `tests/foreground-resume.test.ts`'s `vi.mock("@/hooks/audio-io")`
 * shape (same 5-member mock — `raceAudioResume` calls the already-imported
 * `resumeAudioContext`, so no new binding is added to that surface) and
 * `tests/encoder-deadline.test.ts`'s `vi.useFakeTimers()` /
 * `vi.advanceTimersByTimeAsync` pattern. Bare `setTimeout`/`clearTimeout`
 * (never `window.*`) is what makes this testable at all in this Node-only
 * suite (no jsdom) — the same bare-timer precedent already used in this file
 * at use-recorder.ts:748 and :896.
 */

const { resumeAudioContext } = vi.hoisted(() => ({
  resumeAudioContext: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/hooks/audio-io", () => ({
  resumeAudioContext,
  createLevelTap: vi.fn(),
  decodeToCanonical: vi.fn(),
  isRecordingSupported: () => true,
  pickMimeType: () => undefined,
}));

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

import { RESUME_START_TIMEOUT_MS, raceAudioResume } from "@/hooks/use-recorder";

/** A promise plus externally-callable settlers, for controlling exactly when
 *  the mocked `resumeAudioContext()` resolves or rejects. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resumeAudioContext.mockReset();
  reportFailure.mockReset();
});

describe("raceAudioResume (#108)", () => {
  it("resolves promptly when resume completes immediately", async () => {
    resumeAudioContext.mockResolvedValue(undefined);

    // No advanceTimersByTimeAsync — a healthy resume must not wait for the
    // timer at all, only for its own microtasks to flush. `false`: the timer
    // did not win (George R1 P2 — the boolean is what start() reports on).
    await expect(raceAudioResume()).resolves.toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("calls resumeAudioContext synchronously, before the first await — the iOS user-gesture contract (George R1 P3-2)", async () => {
    resumeAudioContext.mockResolvedValue(undefined);

    // No await before this assertion: `resumeAudioContext()` must already
    // have been called by the time `raceAudioResume()` returns its promise,
    // the same "still inside the user gesture" timing every other
    // `resumeAudioContext()` call site in this file relies on. A rewrite that
    // deferred the real call (e.g. behind a `.then`) would spend the
    // activation and still pass every other case here if the mock already
    // resolves.
    const p = raceAudioResume();
    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
    await p;
  });

  it("THE #108 REGRESSION ITSELF — resolves after the timeout when resume never settles", async () => {
    resumeAudioContext.mockReturnValue(new Promise(() => {}));

    let resolved = false;
    const race = raceAudioResume().then(() => {
      resolved = true;
    });

    // Flush microtasks without advancing the clock: must still be pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);
    await race;
    expect(resolved).toBe(true);
  });

  it("the TIMER win resolves `true` and raceAudioResume itself writes NO recorder-start-resume-timeout row (#475, George R1 P2)", async () => {
    resumeAudioContext.mockReturnValue(new Promise(() => {}));

    const race = raceAudioResume();
    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);

    // The bound firing IS the #108 fact the log exists to carry — but the
    // helper only REPORTS THE FACT to its caller as `true`. The row itself
    // is written by start(), after its generation check, so a start() that
    // cancel() already discarded during the wait (Back or pagehide while
    // "requesting") never lands a durable row for an abandoned Record tap
    // (George R1 P2). The helper has no generation to check, so it must not
    // report: the test pins that the timer branch is silent under the key.
    await expect(race).resolves.toBe(true);
    expect(reportFailure).not.toHaveBeenCalledWith(
      expect.anything(),
      "recorder-start-resume-timeout"
    );
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("does not resolve before the timeout elapses", async () => {
    resumeAudioContext.mockReturnValue(new Promise(() => {}));

    let resolved = false;
    void raceAudioResume().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS - 1);
    expect(resolved).toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a late REJECTION after the timeout reaches reportFailure, unswallowed — and is the ONLY row the helper writes", async () => {
    const gate = deferred<void>();
    resumeAudioContext.mockReturnValue(gate.promise);

    const race = raceAudioResume();
    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);
    // The timer won: `true` to the caller, no row from here (George R1 P2).
    await expect(race).resolves.toBe(true);
    expect(reportFailure).not.toHaveBeenCalled();

    const cause = new Error("resume rejected late");
    gate.reject(cause);
    // Let the rejection's own handler run.
    await Promise.resolve();
    await Promise.resolve();

    // The late rejection is a row under the rejection branch's own key —
    // the one row this helper writes itself. The timeout row is start()'s.
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-start-resume");
    expect(reportFailure).not.toHaveBeenCalledWith(
      expect.anything(),
      "recorder-start-resume-timeout"
    );
  });

  it("an early REJECTION before the timeout still reaches reportFailure, and the function still resolves `false` (not rejects)", async () => {
    const cause = new Error("resume rejected early");
    resumeAudioContext.mockRejectedValue(cause);

    // `false`: the rejection settled the race, not the timer.
    await expect(raceAudioResume()).resolves.toBe(false);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-start-resume");
  });

  it("a late RESOLVE after the timeout adds no row at all — the helper resolves `true` and stays silent", async () => {
    const gate = deferred<void>();
    resumeAudioContext.mockReturnValue(gate.promise);

    const race = raceAudioResume();
    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);
    await expect(race).resolves.toBe(true);

    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    // Nothing went wrong on the late resolve — the context is simply
    // "running" now — and the timer win is start()'s row to write, not this
    // helper's (George R1 P2). No row from either branch.
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("clears the pending timer once resume settles early", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    resumeAudioContext.mockResolvedValue(undefined);

    await raceAudioResume();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

/**
 * The wiring, not just the helper (#108, Frank round 1b P2).
 *
 * Every case above proves `raceAudioResume` behaves once it is CALLED — it
 * says nothing about whether `start()` still calls it. This repo has no
 * renderer, so `start()` (a `useCallback` inside `useRecorder()`) cannot be
 * exercised directly (see `tests/foreground-resume.test.ts`'s own note on
 * why `armForegroundResume` had to be extracted as a plain function to be
 * testable at all). A revert of the one-line call-site change in `start()` —
 * back to a bare `await resumeAudioContext();` — would leave every case
 * above green (this PR's own mutation table, row 7). So the wiring is
 * asserted directly against the source text, the same way
 * `tests/failure-log.test.ts`'s "the wiring, not just the primitive" reads
 * `src/` with `readdirSync`/`readFileSync` rather than trying to render
 * anything.
 *
 * Honesty about what this proves: this is a TEXTUAL gate. It proves the
 * bounded call site is present in the source, not that `start()` behaves
 * correctly at runtime — the runtime behavior is what `raceAudioResume`'s
 * own tests above cover, and what a device pass still owes (see the PR
 * body).
 */
describe("the wiring, not just the helper (#108)", () => {
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
  const source = () => readFileSync(sourceUrl, "utf8");

  /**
   * This file's own doc comments legitimately quote the pre-#108 shape —
   * e.g. "today's bare `await resumeAudioContext()`" — to explain what
   * `raceAudioResume` replaced. A naive text match would treat that
   * documentation as a regression. Comments are stripped before matching so
   * the gate reads CODE, not prose about code. Safe here specifically:
   * grepped for a `//` or `/*` inside any string literal in this file and
   * found none, so a block/line comment strip cannot misfire on a literal.
   */
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("never awaits resumeAudioContext() directly — every use is bounded or fire-and-forget", () => {
    // #108 IS this line: an unbounded `await resumeAudioContext()` between
    // getUserMedia and `new MediaRecorder` is the exact defect. Every
    // remaining call site in this file (armForegroundResume, resume(),
    // retryDecode(), previewCapture()) is fire-and-forget
    // (`void resumeAudioContext().catch(...)`); the one bounded call lives
    // inside raceAudioResume, itself never awaited. Reverting the start()
    // call site back to a bare await must fail this — the former mutation
    // table row 7 (SURVIVED) becomes KILLED by this test.
    const code = stripComments(source());
    expect(code).not.toMatch(/await\s+resumeAudioContext\s*\(/);
  });

  it("start() awaits raceAudioResume exactly once, and raceAudioResume itself calls the real resumeAudioContext unawaited", () => {
    const code = stripComments(source());

    // Exactly one caller bounds its wait on raceAudioResume — start().
    // Deleting that line must fail this.
    const awaitedRaceCalls =
      code.match(/await\s+raceAudioResume\s*\(\s*\)/g) ?? [];
    expect(awaitedRaceCalls).toHaveLength(1);

    // Isolate raceAudioResume's own body (brace-counted from its
    // declaration) so this checks the helper's wiring specifically, not
    // just "somewhere in the file".
    const declStart = code.indexOf("function raceAudioResume");
    expect(declStart).toBeGreaterThan(-1);
    const braceOpen = code.indexOf("{", declStart);
    expect(braceOpen).toBeGreaterThan(-1);
    let depth = 0;
    let braceClose = -1;
    for (let i = braceOpen; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          braceClose = i;
          break;
        }
      }
    }
    expect(braceClose).toBeGreaterThan(braceOpen);
    const body = code.slice(braceOpen, braceClose + 1);

    // The real resumeAudioContext is called inside raceAudioResume, and
    // never awaited there either — the synchronous, in-gesture call the
    // design relies on.
    expect(body).toMatch(/resumeAudioContext\s*\(\s*\)/);
    expect(body).not.toMatch(/await\s+resumeAudioContext\s*\(/);
  });
});
