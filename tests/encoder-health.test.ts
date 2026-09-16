import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Encoder health (#166) — decided where the encoder is, not where a caller is.
 *
 * The first cut of this counted failures inside the Finished sweep. Both
 * reviewers took it apart in the same round, from opposite ends:
 *
 *  - **George P1.** A stall BREAKS the sweep run (the #290 fix), so a wedged
 *    worker produces exactly ONE failure per run — and the unchanged trigger set
 *    gives a page one launch sweep. Three-in-a-row could never accumulate, so the
 *    one failure mode the deadline exists to name was the one the indicator could
 *    not reach.
 *  - **George P2-3.** Share is the app's other encode-bearing job. A stall there
 *    moved nothing, and a Share that ENCODED FINE never cleared a shelf line the
 *    sweep had already put up.
 *  - **Frank P2 / George P2-4 (a convergence).** A `loadSegmentClip` or
 *    `commitTranscode` throw was counted as "this phone cannot encode", which is
 *    a false diagnosis with a useless recovery attached to it.
 *
 * All three dissolve at one seam: the health is moved into `mp3-codec.ts` and
 * decided by `encodeInWorker`'s own outcomes. Every encode in the app goes
 * through it, nothing else can move the state, and no caller has to remember to
 * report anything. So this file drives the REAL glue with a stubbed
 * `globalThis.Worker` — the same seam `encoder-deadline.test.ts` uses — rather
 * than asserting a counter through the sweep's fakes.
 */

type ErrorEventish = { error?: Error; message?: string };

class FakeWorker {
  static instances: FakeWorker[] = [];
  /** When set, `terminate()` throws — the "recovery itself fails" edge. */
  static terminateThrows = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: ErrorEventish) => void) | null = null;
  terminated = false;
  private errorListeners: ((event: ErrorEventish) => void)[] = [];

  constructor(
    public url: string | URL,
    public options?: unknown
  ) {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, fn: (event: ErrorEventish) => void): void {
    if (type === "error") this.errorListeners.push(fn);
  }
  removeEventListener(type: string, fn: (event: ErrorEventish) => void): void {
    if (type === "error")
      this.errorListeners = this.errorListeners.filter((f) => f !== fn);
  }
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
    if (FakeWorker.terminateThrows) throw new Error("terminate blew up");
  }

  emitDone(mp3: ArrayBuffer): void {
    this.onmessage?.({ data: { kind: "done", mp3 } });
  }
  /** The worker caught something and reported it as a message, not an event. */
  emitEncodeError(message: string): void {
    this.onmessage?.({ data: { kind: "error", message } });
  }
  /** A real `Worker` dispatches to the durable listener before the per-job one. */
  emitWorkerError(message: string): void {
    for (const fn of [...this.errorListeners]) fn({ message });
    this.onerror?.({ message });
  }
}

const microtasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const live = (): FakeWorker => {
  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error("expected a FakeWorker, found none");
  return worker;
};

type Codec = typeof import("@/hooks/mp3-codec");
let withEncoder: Codec["withEncoder"];
let encoderHealth: Codec["encoderHealth"];
let subscribeToEncoderHealth: Codec["subscribeToEncoderHealth"];
let THRESHOLD: number;
let TIMEOUT: number;
let subscribeToFailures: typeof import("@/hooks/report-failure").subscribeToFailures;
let errorSpy: ReturnType<typeof vi.spyOn>;

const encode = (signal?: AbortSignal) =>
  withEncoder(signal, (codec) => codec.encodeMp3(Int16Array.of(1)));

/**
 * Start an encode and let it reach the worker. Deliberately returns NOTHING:
 * returning the encode's promise from an `async` function would make the caller
 * adopt it, so `await startEncode()` would block until the encode settled — and
 * the whole point is to settle it by hand afterwards.
 */
async function startEncode(signal?: AbortSignal): Promise<void> {
  void encode(signal).catch(() => {});
  await microtasks();
}

/** One encode that goes silent for the whole window. */
async function stallOnce(): Promise<void> {
  await startEncode();
  await vi.advanceTimersByTimeAsync(TIMEOUT);
  await microtasks();
}

/** One encode the worker answers with an `error` message. */
async function failOnce(): Promise<void> {
  await startEncode();
  live().emitEncodeError("lame blew up");
  await microtasks();
}

/** One encode that completes. */
async function succeedOnce(): Promise<void> {
  await startEncode();
  live().emitDone(new Uint8Array([1]).buffer);
  await microtasks();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  FakeWorker.instances = [];
  FakeWorker.terminateThrows = false;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const mod = await import("@/hooks/mp3-codec");
  withEncoder = mod.withEncoder;
  encoderHealth = mod.encoderHealth;
  subscribeToEncoderHealth = mod.subscribeToEncoderHealth;
  THRESHOLD = mod.ENCODER_FAILURE_THRESHOLD;
  TIMEOUT = mod.ENCODER_SILENCE_TIMEOUT_MS;
  ({ subscribeToFailures } = await import("@/hooks/report-failure"));
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
  delete (globalThis as { Worker?: unknown }).Worker;
  delete (globalThis as { document?: unknown }).document;
});

describe("encoderHealth (#166)", () => {
  it("starts ok, and a completed encode keeps it there", async () => {
    expect(encoderHealth()).toBe("ok");
    await succeedOnce();
    expect(encoderHealth()).toBe("ok");
  });

  it("ONE stall is the condition itself, not a third of it (George R1 P1)", async () => {
    // A stall already means fifteen seconds of a worker answering nothing. It is
    // not the ordinary per-encode noise the threshold exists to absorb — and
    // because a stall ends the sweep RUN (#290), a page whose worker is wedged
    // gets ONE failure per run and a page gets one launch sweep. Counted as 1/3,
    // the indicator could never appear for the exact failure this work is about.
    await stallOnce();
    expect(encoderHealth()).toBe("failing");
  });

  it("takes N ordinary encode errors, and N-1 is not enough", async () => {
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await failOnce();
      expect(encoderHealth()).toBe("ok");
    }
    await failOnce();
    expect(encoderHealth()).toBe("failing");
  });

  it("counts a worker that dies as an encoder failure", async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await startEncode();
      live().emitWorkerError("the worker script failed to start");
      await microtasks();
    }
    expect(encoderHealth()).toBe("failing");
  });

  it("never counts an ABORT — a cancelled share is not a broken encoder", async () => {
    for (let i = 0; i < THRESHOLD * 2; i++) {
      const controller = new AbortController();
      await startEncode(controller.signal);
      controller.abort();
      await microtasks();
    }
    expect(encoderHealth()).toBe("ok");
  });

  it("clears on any successful encode, including a Share's (George R1 P2-3)", async () => {
    await stallOnce();
    expect(encoderHealth()).toBe("failing");

    // The next encode works — whoever asked for it. The shelf must stop saying
    // the phone cannot encode the moment the phone demonstrably can.
    await succeedOnce();
    expect(encoderHealth()).toBe("ok");

    // And the COUNT went with it: it takes N more ordinary failures, not one.
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await failOnce();
      expect(encoderHealth()).toBe("ok");
    }
    await failOnce();
    expect(encoderHealth()).toBe("failing");
  });

  it("tells subscribers on CHANGE only, and stops after unsubscribe", async () => {
    const seen: string[] = [];
    const stop = subscribeToEncoderHealth((h) => seen.push(h));
    await stallOnce();
    await stallOnce();
    expect(seen).toEqual(["failing"]);

    await succeedOnce();
    expect(seen).toEqual(["failing", "ok"]);

    stop();
    await stallOnce();
    expect(encoderHealth()).toBe("failing");
    expect(seen).toEqual(["failing", "ok"]);
  });

  it("reports a stall recovery that itself fails, instead of logging it (George R1 P3-5)", async () => {
    const reports: { context: string; cause: unknown }[] = [];
    const stopSink = subscribeToFailures((r) =>
      reports.push({ context: r.context, cause: r.cause })
    );
    try {
      FakeWorker.terminateThrows = true;
      await stallOnce();

      // The lane is still released and the health still moves — a terminate that
      // throws must never cost either — and the recovery failure now sits in the
      // same funnel as every other caught failure rather than in the console.
      expect(encoderHealth()).toBe("failing");
      expect(reports.map((r) => r.context)).toContain("encoder-recover");
    } finally {
      stopSink();
    }
  });

  it("a throwing subscriber is reported, never swallowed, and does not break the encode", async () => {
    const boom = new Error("the listener blew up");
    const stopListener = subscribeToEncoderHealth(() => {
      throw boom;
    });
    const reports: { context: string; cause: unknown }[] = [];
    const stopSink = subscribeToFailures((r) =>
      reports.push({ context: r.context, cause: r.cause })
    );
    try {
      await stallOnce();
      expect(encoderHealth()).toBe("failing");
      expect(
        reports.some((r) => r.context === "encoder-health" && r.cause === boom)
      ).toBe(true);
    } finally {
      stopSink();
      stopListener();
    }
  });
});
