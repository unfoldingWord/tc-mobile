import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contextNeedsResume } from "@/hooks/audio-io";

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

/**
 * `contextNeedsResume` is the one audibility decision extracted from the browser-
 * only audio boundary so it can be tested in Node. The regression it guards: a
 * context in WebKit's `"interrupted"` state (iOS enters it on a call / route
 * change / backgrounding) must be resumed, or every later playback is silent
 * with no error. The pre-fix guard only handled `"suspended"`, so the
 * `"interrupted"` case is the mutation that must fail if the fix is removed.
 */
describe("contextNeedsResume", () => {
  it("resumes a suspended context", () => {
    expect(contextNeedsResume("suspended")).toBe(true);
  });

  it("resumes an interrupted context — iOS's non-standard fourth state", () => {
    expect(contextNeedsResume("interrupted")).toBe(true);
  });

  it("leaves a running context alone", () => {
    expect(contextNeedsResume("running")).toBe(false);
  });

  it("does not resume a closed context — resume() would reject", () => {
    expect(contextNeedsResume("closed")).toBe(false);
  });
});

/**
 * The predicate above proves the DECISION; these prove the WIRING — that
 * `resumeAudioContext` and `playSamples` actually act on it (Frank R1 P2: the
 * predicate test alone would stay green if `resumeAudioContext` were reverted to
 * an inline `=== "suspended"`, or the `playSamples` supersession bail deleted).
 *
 * A minimal fake `AudioContext` stands in for the browser: `audio-io.ts` reads
 * `window.AudioContext` lazily and caches one shared context, so each case
 * resets the module registry and installs a fresh fake whose `resume()` and
 * source construction are observable.
 */
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = 0;
  connect(): void {}
  start(): void {
    this.started++;
  }
  stop(): void {}
}

class FakeAudioContext {
  resumeCalls = 0;
  sourcesCreated: FakeBufferSource[] = [];
  constructor(public state: string) {}
  get currentTime(): number {
    return 0;
  }
  get destination(): unknown {
    return {};
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
  }
  createBuffer(_channels: number, length: number, sampleRate: number): unknown {
    return { duration: length / sampleRate, copyToChannel(): void {} };
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sourcesCreated.push(source);
    return source;
  }
}

/**
 * A `resume()` that hangs until told otherwise, so the #469 bound (and a
 * rejection arriving before/after it) can be raced under `vi.useFakeTimers()`.
 * Top-level (not scoped to one describe block) so both the original
 * regression tests and the single-exit table-driven test below share one
 * definition.
 */
class HangingAudioContext extends FakeAudioContext {
  private readonly gate: Promise<void>;
  private resolveGate: (() => void) | null = null;
  private rejectGate: ((cause: unknown) => void) | null = null;

  constructor(state: string) {
    super(state);
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
    this.resolveGate?.();
  }

  settleResumeWithRejection(cause: unknown): void {
    this.rejectGate?.(cause);
  }
}

/** Fresh module (so the shared context is null) wired to this fake context. */
async function loadAudioIo(ctx: FakeAudioContext) {
  vi.resetModules();
  vi.stubGlobal("window", {
    // `new` on a function returning an object yields that object, so every
    // `getAudioContext()` gets this one observable fake.
    AudioContext: function () {
      return ctx;
    },
  });
  return import("@/hooks/audio-io");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resumeAudioContext — wiring", () => {
  it("resumes an interrupted context (the iOS silent-playback fix)", async () => {
    const ctx = new FakeAudioContext("interrupted");
    const { resumeAudioContext } = await loadAudioIo(ctx);
    await resumeAudioContext();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
  });

  it("resumes a suspended context", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { resumeAudioContext } = await loadAudioIo(ctx);
    await resumeAudioContext();
    expect(ctx.resumeCalls).toBe(1);
  });

  it("does not touch a running context", async () => {
    const ctx = new FakeAudioContext("running");
    const { resumeAudioContext } = await loadAudioIo(ctx);
    await resumeAudioContext();
    expect(ctx.resumeCalls).toBe(0);
  });
});

describe("playSamples — supersession guard (#104)", () => {
  const samples = new Int16Array([1, 2, 3, 4]);

  it("builds and starts no source when superseded during the resume await", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { playSamples } = await loadAudioIo(ctx);
    const handle = await playSamples(samples, { isStillCurrent: () => false });
    // Nothing reached ctx.destination — no source was even created.
    expect(ctx.sourcesCreated).toHaveLength(0);
    expect(handle.duration).toBe(0);
  });

  it("honours a Stop that arrives DURING the buffer fill (George R4 G-1)", async () => {
    // The windowed fill (#175) is synchronous and scales with the clip: about
    // 600 `copyToChannel` calls for ten minutes. A tap on Stop during it cannot
    // run until the fill yields. If nothing between the fill and
    // `source.start()` yields, the Stop is handled only AFTER the source
    // started, and `settle` then kills it: the start-then-stop click #104
    // exists to prevent. A re-check with no yield before it would be dead code,
    // because nothing can change in the same task. So the tap is modelled the
    // way the platform delivers it — a task queued while the fill runs — and
    // the claim is superseded only when that task runs.
    const ctx = new FakeAudioContext("running");
    let superseded = false;
    ctx.createBuffer = (
      _channels: number,
      length: number,
      sampleRate: number
    ) => ({
      duration: length / sampleRate,
      copyToChannel(): void {
        setTimeout(() => {
          superseded = true;
        }, 0);
      },
    });
    const { playSamples } = await loadAudioIo(ctx);

    const handle = await playSamples(samples, {
      isStillCurrent: () => !superseded,
    });

    expect(ctx.sourcesCreated.every((s) => s.started === 0)).toBe(true);
    expect(handle.duration).toBe(0);
  });

  it("builds and starts a source when the claim is still current", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { playSamples } = await loadAudioIo(ctx);
    await playSamples(samples, { isStillCurrent: () => true });
    expect(ctx.sourcesCreated).toHaveLength(1);
    expect(ctx.sourcesCreated[0]!.started).toBe(1);
  });
});

/**
 * `playSamples` shares `raceAudioResume`/`RESUME_TIMEOUT_MS` with `start()`
 * (#108, #498) so its own `resumeAudioContext()` await is bounded too (#469):
 * WebKit's `resume()` from `"interrupted"` has been observed to hang, and an
 * unbounded await here left a play tap stuck "playing" forever with nothing
 * sounding — the same #108 shape, on the playback path, with a wrinkle the
 * recorder side does not have: `playTake`/`playBuffer`
 * (`use-audio-session.ts`) set optimistic UI state BEFORE awaiting this
 * function and clear it only from `onEnded` — which means "the clip RAN
 * OUT" and nothing else — or from a caught rejection, which their `catch`
 * already treats as "playback failed to start". A bare inert-handle return
 * on timeout (mirroring the EXISTING supersession bail) would leave that
 * state stuck, because — unlike a superseded claim — a timed-out claim is
 * still CURRENT, so nothing else will ever release it. The FIRST cut of
 * this fix called `options.onEnded?.()` from the timeout branch to release
 * it — which is wrong, and was Frank round-1's P1: a timed-out resume is a
 * failed START, not a clip that ran to its end, and `recorder.tsx`'s
 * frozen-pan logic keys specifically on `onEnded` to mean "played to the
 * end" (#416) — calling it on a start that never sounded moved the edit pan
 * to the end of a range the translator never heard. The timeout branch
 * THROWS instead, which both call sites' existing `catch` already handles
 * correctly (release the floor, clear the optimistic flag, surface
 * `setPlaybackError`) — and, same as before, it must create no source at
 * all (an audible click or, worse, an interrupted-context SILENT start
 * firing after the caller was already told the claim had failed would be a
 * second dishonesty on top of the first).
 *
 * `HangingAudioContext.resume()` awaits an externally-held gate instead of
 * settling immediately, so the bound can be raced with `vi.useFakeTimers()`
 * exactly the way `tests/recorder-resume-race.test.ts` exercises `start()`'s
 * own bound — the same pattern, applied to the fake-`window.AudioContext`
 * harness this file already uses for `playSamples` (rather than mocking
 * `@/hooks/audio-io` wholesale, which would also replace the
 * `raceAudioResume` under test — see that file's own note on why a partial
 * module mock cannot intercept a same-module internal call).
 */
describe("playSamples — resume bound (#469)", () => {
  const samples = new Int16Array([1, 2, 3, 4]);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    reportFailure.mockReset();
  });

  it("THE #469 REGRESSION ITSELF — an unbounded resume must not hang playSamples forever", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo(ctx);

    let settled = false;
    const handlePromise = playSamples(samples, {
      isStillCurrent: () => true,
    }).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    // Flush microtasks without advancing the clock: must still be pending —
    // this is the exact shape of the pre-fix bug (an unbounded await never
    // settles on its own).
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await handlePromise;

    expect(settled).toBe(true);
    expect(ctx.sourcesCreated).toHaveLength(0);
  });

  it("on timeout, the claim ends by REJECTING — onEnded means 'ran out', not 'never started', so it must NOT fire; no source is ever created (Frank round-1 P1)", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);
    let ended = false;

    const handlePromise = playSamples(samples, {
      isStillCurrent: () => true,
      onEnded: () => {
        ended = true;
      },
    });
    // Observe the outcome without letting an unhandled rejection escape the
    // test before the assertion below gets to it.
    const outcome = handlePromise.then(
      () => ({ rejected: false }),
      () => ({ rejected: true })
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await outcome;

    expect(result.rejected).toBe(true);
    // The regression itself: a failed start is not a completed clip.
    // `recorder.tsx`'s frozen-pan logic reads `onEnded` as "played to the
    // end" (#416) — firing it here would move the edit pan to the end of a
    // range the translator never heard.
    expect(ended).toBe(false);
    expect(ctx.sourcesCreated).toHaveLength(0);
  });

  it("a resume that REJECTS before the bound still fails closed — playSamples rejects, onEnded does not fire, no source is created (George round-2 P1)", async () => {
    // The regression the timer-flag-only gate let through: raceAudioResume
    // resolves `false` ("timer did not win") on EITHER an early rejection
    // OR a settled-but-still-needs-resume state, not only on a timeout. The
    // pre-fix `if (resumeTimedOut)` gate skipped this branch entirely for a
    // rejection that arrives before the 1000ms bound, and `playSamples` fell
    // through to `source.start()` on a context that still needed resume —
    // the iOS silent-playback shape, with the row's optimistic "playing"
    // state never cleared because neither `onEnded` nor a thrown rejection
    // ever fired.
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);
    let ended = false;

    const handlePromise = playSamples(samples, {
      isStillCurrent: () => true,
      onEnded: () => {
        ended = true;
      },
    });
    const outcome = handlePromise.then(
      () => ({ rejected: false }),
      () => ({ rejected: true })
    );

    // Reject the gate WELL BEFORE the 1000ms bound — the timer must not win.
    ctx.settleResumeWithRejection(new Error("resume rejected early"));
    await vi.advanceTimersByTimeAsync(0);

    const result = await outcome;

    expect(result.rejected).toBe(true);
    expect(ended).toBe(false);
    expect(ctx.sourcesCreated).toHaveLength(0);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(Error),
      "playback-resume-unusable"
    );
    // One tap, one row (George round-2 P3): raceAudioResume's own rejection
    // handler used to write "playback-resume" unconditionally, and the gate
    // above wrote a second "playback-resume-unusable" row for the same
    // rejection — two durable rows for one failed Play. playSamples now
    // suppresses the helper's row on this path and lets the gate be the
    // single writer.
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it("resume SUCCEEDS, but the context is interrupted again DURING the post-fill yield — playSamples still fails closed, one row, no source, onEnded does not fire (George round-2 P2)", async () => {
    // The fail-closed gate at the top of playSamples only proves the context
    // was usable BEFORE the (synchronous, clip-length) buffer fill and the
    // `nextTask()` yield that follows it (#175, George R4 G-1). That yield
    // exists so a Stop or a competing Play can land as a task; an OS
    // interruption (call / Siri / route change) lands the same way, and
    // nothing re-read audibility after it — so a source could still start on
    // a context back in `"interrupted"`, the exact silent-playback shape
    // this PR exists to close, reachable through the unchanged yield.
    const ctx = new FakeAudioContext("suspended");
    ctx.createBuffer = (
      _channels: number,
      length: number,
      sampleRate: number
    ) => ({
      duration: length / sampleRate,
      copyToChannel(): void {
        // Modelled the same way the existing "Stop during fill" case models
        // a competing tap: a task queued while the fill runs, delivered once
        // something yields.
        setTimeout(() => {
          ctx.state = "interrupted";
        }, 0);
      },
    });
    const { playSamples } = await loadAudioIo(ctx);
    let ended = false;

    const handlePromise = playSamples(samples, {
      isStillCurrent: () => true,
      onEnded: () => {
        ended = true;
      },
    });
    const outcome = handlePromise.then(
      () => ({ rejected: false }),
      () => ({ rejected: true })
    );
    await vi.runAllTimersAsync();
    const result = await outcome;

    expect(result.rejected).toBe(true);
    expect(ended).toBe(false);
    expect(ctx.sourcesCreated).toHaveLength(0);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(Error),
      "playback-resume-unusable"
    );
  });

  it("reports exactly one row, under its own key, distinct from the recorder's timeout key", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);

    await vi.advanceTimersByTimeAsync(0); // no-op; timer starts inside the call below
    const handlePromise = playSamples(samples, { isStillCurrent: () => true });
    // Attach the rejection assertion BEFORE advancing the timer: `.rejects`
    // registers its handler synchronously, so the promise is never briefly
    // unobserved between the fake-timer tick that rejects it and this line —
    // an unattached rejection there is flagged as an unhandled rejection even
    // though the test goes on to handle it.
    const expectation = expect(handlePromise).rejects.toThrow(
      /did not settle within 1000 ms/
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(Error),
      "playback-resume-timeout"
    );
    expect(reportFailure).not.toHaveBeenCalledWith(
      expect.anything(),
      "recorder-start-resume-timeout"
    );
  });

  it("a claim superseded BEFORE the bound elapses takes the existing supersession branch — no timeout report, no double onEnded", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);
    let superseded = false;
    let ended = false;

    const handlePromise = playSamples(samples, {
      isStillCurrent: () => !superseded,
      onEnded: () => {
        ended = true;
      },
    });
    superseded = true;
    await vi.advanceTimersByTimeAsync(1000);
    const handle = await handlePromise;

    expect(handle.duration).toBe(0);
    expect(ctx.sourcesCreated).toHaveLength(0);
    // The PRE-EXISTING supersession contract (#104): nothing started, so
    // onEnded is deliberately not called — the newer claim owns the UI now.
    expect(ended).toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a resume that settles PROMPTLY is unaffected: no report, source still created and started", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { playSamples } = await loadAudioIo(ctx);
    const handlePromise = playSamples(samples, { isStillCurrent: () => true });
    // Under vi.useFakeTimers(), playSamples' own `nextTask()` yield (a bare
    // `setTimeout(resolve, 0)`, unrelated to the resume bound) needs a timer
    // flush too, or this hangs exactly like the un-flushed cases above.
    await vi.runAllTimersAsync();
    await handlePromise;
    expect(ctx.sourcesCreated).toHaveLength(1);
    expect(ctx.sourcesCreated[0]!.started).toBe(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("an early REJECTION whose OWN resume() call failed is still reported when a CONCURRENT resume elsewhere already left the context usable (Frank round-3 P2)", async () => {
    // playTake/playBuffer fire their own fire-and-forget resumeAudioContext()
    // call (the in-gesture unlock, use-audio-session.ts) BEFORE playSamples
    // runs — a SEPARATE ctx.resume() invocation on the shared context. If
    // THAT one wins first and leaves the context "running", the first cut of
    // this fix (a flat "never report from here" suppression) let this
    // claim's own later rejection vanish with zero rows: audioContextNeedsResume()
    // read false by the time the gate ran, so nothing wrote it down. Modelled
    // here by flipping the context to "running" directly, then rejecting
    // THIS claim's own still-pending resume gate — the state change and the
    // rejection are independent, exactly as two separate resume() calls
    // would be.
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);

    const handlePromise = playSamples(samples, {
      isStillCurrent: () => true,
    });
    const outcome = handlePromise.then(
      () => ({ rejected: false }),
      () => ({ rejected: true })
    );

    const cause = new Error("resume rejected, but the context is running now");
    ctx.state = "running";
    ctx.settleResumeWithRejection(cause);
    await vi.runAllTimersAsync();

    const result = await outcome;

    // Harmless to the LISTENER: the context is usable, so playback proceeds
    // rather than throwing a false fail-closed error for a claim that can
    // actually sound.
    expect(result.rejected).toBe(false);
    expect(ctx.sourcesCreated).toHaveLength(1);
    expect(ctx.sourcesCreated[0]!.started).toBe(1);
    // But NOT harmless to the failure log: the rejection itself is a real
    // fact and must not be silently dropped just because it turned out
    // harmless.
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "playback-resume");
  });

  it("a late REJECTION after the timeout still reaches reportFailure, under the caller's rejection key, and adds no second row", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);

    const handlePromise = playSamples(samples, { isStillCurrent: () => true });
    // Same reason as the test above: attach before advancing.
    const timeoutExpectation = expect(handlePromise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await timeoutExpectation;
    reportFailure.mockClear();

    const cause = new Error("resume rejected late");
    ctx.settleResumeWithRejection(cause);
    // The rejection crosses several microtask hops before reaching
    // raceAudioResume's rejection handler: `HangingAudioContext.resume()`'s
    // own `await this.gate`, then `resumeAudioContext()`'s `await
    // ctx.resume()`, then the `.then(resolve, reject)` handler in
    // `raceAudioResume` itself. `advanceTimersByTimeAsync(0)` flushes the
    // microtask queue between each (fake-timer) tick, which a couple of bare
    // `Promise.resolve()` awaits do not reliably do.
    await vi.advanceTimersByTimeAsync(0);

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "playback-resume");
  });
});

/**
 * Single-exit row accounting (dev lead pick, 2026-09-19 judgment sheet,
 * option A). Every prior round patched ONE exit of `playSamples` at a time —
 * George r2 P3 (an early rejection and the fail-closed gate each wrote a
 * row), Frank r1 (a rejection dropped with ZERO rows when a concurrent
 * `resumeAudioContext()` elsewhere won the race), Frank r2 P2 @
 * `audio-io.ts:678` (the `isStillCurrent()` supersession bail returned
 * before ever looking at a captured rejection) and P2 @ `:694` (the gate
 * always built its OWN synthetic `Error`, discarding a real captured
 * cause) — and each fix left a DIFFERENT exit still wrong, the "siblings"
 * shape named on the parked PR's judgment sheet. This table is the single
 * rule that closes the whole class at once: every reachable exit of
 * `playSamples`, asserting exactly one row (or zero on a clean play) and,
 * when one is written, that it carries the REAL captured cause rather than a
 * synthetic stand-in whenever a real cause exists.
 *
 * Rows 3 and 5 are Frank round-3's two open P2s, reproduced as regression
 * rows: both were RED against `8488de3` (the head Frank reviewed) before
 * this round's `finally`-based single exit — row 3 with zero `reportFailure`
 * calls where one was expected, row 5 with a `reportFailure` call whose
 * reported cause did not match the real captured rejection.
 */
describe("playSamples — single-exit row accounting (dev lead pick, option A, 2026-09-19)", () => {
  const samples = new Int16Array([1, 2, 3, 4]);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    reportFailure.mockReset();
  });

  interface RowOutcome {
    rejected: boolean;
    sourcesCreated: number;
    started: number;
    ended: boolean;
    reportCalls: number;
    reportedCause: unknown;
    reportedKey: string | undefined;
  }

  /**
   * Runs one `playSamples` call to completion under a caller-supplied driver
   * (which settles the resume race and/or flips context state and/or trips
   * supersession, at whatever timing the scenario needs), and reports back
   * everything a row-accounting assertion needs: whether the call rejected,
   * how many sources were built/started, whether `onEnded` fired, and the
   * `reportFailure` call count plus its one call's arguments (if any).
   */
  async function observe<C extends FakeAudioContext>(
    ctx: C,
    isStillCurrent: () => boolean,
    drive: (ctx: C) => Promise<void>
  ): Promise<RowOutcome> {
    const { playSamples } = await loadAudioIo(ctx);
    let ended = false;
    const handlePromise = playSamples(samples, {
      isStillCurrent,
      onEnded: () => {
        ended = true;
      },
    });
    // Observed before the driver runs, so a rejection settled mid-drive is
    // never briefly unhandled between a fake-timer tick and this line.
    const outcome = handlePromise.then(
      () => ({ rejected: false }) as const,
      () => ({ rejected: true }) as const
    );
    await drive(ctx);
    const result = await outcome;
    const call = reportFailure.mock.calls[0] as [unknown, string] | undefined;
    return {
      rejected: result.rejected,
      sourcesCreated: ctx.sourcesCreated.length,
      started: ctx.sourcesCreated.filter((s) => s.started > 0).length,
      ended,
      reportCalls: reportFailure.mock.calls.length,
      reportedCause: call?.[0],
      reportedKey: call?.[1],
    };
  }

  interface Scenario {
    name: string;
    run: () => Promise<{ outcome: RowOutcome; expectedCause?: unknown }>;
    expected: {
      rejected: boolean;
      sourcesCreated: number;
      started: number;
      ended: boolean;
      reportCalls: number;
      reportedKey?: string;
      /** Substring the synthetic message must contain, when no real cause is expected. */
      syntheticMessageContains?: string;
    };
  }

  const scenarios: Scenario[] = [
    {
      name: "clean play: resume resolves promptly, no rejection, still current — zero rows, source starts",
      run: async () => ({
        outcome: await observe(
          new FakeAudioContext("suspended"),
          () => true,
          async () => {
            await vi.runAllTimersAsync();
          }
        ),
      }),
      expected: {
        rejected: false,
        sourcesCreated: 1,
        started: 1,
        ended: false,
        reportCalls: 0,
      },
    },
    {
      name: "superseded before the fill, no rejection — zero rows, inert handle",
      run: async () => ({
        outcome: await observe(
          new FakeAudioContext("suspended"),
          () => false,
          async () => {
            await vi.runAllTimersAsync();
          }
        ),
      }),
      expected: {
        rejected: false,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 0,
      },
    },
    {
      name: "superseded before the fill, WITH an early rejection — exactly one row, the real cause, not dropped (Frank round-3 P2, audio-io.ts:678)",
      run: async () => {
        const ctx = new HangingAudioContext("interrupted");
        const cause = new Error("resume rejected while already superseded");
        const outcome = await observe(
          ctx,
          () => false,
          async (c) => {
            c.settleResumeWithRejection(cause);
            await vi.advanceTimersByTimeAsync(0);
          }
        );
        return { outcome, expectedCause: cause };
      },
      expected: {
        rejected: false,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 1,
        reportedKey: "playback-resume",
      },
    },
    {
      name: "still unusable when the bound elapses, no rejection — exactly one row, a synthetic Error, rejects (timeout)",
      run: async () => ({
        outcome: await observe(
          new HangingAudioContext("interrupted"),
          () => true,
          async () => {
            await vi.advanceTimersByTimeAsync(1000);
          }
        ),
      }),
      expected: {
        rejected: true,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 1,
        reportedKey: "playback-resume-timeout",
        syntheticMessageContains: "did not settle within",
      },
    },
    {
      name: "still unusable, WITH an early rejection — exactly one row, the REAL cause, not a synthetic stand-in (Frank round-3 P2, audio-io.ts:694)",
      run: async () => {
        const ctx = new HangingAudioContext("interrupted");
        const cause = new Error("resume rejected, context still unusable");
        const outcome = await observe(
          ctx,
          () => true,
          async (c) => {
            c.settleResumeWithRejection(cause);
            await vi.advanceTimersByTimeAsync(0);
          }
        );
        return { outcome, expectedCause: cause };
      },
      expected: {
        rejected: true,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 1,
        reportedKey: "playback-resume-unusable",
      },
    },
    {
      name: "context usable now despite an early rejection — a concurrent resume elsewhere won — exactly one row, the real cause, NO throw, source starts (Frank round-1 P2)",
      run: async () => {
        const ctx = new HangingAudioContext("interrupted");
        const cause = new Error(
          "resume rejected, but the context is running now"
        );
        const outcome = await observe(
          ctx,
          () => true,
          async (c) => {
            c.state = "running";
            c.settleResumeWithRejection(cause);
            await vi.runAllTimersAsync();
          }
        );
        return { outcome, expectedCause: cause };
      },
      expected: {
        rejected: false,
        sourcesCreated: 1,
        started: 1,
        ended: false,
        reportCalls: 1,
        reportedKey: "playback-resume",
      },
    },
    {
      name: "interrupted again DURING the post-fill yield, no rejection — exactly one row, a synthetic Error, rejects (George round-2 P2)",
      run: async () => {
        const ctx = new FakeAudioContext("suspended");
        ctx.createBuffer = (
          _channels: number,
          length: number,
          sampleRate: number
        ) => ({
          duration: length / sampleRate,
          copyToChannel(): void {
            setTimeout(() => {
              ctx.state = "interrupted";
            }, 0);
          },
        });
        const outcome = await observe(
          ctx,
          () => true,
          async () => {
            await vi.runAllTimersAsync();
          }
        );
        return { outcome };
      },
      expected: {
        rejected: true,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 1,
        reportedKey: "playback-resume-unusable",
        syntheticMessageContains: "still needs resume",
      },
    },
    {
      name: "superseded AFTER the post-fill yield, no rejection — zero rows, inert handle",
      run: async () => {
        const ctx = new FakeAudioContext("running");
        let superseded = false;
        ctx.createBuffer = (
          _channels: number,
          length: number,
          sampleRate: number
        ) => ({
          duration: length / sampleRate,
          copyToChannel(): void {
            setTimeout(() => {
              superseded = true;
            }, 0);
          },
        });
        const outcome = await observe(
          ctx,
          () => !superseded,
          async () => {
            await vi.runAllTimersAsync();
          }
        );
        return { outcome };
      },
      expected: {
        rejected: false,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 0,
      },
    },
    {
      name: "superseded AFTER the post-fill yield, WITH an early rejection captured before the fill (context was usable then) — exactly one row, the real cause, inert handle",
      run: async () => {
        const ctx = new HangingAudioContext("interrupted");
        const cause = new Error(
          "resume rejected before the fill; superseded during it"
        );
        let superseded = false;
        ctx.createBuffer = (
          _channels: number,
          length: number,
          sampleRate: number
        ) => ({
          duration: length / sampleRate,
          copyToChannel(): void {
            setTimeout(() => {
              superseded = true;
            }, 0);
          },
        });
        const outcome = await observe(
          ctx,
          () => !superseded,
          async (c) => {
            c.state = "running";
            c.settleResumeWithRejection(cause);
            await vi.runAllTimersAsync();
          }
        );
        return { outcome, expectedCause: cause };
      },
      expected: {
        rejected: false,
        sourcesCreated: 0,
        started: 0,
        ended: false,
        reportCalls: 1,
        reportedKey: "playback-resume",
      },
    },
  ];

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const { outcome, expectedCause } = await scenario.run();
      const { expected } = scenario;

      expect(outcome.rejected).toBe(expected.rejected);
      expect(outcome.sourcesCreated).toBe(expected.sourcesCreated);
      expect(outcome.started).toBe(expected.started);
      expect(outcome.ended).toBe(expected.ended);
      expect(outcome.reportCalls).toBe(expected.reportCalls);

      if (expected.reportCalls === 0) {
        expect(outcome.reportedCause).toBeUndefined();
        expect(outcome.reportedKey).toBeUndefined();
        return;
      }

      expect(outcome.reportedKey).toBe(expected.reportedKey);
      if (expectedCause !== undefined) {
        // A real captured rejection was in play — the row must carry THAT
        // exact object, never a freshly-built synthetic stand-in (Frank
        // round-3 P2 @ audio-io.ts:694).
        expect(outcome.reportedCause).toBe(expectedCause);
      } else {
        // No rejection occurred — the only cause there is to report is the
        // synthetic one this call built for the still-unusable context.
        expect(outcome.reportedCause).toBeInstanceOf(Error);
        if (expected.syntheticMessageContains) {
          expect((outcome.reportedCause as Error).message).toContain(
            expected.syntheticMessageContains
          );
        }
      }
    });
  }
});
