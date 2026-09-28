import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stripComments } from "./support";

/**
 * `raceAudioResume` bounds the one blocking `await resumeAudioContext()` in
 * `start()` (use-recorder.ts, between `getUserMedia` and `new MediaRecorder`,
 * #108). WebKit's `resume()` from `"interrupted"` can hang; an unbounded await
 * there leaves the recorder stuck in `requesting` forever, with the mic already
 * hot. This bounds the WAIT — proceeding once `RESUME_TIMEOUT_MS`
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
 * MOVED (#469). `raceAudioResume`/`RESUME_TIMEOUT_MS` used to live in
 * `use-recorder.ts` and this file used to mock the whole `@/hooks/audio-io`
 * module (a 5-member stub) to control the `resumeAudioContext` that a
 * SEPARATELY-imported, real `raceAudioResume` called. `playSamples`
 * (`audio-io.ts`) needed the identical bound, and `audio-io.ts` — where
 * `resumeAudioContext` already lives — is the only home that avoids a
 * circular import (`audio-io.ts` already exports things `use-recorder.ts`
 * imports; the reverse would cycle). With `raceAudioResume` now living IN
 * the same module as `resumeAudioContext`, the old whole-module mock would
 * also replace `raceAudioResume` itself — and a `vi.mock(..., async
 * (importOriginal) => ...)` partial override cannot intercept a SAME-MODULE
 * internal call (`raceAudioResume`'s own `resumeAudioContext()` reference is
 * bound to the real module's own scope, not to whatever a mock factory
 * returns to OTHER importers — a real ESM/Vitest limitation, not a style
 * choice). So this file now controls `resumeAudioContext`'s timing the way
 * `tests/audio-context-resume.test.ts` already does for `playSamples`: a
 * fake `window.AudioContext` whose `resume()` awaits an externally-settled
 * gate, loaded fresh per case via `vi.resetModules()` + dynamic `import()`
 * (`audio-io.ts` caches its shared context in module state). Every case
 * below is the same assertion as before the move, unchanged in substance.
 *
 * `tests/encoder-deadline.test.ts`'s `vi.useFakeTimers()` /
 * `vi.advanceTimersByTimeAsync` pattern is unchanged. Bare
 * `setTimeout`/`clearTimeout` (never `window.*`) is what makes this testable
 * with this file's fake timers in Node.
 */

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

/**
 * A fake `AudioContext` whose `resume()` awaits a gate this class exposes
 * settlers for, so a test can choose exactly when — or whether — it ever
 * settles. Mirrors `tests/audio-context-resume.test.ts`'s
 * `HangingAudioContext`, generalized with an immediate-settle convenience
 * (`settleResumeNow()` called before `raceAudioResume()` even runs still
 * resolves promptly, since the gate promise is already settled by the time
 * `resume()` awaits it).
 */
class ControllableAudioContext {
  resumeCalls = 0;
  state: string;
  private readonly gate: Promise<void>;
  private resolveGate!: () => void;
  private rejectGate!: (cause: unknown) => void;

  constructor(state: string) {
    this.state = state;
    this.gate = new Promise<void>((resolve, reject) => {
      this.resolveGate = resolve;
      this.rejectGate = reject;
    });
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    await this.gate;
    this.state = "running";
  }

  settleResumeNow(): void {
    this.resolveGate();
  }

  settleResumeWithRejection(cause: unknown): void {
    this.rejectGate(cause);
  }

  get currentTime(): number {
    return 0;
  }
  get destination(): unknown {
    return {};
  }
  createBuffer(): unknown {
    return { duration: 0, copyToChannel(): void {} };
  }
  createBufferSource(): unknown {
    return { connect(): void {}, start(): void {}, stop(): void {} };
  }
}

/** Fresh module (so the shared context and pending timers are isolated) wired
 *  to this fake context — the same loader shape as
 *  `tests/audio-context-resume.test.ts`. */
async function loadAudioIo(ctx: ControllableAudioContext) {
  vi.resetModules();
  vi.stubGlobal("window", {
    AudioContext: function () {
      return ctx;
    },
  });
  return import("@/hooks/audio-io");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  reportFailure.mockReset();
});

describe("raceAudioResume (#108, moved to audio-io.ts for #469)", () => {
  it("resolves promptly when resume completes immediately", async () => {
    const ctx = new ControllableAudioContext("suspended");
    ctx.settleResumeNow();
    const { raceAudioResume } = await loadAudioIo(ctx);

    // No advanceTimersByTimeAsync — a healthy resume must not wait for the
    // timer at all, only for its own microtasks to flush. `false`: the timer
    // did not win (George R1 P2 — the boolean is what start() reports on).
    await expect(raceAudioResume("recorder-start-resume")).resolves.toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("calls resumeAudioContext synchronously, before the first await — the iOS user-gesture contract (George R1 P3-2)", async () => {
    const ctx = new ControllableAudioContext("suspended");
    ctx.settleResumeNow();
    const { raceAudioResume } = await loadAudioIo(ctx);

    // No await before this assertion: `resumeAudioContext()` must already
    // have been called by the time `raceAudioResume()` returns its promise,
    // the same "still inside the user gesture" timing every other
    // `resumeAudioContext()` call site relies on. A rewrite that deferred
    // the real call (e.g. behind a `.then`) would spend the activation and
    // still pass every other case here if the resume already settled.
    const p = raceAudioResume("recorder-start-resume");
    expect(ctx.resumeCalls).toBe(1);
    await p;
  });

  it("THE #108 REGRESSION ITSELF — resolves after the timeout when resume never settles", async () => {
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume, RESUME_TIMEOUT_MS } = await loadAudioIo(ctx);

    let resolved = false;
    const race = raceAudioResume("recorder-start-resume").then(() => {
      resolved = true;
    });

    // Flush microtasks without advancing the clock: must still be pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await race;
    expect(resolved).toBe(true);
  });

  it("the TIMER win resolves `true` and raceAudioResume itself writes NO recorder-start-resume-timeout row (#475, George R1 P2)", async () => {
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume, RESUME_TIMEOUT_MS } = await loadAudioIo(ctx);

    const race = raceAudioResume("recorder-start-resume");
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);

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
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume, RESUME_TIMEOUT_MS } = await loadAudioIo(ctx);

    let resolved = false;
    void raceAudioResume("recorder-start-resume").then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS - 1);
    expect(resolved).toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a late REJECTION after the timeout reaches reportFailure, unswallowed — and is the ONLY row the helper writes", async () => {
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume, RESUME_TIMEOUT_MS } = await loadAudioIo(ctx);

    const race = raceAudioResume("recorder-start-resume");
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    // The timer won: `true` to the caller, no row from here (George R1 P2).
    await expect(race).resolves.toBe(true);
    expect(reportFailure).not.toHaveBeenCalled();

    const cause = new Error("resume rejected late");
    ctx.settleResumeWithRejection(cause);
    // Several microtask hops between the gate rejecting and
    // raceAudioResume's own rejection handler (ctx.resume()'s `await this
    // .gate`, then resumeAudioContext()'s `await ctx.resume()`, then the
    // `.then(resolve, reject)` in raceAudioResume) — advanceTimersByTimeAsync
    // flushes the microtask queue between fake-timer ticks more reliably
    // than a couple of bare `Promise.resolve()` awaits.
    await vi.advanceTimersByTimeAsync(0);

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
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume } = await loadAudioIo(ctx);
    const cause = new Error("resume rejected early");

    // Reject only AFTER the call, so `ctx.resume()`'s `await this.gate` has
    // already attached its handler to the gate promise — rejecting it
    // beforehand (before anything awaits it) would be an unhandled
    // rejection for the microtask gap between construction and the first
    // await, a harness artifact unrelated to what this case tests.
    const race = raceAudioResume("recorder-start-resume");
    ctx.settleResumeWithRejection(cause);

    // `false`: the rejection settled the race, not the timer.
    await expect(race).resolves.toBe(false);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-start-resume");
  });

  it("a late RESOLVE after the timeout adds no row at all — the helper resolves `true` and stays silent", async () => {
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume, RESUME_TIMEOUT_MS } = await loadAudioIo(ctx);

    const race = raceAudioResume("recorder-start-resume");
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await expect(race).resolves.toBe(true);

    ctx.settleResumeNow();
    await vi.advanceTimersByTimeAsync(0);

    // Nothing went wrong on the late resolve — the context is simply
    // "running" now — and the timer win is start()'s row to write, not this
    // helper's (George R1 P2). No row from either branch.
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("clears the pending timer once resume settles early", async () => {
    const ctx = new ControllableAudioContext("suspended");
    ctx.settleResumeNow();
    const { raceAudioResume } = await loadAudioIo(ctx);

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await raceAudioResume("recorder-start-resume");

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("passes the CALLER'S context key through to the rejection report, not a hardcoded one — the shape #469's playSamples call site relies on", async () => {
    const ctx = new ControllableAudioContext("suspended");
    const { raceAudioResume } = await loadAudioIo(ctx);
    const cause = new Error("resume rejected");

    const race = raceAudioResume("playback-resume");
    ctx.settleResumeWithRejection(cause);
    await race;

    expect(reportFailure).toHaveBeenCalledWith(cause, "playback-resume");
  });
});

/**
 * The wiring, not just the helper (#108, #469).
 *
 * The helper cases exercise `raceAudioResume` with a fake AudioContext, not
 * `useRecorder`'s `start()` callback. These source-text checks pin its bounded
 * call site and the helper's wiring in `audio-io.ts`. They do not execute the
 * hook, microphone capture or real browser resume behavior.
 */
describe("the wiring, not just the helper (#108, #469)", () => {
  const recorderSourceUrl = new URL(
    "../src/hooks/use-recorder.ts",
    import.meta.url
  );
  const audioIoSourceUrl = new URL("../src/hooks/audio-io.ts", import.meta.url);
  const recorderSource = () => readFileSync(recorderSourceUrl, "utf8");
  const audioIoSource = () => readFileSync(audioIoSourceUrl, "utf8");

  it("use-recorder.ts never awaits resumeAudioContext() directly — every use is bounded or fire-and-forget", () => {
    // An unbounded resume await between getUserMedia and MediaRecorder
    // construction can strand capture startup. Direct calls must remain
    // fire-and-forget; the awaited startup path uses raceAudioResume.
    const code = stripComments(recorderSource());
    expect(code).not.toMatch(/await\s+resumeAudioContext\s*\(/);
  });

  it("use-recorder.ts imports raceAudioResume from audio-io.ts rather than redefining it locally (#469)", () => {
    const code = stripComments(recorderSource());
    expect(code).toMatch(
      /import\s*\{[^}]*\braceAudioResume\b[^}]*\}\s*from\s*"\.\/audio-io"/
    );
    expect(code).not.toMatch(/function\s+raceAudioResume\b/);
  });

  it("start() awaits raceAudioResume exactly once, passing its own rejection-context key", () => {
    const code = stripComments(recorderSource());

    // Exactly one caller bounds its wait on raceAudioResume — start().
    // Deleting that line, or dropping its argument, must fail this.
    const awaitedRaceCalls =
      code.match(
        /await\s+raceAudioResume\s*\(\s*"recorder-start-resume"\s*\)/g
      ) ?? [];
    expect(awaitedRaceCalls).toHaveLength(1);
    expect(code.match(/raceAudioResume\s*\(/g) ?? []).toHaveLength(1);
  });

  it("raceAudioResume itself (audio-io.ts) calls the real resumeAudioContext, unawaited", () => {
    const code = stripComments(audioIoSource());

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
