import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The encode SILENCE deadline (#166), in Node.
 *
 * A worker that neither answers nor errors — killed under memory pressure, a
 * chunk that never loads — used to hold the single encoder lane forever, wedging
 * every later Share and the Finished sweep. The fix bounds every encode by how
 * long the worker stays SILENT (no progress heartbeat, no done, no error), not by
 * elapsed wall-clock — so an iOS lock/background freeze, which suspends page and
 * worker together, cannot false-kill a suspended encode.
 *
 * Driven through the real `codec.encodeMp3` glue with a stubbed `globalThis.Worker`
 * and fake timers, the same seam `mp3-codec.test.ts` uses: the FakeWorker decides
 * when (and whether) it emits progress, so the heartbeat, the freeze/resume window
 * and the terminate + re-warm recovery are all reachable without a browser.
 */

type ErrorEventish = { error?: Error; message?: string };
type MessageEventish = { data: unknown };

/** A `Worker` stand-in that can emit progress, done or error and be terminated. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  /** When set, `terminate()` throws — the "recovery itself fails" edge (P3b). */
  static terminateThrows = false;
  /** When set, `postMessage()` throws synchronously (a detached buffer, say). */
  static postMessageThrows = false;
  onmessage: ((event: MessageEventish) => void) | null = null;
  onerror: ((event: ErrorEventish) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  private errorListeners: ((event: ErrorEventish) => void)[] = [];
  private messageListeners: ((event: MessageEventish) => void)[] = [];

  constructor(
    public url: string | URL,
    public options?: unknown
  ) {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, fn: (event: never) => void): void {
    if (type === "error")
      this.errorListeners.push(fn as (event: ErrorEventish) => void);
    if (type === "message")
      this.messageListeners.push(fn as (event: MessageEventish) => void);
  }
  removeEventListener(type: string, fn: (event: never) => void): void {
    if (type === "error")
      this.errorListeners = this.errorListeners.filter((f) => f !== fn);
    if (type === "message")
      this.messageListeners = this.messageListeners.filter((f) => f !== fn);
  }
  postMessage(message: unknown): void {
    if (FakeWorker.postMessageThrows) throw new Error("postMessage blew up");
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
    if (FakeWorker.terminateThrows) throw new Error("terminate blew up");
  }

  private deliver(data: unknown): void {
    const event = { data };
    for (const fn of [...this.messageListeners]) fn(event);
    this.onmessage?.(event);
  }

  emitReady(): void {
    this.deliver({ kind: "ready" });
  }
  /** A liveness heartbeat: resets the client's silence window, no result. */
  emitProgress(fraction: number): void {
    this.deliver({ kind: "progress", fraction });
  }
  emitDone(mp3: ArrayBuffer): void {
    this.deliver({ kind: "done", mp3 });
  }
}

/** A `document` stand-in: Node has none, so freeze/resume is driven by hand. */
function installFakeDocument() {
  const listeners: Record<string, Array<() => void>> = {};
  const doc = {
    hidden: false,
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
  };
  (globalThis as { document?: unknown }).document = doc;
  const dispatchVisibility = () => {
    for (const fn of [...(listeners["visibilitychange"] ?? [])]) fn();
  };
  /** Flip visibility AND fire the event, the normal case. */
  const setHidden = (hidden: boolean) => {
    doc.hidden = hidden;
    dispatchVisibility();
  };
  return { doc, setHidden, dispatchVisibility };
}

/** Let `withEncoder`'s microtask chain reach the armed encode. */
const microtasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const nth = (n: number): FakeWorker => {
  const worker = FakeWorker.instances[n];
  if (!worker) throw new Error(`expected a FakeWorker #${n}, found none`);
  return worker;
};

type Codec = typeof import("@/hooks/mp3-codec");
let withEncoder: Codec["withEncoder"];
let warmEncoder: Codec["warmEncoder"];
let EncoderStalledError: Codec["EncoderStalledError"];
let TIMEOUT: number;
let READY_TIMEOUT: number;

const encode = (samples: Int16Array) =>
  withEncoder(undefined, (codec) => codec.encodeMp3(samples));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
  FakeWorker.terminateThrows = false;
  FakeWorker.postMessageThrows = false;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const mod = await import("@/hooks/mp3-codec");
  withEncoder = mod.withEncoder;
  warmEncoder = mod.warmEncoder;
  EncoderStalledError = mod.EncoderStalledError;
  TIMEOUT = mod.ENCODER_SILENCE_TIMEOUT_MS;
  READY_TIMEOUT = mod.ENCODER_READY_TIMEOUT_MS;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete (globalThis as { Worker?: unknown }).Worker;
  delete (globalThis as { document?: unknown }).document;
});

it("delivers messages to retained listeners before the per-job handler", () => {
  const worker = new FakeWorker("worker.js");
  const calls: string[] = [];
  const retained = () => calls.push("durable");
  const removed = () => calls.push("removed");
  worker.addEventListener("message", retained);
  worker.addEventListener("message", removed);
  worker.removeEventListener("message", removed);
  worker.onmessage = () => calls.push("job");
  worker.emitReady();
  worker.emitProgress(0.5);
  worker.emitDone(new ArrayBuffer(1));
  expect(calls).toEqual(["durable", "job", "durable", "job", "durable", "job"]);
});

describe("snapshot readiness before the silence deadline", () => {
  const snapshotUrl = "blob:encoder-deadline-snapshot";

  async function rebuildFromSnapshot() {
    vi.stubEnv("PROD", true);
    const fetchChunk = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "/* worker snapshot */",
    });
    vi.stubGlobal("fetch", fetchChunk);
    vi.spyOn(URL, "createObjectURL").mockReturnValue(snapshotUrl);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    warmEncoder();
    await microtasks();
    await microtasks();
    expect(fetchChunk).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const first = withEncoder(controller.signal, (codec) =>
      codec.encodeMp3(Int16Array.of(1))
    );
    const rejection = expect(first).rejects.toBeInstanceOf(DOMException);
    await microtasks();
    expect(nth(0).posted).toHaveLength(1);
    controller.abort();
    await rejection;
    expect(nth(1).url).toBe(snapshotUrl);
    return nth(1);
  }

  it("starts the encode deadline after the snapshot answers ready", async () => {
    const worker = await rebuildFromSnapshot();
    const controller = new AbortController();
    const pending = withEncoder(controller.signal, (codec) =>
      codec.encodeMp3(Int16Array.of(2))
    );
    // Keep an assertion failure from leaving an unobserved pending job behind.
    void pending.catch(() => {});
    try {
      await microtasks();
      expect(worker.posted).toEqual([]);
      worker.emitReady();
      await microtasks();
      expect(
        worker.posted,
        "Snapshot ready must release the handshake before testing encode silence"
      ).toHaveLength(1);
      expect(worker.onmessage).toBeTypeOf("function");
      worker.emitProgress(0.5);
      const rejection =
        expect(pending).rejects.toBeInstanceOf(EncoderStalledError);
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      await rejection;
      expect(worker.terminated).toBe(true);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      await pending.catch(() => {});
    }
  });

  it("withholds PCM without ready and falls back within the fake-clock budget", async () => {
    const worker = await rebuildFromSnapshot();
    const controller = new AbortController();
    const pending = withEncoder(controller.signal, (codec) =>
      codec.encodeMp3(Int16Array.of(3))
    );
    void pending.catch(() => {});
    try {
      await microtasks();
      expect(worker.posted).toEqual([]);
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
      expect(worker.terminated).toBe(false);
      expect(worker.posted).toEqual([]);
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
      expect(worker.terminated).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(snapshotUrl);
      const fallback = nth(2);
      expect(fallback.url).toEqual(nth(0).url);
      expect(
        fallback.posted,
        "Withheld ready must reach chunk fallback within two handshake windows"
      ).toHaveLength(1);
      fallback.emitDone(new Uint8Array([3]).buffer);
      await expect(pending).resolves.toEqual(new Uint8Array([3]));
    } finally {
      controller.abort();
      await pending.catch(() => {});
    }
  });
});

describe("the encode silence deadline (#166)", () => {
  it("never trips while the worker keeps emitting progress", async () => {
    const p = encode(Int16Array.of(1));
    await microtasks();
    expect(FakeWorker.instances).toHaveLength(1);

    // A heartbeat every 10 s — under the window — for far longer than the window.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(TIMEOUT - 5_000);
      nth(0).emitProgress(0.2 * (i + 1));
    }
    nth(0).emitDone(new Uint8Array([1]).buffer);

    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    // A progressing encode is never terminated, however long it runs.
    expect(nth(0).terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("trips after the silence timeout when the worker goes quiet", async () => {
    const p = encode(Int16Array.of(2));
    await microtasks();
    const rejection = expect(p).rejects.toBeInstanceOf(EncoderStalledError);
    // No progress, no done, no error: silent for the whole window.
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await rejection;
    expect(nth(0).terminated).toBe(true);
  });

  it("does not trip across an iOS freeze/resume of a suspended worker", async () => {
    const { setHidden } = installFakeDocument();
    const p = encode(Int16Array.of(3));
    await microtasks();
    // Guard against a wrong trip becoming an unhandled rejection mid-advance.
    void p.catch(() => {});

    // Freeze: the page (and its worker) is suspended, silent far past the window.
    setHidden(true);
    await vi.advanceTimersByTimeAsync(TIMEOUT * 3);
    // A frozen page is never judged stalled.
    expect(nth(0).terminated).toBe(false);

    // Resume grants a fresh window; the worker soon answers.
    setHidden(false);
    nth(0).emitDone(new Uint8Array([3]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    expect(nth(0).terminated).toBe(false);
  });

  it("does not trip when the overdue timer runs BEFORE the resume handler (Frank R2 P2)", async () => {
    const { doc, dispatchVisibility } = installFakeDocument();
    const p = encode(Int16Array.of(7));
    await microtasks();
    void p.catch(() => {});

    // Hide fires normally (before the freeze), latching that a freeze may span.
    doc.hidden = true;
    dispatchVisibility();

    // The freeze then ends: the platform flips `document.hidden` back to false,
    // but the overdue stall timer's task runs FIRST — before the queued
    // visibilitychange handler. So fire the overdue timer (one window) while
    // hidden is already false and the resume handler has NOT yet run.
    doc.hidden = false;
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    // Must NOT have tripped on the stale, un-measurable silence.
    expect(nth(0).terminated).toBe(false);

    // The delayed resume handler now runs; the worker answers.
    dispatchVisibility();
    nth(0).emitDone(new Uint8Array([7]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    expect(nth(0).terminated).toBe(false);
  });

  it("does not trip when a heartbeat lands AFTER hide but before the freeze (George R1 F1)", async () => {
    const { doc, dispatchVisibility } = installFakeDocument();
    const p = encode(Int16Array.of(11));
    await microtasks();
    void p.catch(() => {});

    // Hide fires normally, latching that a freeze may span.
    doc.hidden = true;
    dispatchVisibility();
    // One queued heartbeat is delivered while hidden, before JS suspends (an
    // iOS beat posted just before the freeze; Android keeping the worker briefly
    // alive). It is a sign of life, but it must NOT clear the freeze latch — the
    // page is still hidden, so a freeze may still follow it.
    nth(0).emitProgress(0.5);

    // The freeze ends: `hidden` flips back, and the overdue stall timer runs
    // BEFORE the queued visibilitychange handler.
    doc.hidden = false;
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    // Must NOT have tripped: the elapsed silence spans a suspension.
    expect(nth(0).terminated).toBe(false);

    dispatchVisibility();
    nth(0).emitDone(new Uint8Array([11]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    expect(nth(0).terminated).toBe(false);
  });

  it("does not trip when the encode BEGINS while the page is already hidden", async () => {
    const { doc, dispatchVisibility } = installFakeDocument();
    // Backgrounded before the encode even starts — no hide transition will fire,
    // so the freeze latch must seed itself from the current state.
    doc.hidden = true;
    const p = encode(Int16Array.of(9));
    await microtasks();
    void p.catch(() => {});

    // Suspended past the window, then restored: the overdue timer runs with
    // `hidden` already false and before the resume handler.
    doc.hidden = false;
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(nth(0).terminated).toBe(false);

    dispatchVisibility();
    nth(0).emitDone(new Uint8Array([9]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    expect(nth(0).terminated).toBe(false);
  });

  it("recovers a stalled worker exactly as an abort does — terminate, re-warm, reuse", async () => {
    const p = encode(Int16Array.of(4));
    await microtasks();
    const rejection = expect(p).rejects.toBeInstanceOf(EncoderStalledError);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await rejection;

    // The abort path's teardown: the dead worker is terminated AND a fresh one is
    // warmed (instances grows), so the lane is released and #182 protection holds.
    expect(nth(0).terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);

    // The next encode reuses the re-warmed worker, not a third construction.
    const p2 = encode(Int16Array.of(5));
    await microtasks();
    expect(FakeWorker.instances).toHaveLength(2);
    nth(1).emitDone(new Uint8Array([5]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("still rejects with EncoderStalledError when the recovery terminate throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    FakeWorker.terminateThrows = true;
    const p = encode(Int16Array.of(6));
    await microtasks();
    const rejection = expect(p).rejects.toBeInstanceOf(EncoderStalledError);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    // The caller is still rejected (never a hung lane), and the recovery failure
    // reached a channel rather than being swallowed.
    await rejection;
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("cleans up and rejects when postMessage throws — leaving no armed stall timer", async () => {
    FakeWorker.postMessageThrows = true;
    const p = encode(Int16Array.of(8));
    const rejection = expect(p).rejects.toThrow("postMessage blew up");
    await microtasks();
    await rejection;

    // The stall timer armed just before postMessage must have been cleared: if it
    // were still live it would fire after the window and terminate whatever worker
    // is current by then — an unrelated encode's (Frank R2 P2).
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2);
    expect(nth(0).terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("a settled encode's overdue stall timer never kills a LATER encode (George R3 P2)", async () => {
    // `clearTimeout` cannot un-queue a callback the platform has already
    // dispatched, so a stall timer that came due in the same turn as `done`
    // still runs after the job settled. Without a settled guard it saw a stale
    // `lastMessageAt`, judged the encode stalled, and called
    // `teardownAndRecover()` — terminating the SHARED worker that the next
    // encode is by then using. Share Book runs every chapter through one
    // `withEncoder` turn, so that loses the whole book's work.
    //
    // Fake timers cannot reproduce an already-dispatched callback (their
    // clearTimeout really does un-queue it), so the callback is captured at arm
    // time and invoked by hand after the settle — which is exactly the ordering
    // the platform produces.
    const armed: Array<() => void> = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void
    ) => {
      armed.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    try {
      const first = encode(Int16Array.of(1));
      await microtasks();
      const worker = nth(0);
      expect(armed).not.toHaveLength(0);
      const overdueStall = armed[armed.length - 1]!;

      // The first encode settles normally.
      worker.emitDone(new Uint8Array([1]).buffer);
      await expect(first).resolves.toBeInstanceOf(Uint8Array);

      // A second encode takes the same warm worker.
      const second = encode(Int16Array.of(2));
      await microtasks();
      expect(FakeWorker.instances).toHaveLength(1);

      // Push the clock past the window. Without this the frozen fake clock
      // makes the stale callback measure zero silence and return harmlessly —
      // the test would pass on the clock rather than on the guard.
      vi.setSystemTime(Date.now() + TIMEOUT + 1);

      // Now the first encode's already-dispatched stall callback runs.
      overdueStall();

      // It must do nothing: the second encode's worker is untouched and its
      // encode still completes.
      expect(worker.terminated).toBe(false);
      expect(FakeWorker.instances).toHaveLength(1);
      worker.emitDone(new Uint8Array([2]).buffer);
      await expect(second).resolves.toBeInstanceOf(Uint8Array);
    } finally {
      spy.mockRestore();
    }
  });

  it("re-arms the silence window on every heartbeat instead of firing on a grid", async () => {
    // A healthy encode used to run `onStall` every 15 s and re-arm for the
    // remainder — correct in outcome, but it kept a live timer racing `done`
    // on a fixed grid for the whole encode. Resetting the window on each beat
    // means a progressing encode never reaches `onStall` at all, which is what
    // shrinks the race above to the single final window.
    let stallRuns = 0;
    const armed: Array<() => void> = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void
    ) => {
      armed.push(() => {
        stallRuns++;
        fn();
      });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    try {
      const p = encode(Int16Array.of(3));
      await microtasks();
      const armsAfterStart = armed.length;

      // Three heartbeats, each of which must replace the pending window.
      nth(0).emitProgress(0.25);
      nth(0).emitProgress(0.5);
      nth(0).emitProgress(0.75);
      expect(armed.length).toBe(armsAfterStart + 3);

      nth(0).emitDone(new Uint8Array([3]).buffer);
      await expect(p).resolves.toBeInstanceOf(Uint8Array);
      // The encode never once had to judge itself stalled.
      expect(stallRuns).toBe(0);
      expect(nth(0).terminated).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("pins the silence timeout to a sane, device-friendly value", () => {
    expect(TIMEOUT).toBe(15_000);
  });

  it("keeps the worker's heartbeat well inside the silence window (George R2 P3-3)", async () => {
    // The two constants live in different modules and nothing but this bound
    // couples them: raise the worker's pulse (or drop the window) far enough and
    // a HEALTHY encode goes silent past its deadline and is killed. Two beats of
    // headroom, so losing one message to scheduling is not fatal.
    //
    // Importing the worker runs its top-level `addEventListener`, which Node has
    // no global for, so both worker-scope globals are stubbed for the import.
    vi.stubGlobal("addEventListener", () => {});
    vi.stubGlobal("postMessage", () => {});
    try {
      const { PROGRESS_HEARTBEAT_MS } = await import("@/hooks/mp3.worker");
      expect(PROGRESS_HEARTBEAT_MS).toBeGreaterThan(0);
      expect(PROGRESS_HEARTBEAT_MS * 2).toBeLessThan(TIMEOUT);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
