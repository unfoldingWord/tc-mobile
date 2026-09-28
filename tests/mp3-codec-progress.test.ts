import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #996: the worker's throttled `progress` heartbeat (#166) reaches the caller
 * of `codec.encodeMp3` as `onProgress(fraction)`, so Share Chapter's count can
 * move through the encode. Only while the job is live: an abort stops the
 * reports, and the worker is still terminated and re-warmed exactly as ADR
 * 0009 has it (`tests/mp3-codec.test.ts` owns that lifetime; this file checks
 * that the progress wiring did not change it).
 *
 * A trimmed copy of `tests/mp3-codec.test.ts`'s `Worker` stand-in: the real
 * worker round-trip is browser-only, and what is pinned here is the codec's
 * handling of the messages, not a worker thread.
 */

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  private messageListeners: ((event: { data: unknown }) => void)[] = [];

  constructor(public url: string | URL) {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, fn: (event: never) => void): void {
    if (type === "message")
      this.messageListeners.push(fn as (event: { data: unknown }) => void);
  }
  removeEventListener(type: string, fn: (event: never) => void): void {
    if (type === "message")
      this.messageListeners = this.messageListeners.filter((f) => f !== fn);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  private deliver(data: unknown): void {
    const event = { data };
    for (const fn of [...this.messageListeners]) fn(event);
    this.onmessage?.(event);
  }
  emitProgress(fraction: number): void {
    this.deliver({ kind: "progress", fraction });
  }
  emitDone(mp3: ArrayBuffer): void {
    this.deliver({ kind: "done", mp3 });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const nth = (n: number): FakeWorker => {
  const worker = FakeWorker.instances[n];
  if (!worker) throw new Error(`expected a FakeWorker #${n}, found none`);
  return worker;
};

let withEncoder: (typeof import("@/hooks/mp3-codec"))["withEncoder"];

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  withEncoder = (await import("@/hooks/mp3-codec")).withEncoder;
});

afterEach(() => {
  delete (globalThis as { Worker?: unknown }).Worker;
});

describe("codec.encodeMp3 reports the worker's progress (#996)", () => {
  it("hands each heartbeat's fraction to onProgress, then resolves on done", async () => {
    const seen: number[] = [];
    const p = withEncoder(undefined, (codec) =>
      codec.encodeMp3(Int16Array.of(1, 2, 3), (f) => seen.push(f))
    );
    await flush();
    nth(0).emitProgress(0.25);
    nth(0).emitProgress(0.75);
    expect(seen).toEqual([0.25, 0.75]);
    nth(0).emitDone(new Uint8Array([1]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    // A beat after the job settled belongs to nobody.
    nth(0).emitProgress(0.9);
    expect(seen).toEqual([0.25, 0.75]);
  });

  it("an abort mid-encode stops the reports and still terminates and re-warms the worker", async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    const p = withEncoder(controller.signal, (codec) =>
      codec.encodeMp3(Int16Array.of(1, 2, 3), (f) => seen.push(f))
    );
    await flush();
    nth(0).emitProgress(0.3);
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);
    nth(0).emitProgress(0.6);
    expect(seen).toEqual([0.3]);
    expect(nth(0).terminated).toBe(true);
    // Re-warmed immediately (ADR 0009 / #182), and the next encode reuses it.
    expect(FakeWorker.instances).toHaveLength(2);
    const p2 = withEncoder(undefined, (codec) =>
      codec.encodeMp3(Int16Array.of(4))
    );
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("an encode with no onProgress still treats a heartbeat as a sign of life only", async () => {
    const p = withEncoder(undefined, (codec) =>
      codec.encodeMp3(Int16Array.of(1))
    );
    await flush();
    expect(() => nth(0).emitProgress(0.5)).not.toThrow();
    nth(0).emitDone(new Uint8Array([1]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });
});
