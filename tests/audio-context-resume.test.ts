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
 * function and clear it only from `onEnded` or a caught rejection. A bare
 * inert-handle return on timeout (mirroring the EXISTING supersession bail)
 * would leave that state stuck, because — unlike a superseded claim — a
 * timed-out claim is still CURRENT, so nothing else will ever call
 * `onEnded` for it. So the timeout branch must itself invoke
 * `options.onEnded?.()` before returning, and must create no source at all
 * (an audible click or, worse, an interrupted-context SILENT start firing
 * after the caller was already told "ended" would be a second dishonesty on
 * top of the first).
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
    }).then((handle) => {
      settled = true;
      return handle;
    });

    // Flush microtasks without advancing the clock: must still be pending —
    // this is the exact shape of the pre-fix bug (an unbounded await never
    // settles on its own).
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    const handle = await handlePromise;

    expect(settled).toBe(true);
    expect(handle.duration).toBe(0);
    expect(ctx.sourcesCreated).toHaveLength(0);
  });

  it("on timeout, ends the claim HONESTLY: onEnded fires, no source is ever created, the returned handle reports zero duration/elapsed", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);
    let ended = false;

    const handlePromise = playSamples(samples, {
      isStillCurrent: () => true,
      onEnded: () => {
        ended = true;
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const handle = await handlePromise;

    expect(ended).toBe(true);
    expect(handle.duration).toBe(0);
    expect(handle.elapsed()).toBe(0);
    expect(ctx.sourcesCreated).toHaveLength(0);
    // Calling stop() on the inert handle must not throw.
    expect(() => handle.stop()).not.toThrow();
  });

  it("reports exactly one row, under its own key, distinct from the recorder's timeout key", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);

    await vi.advanceTimersByTimeAsync(0); // no-op; timer starts inside the call below
    const handlePromise = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(1000);
    await handlePromise;

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

  it("a late REJECTION after the timeout still reaches reportFailure, under the caller's rejection key, and adds no second row", async () => {
    const ctx = new HangingAudioContext("interrupted");
    const { playSamples } = await loadAudioIo(ctx);

    const handlePromise = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(1000);
    await handlePromise;
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
