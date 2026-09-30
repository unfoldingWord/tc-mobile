import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

/**
 * #1251: a shared context that reports `"running"` while its `currentTime`
 * stands still. `playSamples` waits for the clock to move after
 * `source.start`; if it does not within `CLOCK_STALL_TIMEOUT_MS`, the Play
 * fails, one `"playback-clock-stalled"` row is written, and the context is
 * dropped through #1214's path so the next Play builds a fresh one. The
 * level tap watches the same clock and drops the context once it lets go.
 *
 * Node fakes, not WebKit: this proves the wiring and the thresholds, not that
 * a fresh context escapes the state on an iPhone.
 */

type ClockMode = "frozen" | "advancing";

interface FakeSource {
  buffer: unknown;
  onended: (() => void) | null;
  stopCalls: number;
  endOnStart: boolean;
  connect(): void;
  start(): void;
  stop(): void;
}

class FakeContext {
  static made: FakeContext[] = [];
  /** The clock mode of the NEXT context built. */
  static nextClock: ClockMode = "frozen";
  /** When true, the NEXT context's sources fire `onended` inside `start()`. */
  static nextEndsOnStart = false;
  /** When true, the NEXT context's `close()` settles only on `settleClose`. */
  static nextCloseHangs = false;
  /** When true, the NEXT context starts suspended and its `resume()`
   * settles only on `settleResume`. */
  static nextResumeHangs = false;

  readonly id: number;
  state = "running";
  clockMode: ClockMode;
  private clock = 5;
  closeCalls = 0;
  readonly sources: FakeSource[] = [];
  private readonly endsOnStart: boolean;
  private readonly closeHangs: boolean;
  private settlePendingClose: (() => void) | null = null;
  private readonly resumeHangs: boolean;
  private settlePendingResume: (() => void) | null = null;

  constructor() {
    FakeContext.made.push(this);
    this.id = FakeContext.made.length;
    this.clockMode = FakeContext.nextClock;
    this.endsOnStart = FakeContext.nextEndsOnStart;
    this.closeHangs = FakeContext.nextCloseHangs;
    this.resumeHangs = FakeContext.nextResumeHangs;
    if (this.resumeHangs) this.state = "suspended";
  }

  get currentTime(): number {
    if (this.clockMode === "advancing") this.clock += 0.01;
    return this.clock;
  }
  get destination(): unknown {
    return {};
  }
  resume(): Promise<void> {
    if (this.resumeHangs && this.state !== "running") {
      return new Promise<void>((resolve) => {
        this.settlePendingResume = () => {
          if (this.state !== "closed") this.state = "running";
          resolve();
        };
      });
    }
    this.state = "running";
    return Promise.resolve();
  }
  /** Settle a `resume()` that `nextResumeHangs` left pending. */
  settleResume(): void {
    this.settlePendingResume?.();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.state = "closed";
    if (this.closeHangs) {
      return new Promise<void>((resolve) => {
        this.settlePendingClose = resolve;
      });
    }
    return Promise.resolve();
  }
  /** Resolve a `close()` that `nextCloseHangs` left pending. */
  settleClose(): void {
    this.settlePendingClose?.();
  }
  createBuffer(_channels: number, length: number, sampleRate: number): unknown {
    return { duration: length / sampleRate, copyToChannel(): void {} };
  }
  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      onended: null,
      stopCalls: 0,
      endOnStart: this.endsOnStart,
      connect(): void {},
      start(): void {
        if (this.endOnStart) this.onended?.();
      },
      stop(): void {
        this.stopCalls++;
      },
    };
    this.sources.push(source);
    return source;
  }
  createMediaStreamSource(): unknown {
    return { connect(): void {}, disconnect(): void {} };
  }
  createAnalyser(): unknown {
    return {
      fftSize: 1024,
      connect(): void {},
      disconnect(): void {},
      getFloatTimeDomainData(): void {},
    };
  }
  createGain(): unknown {
    return { gain: { value: 1 }, connect(): void {}, disconnect(): void {} };
  }
  /** A decode that settles only when the test calls `decodeGate.resolve`. */
  decodeGate: { resolve: (value: unknown) => void } | null = null;
  decodeAudioData(): Promise<unknown> {
    return new Promise((resolve) => {
      this.decodeGate = { resolve };
    });
  }
}

async function loadAudioIo() {
  vi.resetModules();
  vi.stubGlobal("window", { AudioContext: FakeContext });
  const io = await import("@/hooks/audio-io");
  // The same module instance `audio-io.ts` throws from, after the reset, so
  // `instanceof` compares like with like.
  const { PlaybackClockStalledError } =
    await import("@/hooks/playback-resume-error");
  return { ...io, PlaybackClockStalledError };
}

const samples = new Int16Array([1, 2, 3, 4]);

/** A stream whose clone has no tracks: enough for `createLevelTap`. */
const fakeStream = {
  clone: () => ({ getTracks: () => [] }),
} as unknown as MediaStream;

function rowsFor(key: string): unknown[][] {
  return reportFailure.mock.calls.filter(([, k]) => k === key);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  FakeContext.made = [];
  FakeContext.nextClock = "frozen";
  FakeContext.nextEndsOnStart = false;
  FakeContext.nextCloseHangs = false;
  FakeContext.nextResumeHangs = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  reportFailure.mockReset();
});

describe("playSamples — a running context whose clock never moves (#1251)", () => {
  it("fails the Play, writes one playback-clock-stalled row, stops the source and drops the context", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS, PlaybackClockStalledError } =
      await loadAudioIo();
    const onEnded = vi.fn();

    const outcome = playSamples(samples, {
      isStillCurrent: () => true,
      onEnded,
    }).then(
      () => "resolved" as const,
      (cause: unknown) => cause
    );
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS + 100);
    const result = await outcome;

    expect(result).toBeInstanceOf(PlaybackClockStalledError);
    const ctx = FakeContext.made[0]!;
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.stopCalls).toBe(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(rowsFor("playback-clock-stalled")).toHaveLength(1);
    expect(rowsFor("playback-clock-stalled")[0]![0]).toBe(result);
    expect(ctx.closeCalls).toBe(1);
    // A failed Play is not an ended one: the UI ends it through the catch.
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("the next Play builds a fresh context and plays on it", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();

    const first = playSamples(samples, { isStillCurrent: () => true }).catch(
      () => "failed"
    );
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS + 100);
    expect(await first).toBe("failed");

    FakeContext.nextClock = "advancing";
    const second = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    const handle = await second;

    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.sources).toHaveLength(1);
    expect(handle.duration).toBeGreaterThan(0);
    expect(rowsFor("playback-clock-stalled")).toHaveLength(1);
  });

  it("does not judge before the bound: still pending, no row, no drop", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    let settled = false;
    const outcome = playSamples(samples, { isStillCurrent: () => true }).then(
      () => (settled = true),
      () => (settled = true)
    );

    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS - 100);
    expect(settled).toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
    expect(FakeContext.made[0]!.closeCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(200);
    await outcome;
    expect(settled).toBe(true);
  });

  it("a normally advancing clock resolves at once: no row, no drop, source not stopped", async () => {
    FakeContext.nextClock = "advancing";
    const { playSamples } = await loadAudioIo();

    const outcome = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(0);
    const handle = await outcome;

    const ctx = FakeContext.made[0]!;
    expect(handle.duration).toBeGreaterThan(0);
    expect(ctx.sources[0]!.stopCalls).toBe(0);
    expect(ctx.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a clock that starts moving late, inside the bound, is not a stall", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();

    const outcome = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS / 2);
    FakeContext.made[0]!.clockMode = "advancing";
    await vi.advanceTimersByTimeAsync(100);
    const handle = await outcome;

    expect(handle.duration).toBeGreaterThan(0);
    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a source that has already ended (a short take) is not flagged, even on a frozen clock", async () => {
    FakeContext.nextEndsOnStart = true;
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    const onEnded = vi.fn();

    const outcome = playSamples(samples, {
      isStillCurrent: () => true,
      onEnded,
    });
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS + 100);
    await outcome;

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a source that ends during the wait is not flagged either", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();

    const outcome = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS / 2);
    FakeContext.made[0]!.sources[0]!.onended?.();
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS);
    await outcome;

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a claim superseded during the wait is not judged: no row, no drop", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    let current = true;

    const outcome = playSamples(samples, { isStillCurrent: () => current });
    await vi.advanceTimersByTimeAsync(100);
    current = false;
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS);
    await outcome;

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("a context that leaves running during the wait (an interruption) is not a stall", async () => {
    const { playSamples, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();

    const outcome = playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    FakeContext.made[0]!.state = "interrupted";
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS);
    await outcome;

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("keeps #1214's hold rule: a stall under a live level tap writes its row but closes nothing", async () => {
    const {
      playSamples,
      createLevelTap,
      CLOCK_STALL_TIMEOUT_MS,
      PlaybackClockStalledError,
    } = await loadAudioIo();
    const tap = createLevelTap(fakeStream);

    const outcome = playSamples(samples, { isStillCurrent: () => true }).catch(
      (cause: unknown) => cause
    );
    await vi.advanceTimersByTimeAsync(CLOCK_STALL_TIMEOUT_MS + 100);

    expect(await outcome).toBeInstanceOf(PlaybackClockStalledError);
    expect(rowsFor("playback-clock-stalled")).toHaveLength(1);
    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    tap.close();
  });
});

describe("createLevelTap — a running context whose clock never moves (#1251)", () => {
  it("writes one recorder-tap-clock-stalled row, and drops the context only once the tap lets go", async () => {
    const { createLevelTap, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    const tap = createLevelTap(fakeStream);
    const ctx = FakeContext.made[0]!;

    tap.readFrame();
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS - 1);
    tap.readFrame();
    expect(reportFailure).not.toHaveBeenCalled();

    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS);
    tap.readFrame();
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS * 3);
    tap.readFrame();
    tap.readFrame();

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(rowsFor("recorder-tap-clock-stalled")).toHaveLength(1);
    // The tap still holds the context: nothing is closed under a live meter.
    expect(ctx.closeCalls).toBe(0);

    tap.close();
    expect(ctx.closeCalls).toBe(1);
  });

  it("an advancing clock writes nothing and keeps the context", async () => {
    FakeContext.nextClock = "advancing";
    const { createLevelTap, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    const tap = createLevelTap(fakeStream);

    for (let i = 0; i <= 5; i++) {
      vi.setSystemTime(i * CLOCK_STALL_TIMEOUT_MS);
      tap.readFrame();
    }
    tap.close();

    expect(reportFailure).not.toHaveBeenCalled();
    expect(FakeContext.made[0]!.closeCalls).toBe(0);
  });

  it("a context that is not running is not judged by the tap", async () => {
    const { createLevelTap, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    const tap = createLevelTap(fakeStream);
    FakeContext.made[0]!.state = "suspended";

    for (let i = 0; i <= 5; i++) {
      vi.setSystemTime(i * CLOCK_STALL_TIMEOUT_MS);
      tap.readFrame();
    }
    tap.close();

    expect(reportFailure).not.toHaveBeenCalled();
    expect(FakeContext.made[0]!.closeCalls).toBe(0);
  });

  it("a gap out of running (an interruption) restarts the window: the first running sample after it is not a stall", async () => {
    const { createLevelTap, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    const tap = createLevelTap(fakeStream);
    const ctx = FakeContext.made[0]!;

    // One running sample, then the context leaves running for longer than
    // the bound; the frozen clock during that gap is suspension, not a stall.
    tap.readFrame();
    ctx.state = "interrupted";
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS * 2);
    tap.readFrame();
    ctx.state = "suspended";
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS * 3);
    tap.readFrame();
    ctx.state = "running";
    tap.readFrame();
    expect(reportFailure).not.toHaveBeenCalled();

    // Still running a full bound later on that same currentTime: a real stall.
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS * 4);
    tap.readFrame();
    expect(rowsFor("recorder-tap-clock-stalled")).toHaveLength(1);
    expect(ctx.closeCalls).toBe(0);
    tap.close();
    expect(ctx.closeCalls).toBe(1);
  });

  it("an interruption shorter than a full running bound writes nothing and keeps the context", async () => {
    const { createLevelTap, CLOCK_STALL_TIMEOUT_MS } = await loadAudioIo();
    const tap = createLevelTap(fakeStream);
    const ctx = FakeContext.made[0]!;

    tap.readFrame();
    ctx.state = "interrupted";
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS * 2);
    tap.readFrame();
    ctx.state = "running";
    tap.readFrame();
    ctx.clockMode = "advancing";
    vi.setSystemTime(CLOCK_STALL_TIMEOUT_MS * 2 + 10);
    tap.readFrame();
    tap.close();

    expect(reportFailure).not.toHaveBeenCalled();
    expect(ctx.closeCalls).toBe(0);
  });
});

/**
 * The DRI's reproduction (TestFlight rc.2): a lock-screen resume. The fake
 * plays the state the report implies: a context that played normally, was
 * interrupted, then came back reporting "running" with its clock stopped.
 */
async function interruptedThenFrozen(
  io: Awaited<ReturnType<typeof loadAudioIo>>
): Promise<FakeContext> {
  FakeContext.nextClock = "advancing";
  const first = io.playSamples(samples, { isStillCurrent: () => true });
  await vi.advanceTimersByTimeAsync(0);
  // That Play is over before the interruption, as a finished Play is.
  (await first).stop();
  const ctx = FakeContext.made[0]!;
  ctx.state = "interrupted";
  ctx.clockMode = "frozen";
  ctx.state = "running";
  FakeContext.nextClock = "advancing";
  return ctx;
}

describe("after an interruption, a context back on running with a frozen clock (#1251)", () => {
  it("the next Play detects it, writes one row and drops the context; the Play after that works", async () => {
    const io = await loadAudioIo();
    const ctx = await interruptedThenFrozen(io);

    const failed = io
      .playSamples(samples, { isStillCurrent: () => true })
      .catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);

    expect(await failed).toBeInstanceOf(io.PlaybackClockStalledError);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(rowsFor("playback-clock-stalled")).toHaveLength(1);
    expect(ctx.closeCalls).toBe(1);

    const next = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    await next;
    expect(FakeContext.made).toHaveLength(2);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });
});

describe("checkSharedClockOnReturn — the visible-again check (#1251)", () => {
  it("drops a running context whose clock is frozen and writes one row, so the next Play is fresh and works", async () => {
    const io = await loadAudioIo();
    const ctx = await interruptedThenFrozen(io);

    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;

    expect(ctx.closeCalls).toBe(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(rowsFor("audio-clock-stalled-on-return")).toHaveLength(1);

    const next = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    await next;
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.sources).toHaveLength(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it("an advancing clock is left alone", async () => {
    FakeContext.nextClock = "advancing";
    const io = await loadAudioIo();
    const first = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(0);
    await first;

    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("does nothing with no context yet, and builds none", async () => {
    const io = await loadAudioIo();
    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;

    expect(FakeContext.made).toHaveLength(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("does nothing to a context that is not running", async () => {
    const io = await loadAudioIo();
    const ctx = await interruptedThenFrozen(io);
    ctx.state = "interrupted";

    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;

    expect(ctx.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("writes nothing and drops nothing while a level tap holds the context", async () => {
    const io = await loadAudioIo();
    const ctx = await interruptedThenFrozen(io);
    const tap = io.createLevelTap(fakeStream);

    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;

    expect(ctx.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();
    tap.disconnect();
  });

  it("stands aside while a Play is inside its own clock check: that Play writes the one row", async () => {
    const io = await loadAudioIo();
    const ctx = await interruptedThenFrozen(io);

    const play = io
      .playSamples(samples, { isStillCurrent: () => true })
      .catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(100);
    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;

    expect(await play).toBeInstanceOf(io.PlaybackClockStalledError);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(rowsFor("playback-clock-stalled")).toHaveLength(1);
    expect(ctx.closeCalls).toBe(1);
  });

  it("a Play that starts during the check's wait makes it stand aside, so the context is not closed under that Play", async () => {
    const io = await loadAudioIo();
    const ctx = await interruptedThenFrozen(io);

    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS / 2);
    const play = io
      .playSamples(samples, { isStillCurrent: () => true })
      .catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS * 2);
    await check;

    // The Play, not the check, is what judged the clock.
    expect(await play).toBeInstanceOf(io.PlaybackClockStalledError);
    expect(rowsFor("audio-clock-stalled-on-return")).toHaveLength(0);
    expect(rowsFor("playback-clock-stalled")).toHaveLength(1);
    expect(ctx.closeCalls).toBe(1);
  });
});

/**
 * The reporting tester's trigger (verbatim): "Bingo. I just attached to my
 * headphones, immediately playback died and recording didn't show wave form
 * but worked." A `devicechange` on `navigator.mediaDevices` drops the shared
 * context when nothing uses it, and defers the drop while something does.
 */
async function loadAudioIoWithDevices() {
  const mediaDevices = new EventTarget();
  vi.stubGlobal("navigator", { mediaDevices });
  const io = await loadAudioIo();
  const deviceChange = () =>
    mediaDevices.dispatchEvent(new Event("devicechange"));
  return { io, deviceChange };
}

describe("an audio route change (devicechange, #1251)", () => {
  it("while idle drops the context at once, and the next Play gets a fresh one that plays", async () => {
    FakeContext.nextClock = "advancing";
    const { io, deviceChange } = await loadAudioIoWithDevices();
    await io.resumeAudioContext();
    const first = FakeContext.made[0]!;

    deviceChange();
    expect(first.closeCalls).toBe(1);

    const play = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    await play;
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.sources).toHaveLength(1);
    expect(first.sources).toHaveLength(0);
    // A headset connecting is not a failure.
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("builds no context when there is none yet", async () => {
    const { deviceChange } = await loadAudioIoWithDevices();
    deviceChange();
    expect(FakeContext.made).toHaveLength(0);
  });

  it("during a take (the level tap's hold) does not close the context early; it drops once the tap lets go", async () => {
    FakeContext.nextClock = "advancing";
    const { io, deviceChange } = await loadAudioIoWithDevices();
    const tap = io.createLevelTap(fakeStream);
    const ctx = FakeContext.made[0]!;

    deviceChange();
    expect(ctx.closeCalls).toBe(0);
    expect(tap.readFrame()).not.toBeNull();

    tap.disconnect();
    expect(ctx.closeCalls).toBe(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("during a sounding Play does not close the context under it; it drops when that Play is stopped", async () => {
    FakeContext.nextClock = "advancing";
    const { io, deviceChange } = await loadAudioIoWithDevices();
    const play = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    const handle = await play;
    const ctx = FakeContext.made[0]!;

    deviceChange();
    expect(ctx.closeCalls).toBe(0);

    handle.stop();
    expect(ctx.closeCalls).toBe(1);
  });

  it("during a sounding Play drops the context when that Play ends by itself", async () => {
    FakeContext.nextClock = "advancing";
    const { io, deviceChange } = await loadAudioIoWithDevices();
    const play = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    await play;
    const ctx = FakeContext.made[0]!;

    deviceChange();
    expect(ctx.closeCalls).toBe(0);

    ctx.sources[0]!.onended?.();
    expect(ctx.closeCalls).toBe(1);
  });

  it("a drop refused because an earlier close is still pending lands at the next tap's resumeAudioContext()", async () => {
    FakeContext.nextCloseHangs = true;
    const { io, deviceChange } = await loadAudioIoWithDevices();
    await io.resumeAudioContext();
    const first = FakeContext.made[0]!;
    deviceChange();
    expect(first.closeCalls).toBe(1);

    FakeContext.nextCloseHangs = false;
    await io.resumeAudioContext();
    const second = FakeContext.made[1]!;
    deviceChange();
    // First's close() is still pending, so #1232's bound refuses the drop.
    expect(second.closeCalls).toBe(0);

    first.settleClose();
    await vi.advanceTimersByTimeAsync(0);
    await io.resumeAudioContext();
    expect(second.closeCalls).toBe(1);
    expect(FakeContext.made).toHaveLength(3);
  });

  it("during a Play's pending resume does not close the context; the Play sounds on it and the drop lands when it stops", async () => {
    FakeContext.nextClock = "advancing";
    FakeContext.nextResumeHangs = true;
    const { io, deviceChange } = await loadAudioIoWithDevices();
    const play = io.playSamples(samples, { isStillCurrent: () => true });
    const ctx = FakeContext.made[0]!;

    deviceChange();
    expect(ctx.closeCalls).toBe(0);

    ctx.settleResume();
    await vi.advanceTimersByTimeAsync(100);
    const handle = await play;
    expect(FakeContext.made).toHaveLength(1);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.closeCalls).toBe(0);
    expect(reportFailure).not.toHaveBeenCalled();

    handle.stop();
    expect(ctx.closeCalls).toBe(1);
  });

  it("during a Record's pending resume does not close the context; the level tap opens on it and the drop waits for the tap", async () => {
    FakeContext.nextClock = "advancing";
    FakeContext.nextResumeHangs = true;
    const { io, deviceChange } = await loadAudioIoWithDevices();
    // `start()`'s shape: the race, then the tap in the same continuation.
    const race = io.raceAudioResume("recorder-start-resume");
    const ctx = FakeContext.made[0]!;

    deviceChange();
    expect(ctx.closeCalls).toBe(0);

    ctx.settleResume();
    expect(await race).toBe(false);
    const tap = io.createLevelTap(fakeStream);
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeContext.made).toHaveLength(1);
    expect(ctx.closeCalls).toBe(0);
    expect(tap.readFrame()).not.toBeNull();

    tap.disconnect();
    expect(ctx.closeCalls).toBe(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("the return check stands aside while a resume is still pending", async () => {
    FakeContext.nextResumeHangs = true;
    const io = await loadAudioIo();
    void io.raceAudioResume("recorder-start-resume");
    const ctx = FakeContext.made[0]!;
    // Reporting "running" before its clock has started, resume still pending.
    ctx.state = "running";

    const check = io.checkSharedClockOnReturn();
    await vi.advanceTimersByTimeAsync(io.CLOCK_STALL_TIMEOUT_MS + 100);
    await check;
    expect(rowsFor("audio-clock-stalled-on-return")).toHaveLength(0);
    expect(ctx.closeCalls).toBe(0);
  });

  it("an engine with no mediaDevices still builds and uses the context", async () => {
    FakeContext.nextClock = "advancing";
    vi.stubGlobal("navigator", {});
    const io = await loadAudioIo();
    const play = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    await play;
    expect(FakeContext.made).toHaveLength(1);
  });
});

/**
 * The DRI's reliable trigger: lock the phone, unlock it (twice, TestFlight
 * rc.2). `use-audio-session.ts` calls `dropSharedContextWhenIdle` when the
 * page hides; these cases pin what that call does to the shared context.
 */
describe("dropSharedContextWhenIdle — the drop on hide (#1251)", () => {
  it("while idle drops the context at once, and the first Play after the return builds a fresh one", async () => {
    FakeContext.nextClock = "advancing";
    const io = await loadAudioIo();
    const before = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    (await before).stop();
    const first = FakeContext.made[0]!;

    io.dropSharedContextWhenIdle();
    expect(first.closeCalls).toBe(1);

    // The tap after the return: its in-tap resume builds the replacement.
    await io.resumeAudioContext();
    expect(FakeContext.made).toHaveLength(2);
    const after = io.playSamples(samples, { isStillCurrent: () => true });
    await vi.advanceTimersByTimeAsync(100);
    await after;
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.sources).toHaveLength(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("during a take's level tap defers the drop until the tap releases its hold", async () => {
    FakeContext.nextClock = "advancing";
    const io = await loadAudioIo();
    const tap = io.createLevelTap(fakeStream);
    const ctx = FakeContext.made[0]!;

    io.dropSharedContextWhenIdle();
    expect(ctx.closeCalls).toBe(0);
    // Asking again while it waits changes nothing.
    io.dropSharedContextWhenIdle();
    expect(ctx.closeCalls).toBe(0);

    tap.disconnect();
    expect(ctx.closeCalls).toBe(1);
  });

  it("during a decode defers the drop until the decode releases its hold", async () => {
    const io = await loadAudioIoWithoutDevices();
    const decoding = io
      .decodeToCanonical(new Blob([new Uint8Array([1, 2, 3])]))
      .catch(() => "settled");
    await vi.advanceTimersByTimeAsync(0);
    const ctx = FakeContext.made[0]!;

    io.dropSharedContextWhenIdle();
    expect(ctx.closeCalls).toBe(0);

    ctx.decodeGate!.resolve({});
    await decoding;
    expect(ctx.closeCalls).toBe(1);
  });

  it("does nothing when there is no context", async () => {
    const io = await loadAudioIo();
    io.dropSharedContextWhenIdle();
    expect(FakeContext.made).toHaveLength(0);
  });
});

async function loadAudioIoWithoutDevices() {
  vi.stubGlobal("navigator", {});
  return loadAudioIo();
}
