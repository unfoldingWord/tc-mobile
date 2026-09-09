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

/** A `Worker` stand-in that can emit progress, done or error and be terminated. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  /** When set, `terminate()` throws — the "recovery itself fails" edge (P3b). */
  static terminateThrows = false;
  /** When set, `postMessage()` throws synchronously (a detached buffer, say). */
  static postMessageThrows = false;
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
  postMessage(): void {
    if (FakeWorker.postMessageThrows) throw new Error("postMessage blew up");
  }
  terminate(): void {
    this.terminated = true;
    if (FakeWorker.terminateThrows) throw new Error("terminate blew up");
  }

  /** A liveness heartbeat: resets the client's silence window, no result. */
  emitProgress(fraction: number): void {
    this.onmessage?.({ data: { kind: "progress", fraction } });
  }
  emitDone(mp3: ArrayBuffer): void {
    this.onmessage?.({ data: { kind: "done", mp3 } });
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
let EncoderStalledError: Codec["EncoderStalledError"];
let TIMEOUT: number;

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
  EncoderStalledError = mod.EncoderStalledError;
  TIMEOUT = mod.ENCODER_SILENCE_TIMEOUT_MS;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { Worker?: unknown }).Worker;
  delete (globalThis as { document?: unknown }).document;
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

  it("pins the silence timeout to a sane, device-friendly value", () => {
    expect(TIMEOUT).toBe(15_000);
  });
});
