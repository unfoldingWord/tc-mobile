import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The encoder worker's LIFETIME (#182), in Node.
 *
 * `encoder-lane.test.ts` covers `withEncoder`'s serialisation with work that
 * never reaches a worker. The warm-and-reuse lifetime this PR introduces —
 * one worker reused across encodes, dropped and re-warmed on abort, dropped by
 * a durable `error` listener when it dies — is reachable through
 * `codec.encodeMp3` with a stubbed `globalThis.Worker`, no browser or real
 * thread needed. The stub lets each test decide when a worker answers, errors
 * or is constructed, which is exactly what the round-1 R1 wedge turns on.
 */

type ErrorEventish = { error?: Error; message?: string };

/** A `Worker` stand-in: records construction, lets a test drive its events. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: ErrorEventish) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
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
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }

  /** The worker answers a job successfully. */
  emitDone(mp3: ArrayBuffer): void {
    this.onmessage?.({ data: { kind: "done", mp3 } });
  }
  /** The worker errors — a load failure or a crash. Fires both handler kinds. */
  emitError(error: Error): void {
    const event: ErrorEventish = { error, message: error.message };
    this.onerror?.(event);
    for (const fn of [...this.errorListeners]) fn(event);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The n-th constructed worker, asserting it exists. */
const nth = (n: number): FakeWorker => {
  const worker = FakeWorker.instances[n];
  if (!worker) throw new Error(`expected a FakeWorker #${n}, found none`);
  return worker;
};

type Codec = typeof import("@/hooks/mp3-codec");
let withEncoder: Codec["withEncoder"];
let warmEncoder: Codec["warmEncoder"];

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const mod = await import("@/hooks/mp3-codec");
  withEncoder = mod.withEncoder;
  warmEncoder = mod.warmEncoder;
});

afterEach(() => {
  delete (globalThis as { Worker?: unknown }).Worker;
});

const encode = (samples: Int16Array, signal?: AbortSignal) =>
  withEncoder(signal, (codec) => codec.encodeMp3(samples));

describe("the shared encoder worker's lifetime", () => {
  it("reuses one worker across sequential encodes", async () => {
    const p1 = encode(Int16Array.of(1));
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    nth(0).emitDone(new Uint8Array([1]).buffer);
    await p1;

    const p2 = encode(Int16Array.of(2));
    await flush();
    // Same worker answers the second job — not a fresh construction.
    expect(FakeWorker.instances).toHaveLength(1);
    nth(0).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("warms one worker at startup and reuses it for the first encode", async () => {
    warmEncoder();
    expect(FakeWorker.instances).toHaveLength(1);
    const warmed = nth(0);

    const p = encode(Int16Array.of(1));
    await flush();
    // The encode reuses the warmed worker rather than building a second.
    expect(FakeWorker.instances).toHaveLength(1);
    expect(nth(0)).toBe(warmed);
    warmed.emitDone(new Uint8Array([1]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });

  it("terminates and re-warms the worker on abort (R2)", async () => {
    const controller = new AbortController();
    const p = encode(Int16Array.of(1), controller.signal);
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);

    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);
    expect(nth(0).terminated).toBe(true);
    // Re-warmed immediately, so the #182 protection survives the cancelled share.
    expect(FakeWorker.instances).toHaveLength(2);

    const p2 = encode(Int16Array.of(2));
    await flush();
    // The next encode reuses the re-warmed worker, not a third construction.
    expect(FakeWorker.instances).toHaveLength(2);
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("drops a worker that errors during a job; the next encode rebuilds", async () => {
    const p = encode(Int16Array.of(1));
    await flush();
    nth(0).emitError(new Error("worker crashed"));
    await expect(p).rejects.toThrow("worker crashed");
    expect(nth(0).terminated).toBe(true);

    const p2 = encode(Int16Array.of(2));
    await flush();
    // A fresh worker, because the crashed one was dropped — not reused hung.
    expect(FakeWorker.instances).toHaveLength(2);
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("drops a warm worker that dies before any encode, and does not reuse the dead handle (R1)", async () => {
    warmEncoder();
    expect(FakeWorker.instances).toHaveLength(1);
    const warmed = nth(0);

    // A script-load failure arrives asynchronously as an `error` event while the
    // worker is idle, with no per-job `onerror` attached. The durable listener
    // must drop it — otherwise the handle stays and wedges the next encode.
    warmed.emitError(new Error("chunk failed to load"));
    expect(warmed.terminated).toBe(true);

    const p = encode(Int16Array.of(1));
    await flush();
    // The dead handle is NOT reused: a fresh worker is built and answers.
    expect(FakeWorker.instances).toHaveLength(2);
    expect(nth(1)).not.toBe(warmed);
    nth(1).emitDone(new Uint8Array([1]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });
});
