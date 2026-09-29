import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

/**
 * #1213's speculative fix: when `playSamples`' #469 resume bound fails closed,
 * the shared `AudioContext` is dropped and closed, so the NEXT Play builds a
 * fresh one. Nothing is dropped while capture (a live level tap) or a decode
 * still holds the context.
 *
 * A fake constructor builds a new observable context on every `new`, so a
 * test can tell "the same context again" from "a fresh one", and a shared
 * event list records whether the old context was closed before its
 * replacement was created. This is Node, not WebKit: it proves the wiring,
 * not that a fresh context escapes an iOS interruption.
 */

type ResumeMode = "hang" | "prompt";

const events: string[] = [];

class FakeContext {
  static made: FakeContext[] = [];
  /** How the NEXT context built will resume. */
  static nextResume: ResumeMode = "prompt";
  static nextState = "suspended";
  static nextCloseRejects: unknown = undefined;
  /** When true, the NEXT context built returns a `close()` promise that
   * settles only when the test calls `settleClose` (#1232). */
  static nextCloseHangs = false;

  readonly id: number;
  state: string;
  readonly resumeMode: ResumeMode;
  readonly closeRejects: unknown;
  readonly closeHangs: boolean;
  closeCalls = 0;
  private settlePendingClose: (() => void) | null = null;
  sourcesCreated = 0;
  private rejectResume: ((cause: unknown) => void) | null = null;
  decodeGate: {
    resolve: (value: unknown) => void;
    reject: (cause: unknown) => void;
  } | null = null;

  constructor() {
    FakeContext.made.push(this);
    this.id = FakeContext.made.length;
    this.state = FakeContext.nextState;
    this.resumeMode = FakeContext.nextResume;
    this.closeRejects = FakeContext.nextCloseRejects;
    this.closeHangs = FakeContext.nextCloseHangs;
    events.push(`create#${this.id}`);
  }

  get currentTime(): number {
    return 0;
  }
  get destination(): unknown {
    return {};
  }
  resume(): Promise<void> {
    if (this.resumeMode === "prompt") {
      this.state = "running";
      return Promise.resolve();
    }
    return new Promise<void>((_resolve, reject) => {
      this.rejectResume = reject;
    });
  }
  rejectPendingResume(cause: unknown): void {
    this.rejectResume?.(cause);
  }
  close(): Promise<void> {
    this.closeCalls++;
    events.push(`close#${this.id}`);
    this.state = "closed";
    if (this.closeHangs) {
      return new Promise<void>((resolve) => {
        this.settlePendingClose = resolve;
      });
    }
    return this.closeRejects === undefined
      ? Promise.resolve()
      : Promise.reject(this.closeRejects);
  }
  /** Resolve a `close()` that `closeHangs` left pending. */
  settleClose(): void {
    this.settlePendingClose?.();
  }
  createBuffer(_channels: number, length: number, sampleRate: number): unknown {
    return { duration: length / sampleRate, copyToChannel(): void {} };
  }
  createBufferSource(): unknown {
    this.sourcesCreated++;
    return {
      buffer: null,
      onended: null,
      connect(): void {},
      start(): void {},
      stop(): void {},
    };
  }
  createMediaStreamSource(): unknown {
    return { connect(): void {}, disconnect(): void {} };
  }
  createAnalyser(): unknown {
    return {
      fftSize: 0,
      connect(): void {},
      disconnect(): void {},
      getFloatTimeDomainData(): void {},
    };
  }
  createGain(): unknown {
    return { gain: { value: 1 }, connect(): void {}, disconnect(): void {} };
  }
  decodeAudioData(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.decodeGate = { resolve, reject };
    });
  }
}

async function loadAudioIo() {
  vi.resetModules();
  vi.stubGlobal("window", { AudioContext: FakeContext });
  return import("@/hooks/audio-io");
}

const samples = new Int16Array([1, 2, 3, 4]);

/** A stream whose clone has no tracks: enough for `createLevelTap`. */
const fakeStream = {
  clone: () => ({ getTracks: () => [] }),
} as unknown as MediaStream;

/** Run one Play that times out on a hanging context, and settle it. */
async function timedOutPlay(
  playSamples: Awaited<ReturnType<typeof loadAudioIo>>["playSamples"],
  timeoutMs: number
): Promise<void> {
  const outcome = playSamples(samples, { isStillCurrent: () => true }).then(
    () => "resolved",
    () => "rejected"
  );
  await vi.advanceTimersByTimeAsync(timeoutMs);
  expect(await outcome).toBe("rejected");
}

/** Run one Play on a context that resumes promptly, and settle it. */
async function cleanPlay(
  playSamples: Awaited<ReturnType<typeof loadAudioIo>>["playSamples"]
): Promise<void> {
  const outcome = playSamples(samples, { isStillCurrent: () => true });
  await vi.runAllTimersAsync();
  await outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeContext.made = [];
  FakeContext.nextResume = "hang";
  FakeContext.nextState = "interrupted";
  FakeContext.nextCloseRejects = undefined;
  FakeContext.nextCloseHangs = false;
  events.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  reportFailure.mockReset();
});

describe("playSamples — dropping the shared context after a failed resume (#1213, speculative)", () => {
  it("after a resume timeout, the old context is closed and the next Play builds a fresh one", async () => {
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();

    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    const first = FakeContext.made[0]!;
    expect(first.closeCalls).toBe(1);

    FakeContext.nextResume = "prompt";
    FakeContext.nextState = "suspended";
    await cleanPlay(playSamples);

    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.sourcesCreated).toBe(1);
    expect(first.sourcesCreated).toBe(0);
    // Closed before its replacement was created (the iOS creation cap).
    expect(events).toEqual(["create#1", "close#1", "create#2"]);
    // The timeout's own #469 row, and nothing for the close.
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(Error),
      "playback-resume-timeout"
    );
  });

  it("a pending resume() that the drop's own close() rejects writes no second resume row", async () => {
    // George round 1 #1 on #1214: the timeout row is the Play's one row. A
    // late rejection caused by closing the context this module dropped is
    // the drop's own echo, not a second failure.
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();
    const close = FakeContext.prototype.close;
    const spy = vi
      .spyOn(FakeContext.prototype, "close")
      .mockImplementation(function (this: FakeContext) {
        this.rejectPendingResume(new Error("closed while resuming"));
        return close.call(this);
      });

    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeContext.made[0]!.closeCalls).toBe(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(Error),
      "playback-resume-timeout"
    );
    spy.mockRestore();
  });

  it("a late resume() rejection on a context that was NOT dropped is still reported", async () => {
    // The suppression above is narrow: a Play superseded during the wait
    // drops nothing, so its late rejection is a real one and keeps its row.
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();
    const outcome = playSamples(samples, { isStillCurrent: () => false });
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await outcome;
    const late = new Error("late rejection");
    FakeContext.made[0]!.rejectPendingResume(late);
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
    expect(reportFailure).toHaveBeenCalledWith(late, "playback-resume");
  });

  it("the unusable gate (an early rejection) also drops the context", async () => {
    const { playSamples } = await loadAudioIo();
    const outcome = playSamples(samples, { isStillCurrent: () => true }).then(
      () => "resolved",
      () => "rejected"
    );
    FakeContext.made[0]!.rejectPendingResume(new Error("resume rejected"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBe("rejected");

    expect(FakeContext.made[0]!.closeCalls).toBe(1);
  });

  it("a clean Play keeps the context", async () => {
    FakeContext.nextResume = "prompt";
    FakeContext.nextState = "suspended";
    const { playSamples } = await loadAudioIo();

    await cleanPlay(playSamples);
    await cleanPlay(playSamples);

    expect(FakeContext.made).toHaveLength(1);
    expect(FakeContext.made[0]!.closeCalls).toBe(0);
  });

  it("a Play superseded during the resume wait keeps the context", async () => {
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();
    const outcome = playSamples(samples, { isStillCurrent: () => false });
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await outcome;

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
  });

  it("nothing is dropped while a level tap (capture) holds the context; once it is closed, the next failure drops it", async () => {
    const { playSamples, createLevelTap, RESUME_TIMEOUT_MS } =
      await loadAudioIo();
    const tap = createLevelTap(fakeStream);

    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    expect(FakeContext.made).toHaveLength(1);
    expect(FakeContext.made[0]!.closeCalls).toBe(0);

    tap.close();
    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    expect(FakeContext.made[0]!.closeCalls).toBe(1);
  });

  it("disconnecting a tap twice releases its hold once, so another live tap still protects the context", async () => {
    const { playSamples, createLevelTap, RESUME_TIMEOUT_MS } =
      await loadAudioIo();
    const first = createLevelTap(fakeStream);
    createLevelTap(fakeStream);

    first.disconnect();
    first.close();
    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);

    expect(FakeContext.made[0]!.closeCalls).toBe(0);
  });

  it("nothing is dropped while a decode is in flight on the context", async () => {
    const { playSamples, decodeToCanonical, RESUME_TIMEOUT_MS } =
      await loadAudioIo();
    const blob = {
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Blob;
    void decodeToCanonical(blob).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeContext.made[0]!.decodeGate).not.toBeNull();

    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);

    expect(FakeContext.made).toHaveLength(1);
    expect(FakeContext.made[0]!.closeCalls).toBe(0);

    // Once the decode settles (here, by failing), its hold is released and
    // the next failed Play drops the context.
    FakeContext.made[0]!.decodeGate!.reject(new Error("decode failed"));
    await vi.advanceTimersByTimeAsync(0);
    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    expect(FakeContext.made[0]!.closeCalls).toBe(1);
  });

  it("two Plays failing on the same context close it once, and the second does not drop a context it did not start on", async () => {
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();
    const a = playSamples(samples, { isStillCurrent: () => true }).then(
      () => "resolved",
      () => "rejected"
    );
    const b = playSamples(samples, { isStillCurrent: () => true }).then(
      () => "resolved",
      () => "rejected"
    );
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    expect(await a).toBe("rejected");
    expect(await b).toBe("rejected");

    // A failed first and dropped context 1. B's own gate then read the
    // shared context and so built context 2, but B started on context 1,
    // so it must neither close context 1 again nor drop context 2. (The app
    // never has two current Plays at once; this pins the identity check.)
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[0]!.closeCalls).toBe(1);
    expect(FakeContext.made[1]!.closeCalls).toBe(0);
  });

  it('a close() that rejects is reported once as "playback-context-close"', async () => {
    const cause = new Error("close rejected");
    FakeContext.nextCloseRejects = cause;
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();

    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(reportFailure).toHaveBeenCalledWith(cause, "playback-context-close");
    expect(
      reportFailure.mock.calls.filter(
        ([, key]) => key === "playback-context-close"
      )
    ).toHaveLength(1);
  });

  it('a close() that throws synchronously is reported as "playback-context-close"', async () => {
    const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();
    // The first (and only) context is built by the Play below; patch it
    // through the prototype for this one test.
    const cause = new Error("close threw");
    const spy = vi
      .spyOn(FakeContext.prototype, "close")
      .mockImplementation(() => {
        throw cause;
      });

    await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);

    expect(reportFailure).toHaveBeenCalledWith(cause, "playback-context-close");
    spy.mockRestore();
  });

  describe("bounding the drops while a close() is pending (#1232)", () => {
    it("with close() never settling, six failed Plays in a row build at most two contexts", async () => {
      FakeContext.nextCloseHangs = true;
      const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();

      for (let press = 0; press < 6; press++) {
        await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      }

      // Context 1 was dropped and its close() never settles. Every later
      // failed Play reuses context 2 rather than dropping it again.
      expect(FakeContext.made).toHaveLength(2);
      expect(FakeContext.made[0]!.closeCalls).toBe(1);
      expect(FakeContext.made[1]!.closeCalls).toBe(0);
      expect(events).toEqual(["create#1", "close#1", "create#2"]);
      // Still one resume row per Play, and no close row: nothing failed.
      expect(reportFailure).toHaveBeenCalledTimes(6);
      for (const [, key] of reportFailure.mock.calls) {
        expect(key).toBe("playback-resume-timeout");
      }
    });

    it("once the pending close() settles, the next failed Play drops again", async () => {
      FakeContext.nextCloseHangs = true;
      const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();

      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      expect(FakeContext.made).toHaveLength(2);
      expect(FakeContext.made[1]!.closeCalls).toBe(0);

      FakeContext.made[0]!.settleClose();
      await vi.advanceTimersByTimeAsync(0);

      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      expect(FakeContext.made[1]!.closeCalls).toBe(1);
      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      expect(FakeContext.made).toHaveLength(3);
    });

    it("a close() that rejects also ends the wait, so the next failed Play drops again", async () => {
      FakeContext.nextCloseRejects = new Error("close rejected");
      const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();

      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(0);
      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);

      expect(FakeContext.made).toHaveLength(2);
      expect(FakeContext.made[1]!.closeCalls).toBe(1);
    });

    it("a close() that throws synchronously also ends the wait", async () => {
      const { playSamples, RESUME_TIMEOUT_MS } = await loadAudioIo();
      const spy = vi
        .spyOn(FakeContext.prototype, "close")
        .mockImplementationOnce(function (this: FakeContext) {
          this.closeCalls++;
          throw new Error("close threw");
        });

      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);
      await timedOutPlay(playSamples, RESUME_TIMEOUT_MS);

      expect(FakeContext.made).toHaveLength(2);
      expect(FakeContext.made[1]!.closeCalls).toBe(1);
      spy.mockRestore();
    });
  });
});
