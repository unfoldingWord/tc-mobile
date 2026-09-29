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

  readonly id: number;
  state: string;
  readonly resumeMode: ResumeMode;
  readonly closeRejects: unknown;
  closeCalls = 0;
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
    return this.closeRejects === undefined
      ? Promise.resolve()
      : Promise.reject(this.closeRejects);
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
});
