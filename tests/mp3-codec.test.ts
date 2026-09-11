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
 *
 * The blob SNAPSHOT (#192) is covered the same way. The real snapshot — a
 * `?worker&url` chunk fetched and rerun as a blob worker — is browser-only, so
 * what these tests pin is the DECISION the module makes: which URL each worker
 * is constructed from, when the snapshot is taken, and when a snapshot that
 * cannot run is thrown away. `fetch`, `Blob` and `createObjectURL` are stubs;
 * that a real blob worker runs the real chunk is device evidence, not this.
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
  /** The worker errors — a load failure or a crash. Fires both handler kinds.
   *  Real order (round-2 F1): the durable `addEventListener("error")` runs
   *  BEFORE the per-job `onerror =`, because an event-handler IDL attribute
   *  takes its listener-list position from its first assignment, and the durable
   *  one is registered at construction while `onerror` is assigned later. */
  emitError(error: Error): void {
    const event: ErrorEventish = { error, message: error.message };
    for (const fn of [...this.errorListeners]) fn(event);
    this.onerror?.(event);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The stubbed object-URL factory: what `workerScriptUrl()` returns once taken. */
const BLOB_URL = "blob:snapshot-of-the-worker-chunk";

/** Drives the snapshot fetch: the test decides when (and whether) it lands. */
let chunkFetch: {
  /** The chunk fetch resolves with this source text. */
  land: (source: string) => void;
  /** The chunk fetch fails — offline, or already purged. */
  fail: (cause: unknown) => void;
  /** How many times the module fetched the chunk. */
  calls: () => number;
};
/** Object URLs handed to `revokeObjectURL`. */
let revoked: string[];

/** Stub `fetch`, `Blob` and the object-URL pair, and turn the PROD gate on. */
function stubSnapshotEnvironment(): void {
  vi.stubEnv("PROD", true);
  revoked = [];
  let calls = 0;
  let settle!: (value: unknown) => void;
  let reject!: (cause: unknown) => void;
  const pending = new Promise<unknown>((resolve, fail) => {
    settle = resolve;
    reject = fail;
  });
  chunkFetch = {
    land: (source) => settle({ ok: true, text: () => Promise.resolve(source) }),
    fail: (cause) => reject(cause),
    calls: () => calls,
  };
  globalThis.fetch = (() => {
    calls += 1;
    return pending;
  }) as unknown as typeof fetch;
  globalThis.Blob = class {
    constructor(public parts: unknown[]) {}
  } as unknown as typeof Blob;
  URL.createObjectURL = () => BLOB_URL;
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
}

/** Everything the app's own bundle URL looks like: NOT the blob. */
const isChunkUrl = (url: string | URL) => String(url) !== BLOB_URL;

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
  delete (globalThis as { fetch?: unknown }).fetch;
  delete (globalThis as { Blob?: unknown }).Blob;
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  vi.unstubAllEnvs();
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

describe("the worker chunk's blob snapshot (#192)", () => {
  beforeEach(stubSnapshotEnvironment);

  /** Warm, land the snapshot, and return the warm worker (chunk-built). */
  const warmWithSnapshot = async (): Promise<FakeWorker> => {
    warmEncoder();
    const warmed = nth(0);
    chunkFetch.land("/* the built worker chunk */");
    await flush();
    return warmed;
  };

  it("builds the warm worker from the chunk URL, before any snapshot exists", () => {
    warmEncoder();
    // Nothing to snapshot from yet — the first worker is what MAKES the fetch
    // safe, because it is created while the running build's precache is intact.
    expect(isChunkUrl(nth(0).url)).toBe(true);
  });

  it("rebuilds from the blob after an abort, not from the purged chunk URL", async () => {
    await warmWithSnapshot();

    // The share the translator cancels. Only `terminate()` stops an in-flight
    // encode, so the warm worker dies and the codec must rebuild — and THIS is
    // the rebuild #182 left exposed: hours later, the chunk URL may be purged.
    const controller = new AbortController();
    const p = encode(Int16Array.of(1), controller.signal);
    await flush();
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);

    expect(FakeWorker.instances).toHaveLength(2);
    expect(nth(1).url).toBe(BLOB_URL);
  });

  it("rebuilds from the blob after the worker crashes", async () => {
    await warmWithSnapshot();

    const p = encode(Int16Array.of(1));
    await flush();
    nth(0).emitError(new Error("worker crashed"));
    await expect(p).rejects.toThrow("worker crashed");

    const p2 = encode(Int16Array.of(2));
    await flush();
    expect(nth(1).url).toBe(BLOB_URL);
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("fetches the chunk once, however many times it is warmed", async () => {
    await warmWithSnapshot();
    warmEncoder();
    warmEncoder();
    await flush();
    expect(chunkFetch.calls()).toBe(1);
  });

  it("stays on the chunk URL when the snapshot fetch fails", async () => {
    warmEncoder();
    chunkFetch.fail(new Error("offline"));
    await flush();

    const controller = new AbortController();
    const p = encode(Int16Array.of(1), controller.signal);
    await flush();
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);

    // Best-effort: a snapshot that could not be taken degrades to #182's
    // behaviour rather than leaving the codec with no script at all.
    expect(isChunkUrl(nth(1).url)).toBe(true);
  });

  it("takes no snapshot outside a production build", async () => {
    vi.stubEnv("PROD", false);
    warmEncoder();
    await flush();
    // In dev the chunk is an unbundled module with live imports, so a blob copy
    // would resolve nothing — and there is no service worker purging it.
    expect(chunkFetch.calls()).toBe(0);
    expect(isChunkUrl(nth(0).url)).toBe(true);
  });

  it("throws away a snapshot whose worker dies without ever answering", async () => {
    await warmWithSnapshot();

    // Force a rebuild, which now comes from the blob.
    const controller = new AbortController();
    const aborted = encode(Int16Array.of(1), controller.signal);
    await flush();
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(DOMException);
    expect(nth(1).url).toBe(BLOB_URL);

    // The blob worker cannot start — a wrong format, a truncated fetch, a CSP
    // that forbids blob workers. None of that is reachable in CI, so the module
    // must degrade rather than brick: drop the snapshot and fall back.
    nth(1).emitError(new Error("blob worker failed to start"));
    expect(revoked).toEqual([BLOB_URL]);

    const p = encode(Int16Array.of(2));
    await flush();
    expect(isChunkUrl(nth(2).url)).toBe(true);
    nth(2).emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });

  it("keeps a snapshot whose worker answered once and crashed later", async () => {
    await warmWithSnapshot();

    const controller = new AbortController();
    const aborted = encode(Int16Array.of(1), controller.signal);
    await flush();
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(DOMException);
    expect(nth(1).url).toBe(BLOB_URL);

    // It answers, which PROVES the blob runs.
    const ok = encode(Int16Array.of(2));
    await flush();
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(ok).resolves.toBeInstanceOf(Uint8Array);

    // A later crash is an OOM mid-encode, not a bad snapshot. Throwing the
    // snapshot away here would re-expose #192 after one ordinary crash.
    const p = encode(Int16Array.of(3));
    await flush();
    nth(1).emitError(new Error("out of memory"));
    await expect(p).rejects.toThrow("out of memory");
    expect(revoked).toEqual([]);

    const p2 = encode(Int16Array.of(4));
    await flush();
    expect(nth(2).url).toBe(BLOB_URL);
    nth(2).emitDone(new Uint8Array([4]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });
});
