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
  /**
   * URLs whose construction throws SYNCHRONOUSLY — a CSP that forbids `blob:`
   * workers, a WebView that refuses one (George R1 P2-3). A `Set`, not a flag,
   * because the point of that finding is that the BLOB throws while the chunk
   * URL would have worked.
   */
  static throwOnUrl = new Set<string>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: ErrorEventish) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  private errorListeners: ((event: ErrorEventish) => void)[] = [];
  private messageListeners: ((event: { data: unknown }) => void)[] = [];

  /**
   * How many `message` listeners are attached. One is durable (proof, attached
   * at construction); a SECOND means `awaitWorkerReady` is currently waiting on
   * this worker. Tests about the handshake assert on it rather than assuming a
   * job got that far: "the abort landed while the handshake was open" is a claim
   * about WHERE the job is, and a job still queued on the encoder lane would
   * satisfy every other assertion in such a test without ever running the line
   * it names.
   */
  get waitingForReady(): boolean {
    return this.messageListeners.length > 1;
  }

  constructor(
    public url: string | URL,
    public options?: unknown
  ) {
    FakeWorker.instances.push(this);
    if (FakeWorker.throwOnUrl.has(String(url)))
      throw new Error(`refusing to construct a worker from ${String(url)}`);
  }

  addEventListener(type: string, fn: (event: never) => void): void {
    if (type === "error")
      this.errorListeners.push(fn as (event: ErrorEventish) => void);
    if (type === "message")
      this.messageListeners.push(fn as (event: { data: unknown }) => void);
  }
  removeEventListener(type: string, fn: (event: never) => void): void {
    if (type === "error")
      this.errorListeners = this.errorListeners.filter((f) => f !== fn);
    if (type === "message")
      this.messageListeners = this.messageListeners.filter((f) => f !== fn);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }

  /**
   * Deliver one message the way a real `Worker` does: the durable
   * `addEventListener("message")` registered at construction first, then the
   * per-job `onmessage =` assigned later. Same ordering rule as `emitError`.
   */
  private deliver(data: unknown): void {
    const event = { data };
    for (const fn of [...this.messageListeners]) fn(event);
    this.onmessage?.(event);
  }

  /** The worker's script has run (#192). Posted once, before any job. */
  emitReady(): void {
    this.deliver({ kind: "ready" });
  }
  /** The worker answers a job successfully. */
  emitDone(mp3: ArrayBuffer): void {
    this.deliver({ kind: "done", mp3 });
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
  /** A liveness heartbeat (#166): no result, but the worker's code RAN. */
  emitProgress(fraction: number): void {
    this.deliver({ kind: "progress", fraction });
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

/**
 * A `document` stand-in: Node has none, so freeze/resume is driven by hand.
 * The same helper `encoder-deadline.test.ts` uses for the stall timer, because
 * the handshake window now answers to the same rule (George R2 P2).
 */
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

/** The n-th constructed worker, asserting it exists. */
const nth = (n: number): FakeWorker => {
  const worker = FakeWorker.instances[n];
  if (!worker) throw new Error(`expected a FakeWorker #${n}, found none`);
  return worker;
};

type Codec = typeof import("@/hooks/mp3-codec");
let withEncoder: Codec["withEncoder"];
let warmEncoder: Codec["warmEncoder"];
let EncoderStalledError: Codec["EncoderStalledError"];
let EncoderFailedError: Codec["EncoderFailedError"];
let encoderHealth: Codec["encoderHealth"];
let TIMEOUT: number;
let READY_TIMEOUT: number;

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  FakeWorker.throwOnUrl = new Set();
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const mod = await import("@/hooks/mp3-codec");
  withEncoder = mod.withEncoder;
  warmEncoder = mod.warmEncoder;
  EncoderStalledError = mod.EncoderStalledError;
  EncoderFailedError = mod.EncoderFailedError;
  encoderHealth = mod.encoderHealth;
  TIMEOUT = mod.ENCODER_SILENCE_TIMEOUT_MS;
  READY_TIMEOUT = mod.ENCODER_READY_TIMEOUT_MS;
});

afterEach(() => {
  delete (globalThis as { Worker?: unknown }).Worker;
  delete (globalThis as { document?: unknown }).document;
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

  it("builds no worker for a job aborted after it took the lane", async () => {
    // `untilSettled` already rejects a job whose signal was aborted BEFORE it
    // asked for the lane, so that case proves nothing about this module. The
    // real one is the job that took the lane, did its own awaits — the sweep
    // loads a clip, a share gathers a chapter — and only then calls
    // `encodeMp3`, with the share menu closed somewhere in between. That abort
    // is never re-delivered, so `encodeInWorker` has to ask.
    const controller = new AbortController();
    const p = withEncoder(controller.signal, (codec) => {
      controller.abort();
      return codec.encodeMp3(Int16Array.of(1));
    });
    await expect(p).rejects.toBeInstanceOf(DOMException);
    // What distinguishes the entry check from `runEncodeOnWorker`'s: that one
    // would also have rejected this job, but a worker would exist by then.
    expect(FakeWorker.instances).toEqual([]);
  });

  it("never posts PCM for a job whose signal already aborted", async () => {
    warmEncoder();
    const warmed = nth(0);

    // `runEncodeOnWorker` only ever LISTENED for an abort, and an abort that has
    // already fired is not delivered again (George R2 P3). The entry check in
    // `encodeInWorker` runs a handshake earlier than this, so the two are not
    // the same moment — and `withEncoder` reaches the codec a microtask after
    // the caller, which is enough for a menu to close.
    const controller = new AbortController();
    controller.abort();
    await expect(encode(Int16Array.of(1), controller.signal)).rejects.toThrow();

    // The buffer never went anywhere, and the warm worker is untouched.
    expect(warmed.posted).toEqual([]);
    expect(warmed.terminated).toBe(false);
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

  /**
   * Let an encode through #192's `ready` handshake.
   *
   * An UNPROVEN blob-built worker is not given PCM until it has answered, so a
   * test driving the first encode on one has to say `ready` first — exactly as
   * `mp3.worker.ts` does at the foot of its module. A chunk-built or already
   * proven worker never waits, and calling this on one is harmless.
   */
  const handshake = async (worker: FakeWorker): Promise<void> => {
    await flush();
    worker.emitReady();
    await flush();
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
    await handshake(nth(1));
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("builds the blob worker CLASSIC and the chunk worker as a module", async () => {
    await warmWithSnapshot();
    // The dev chunk is a real ES module with live imports, so the chunk URL
    // needs `{ type: "module" }`...
    expect(nth(0).options).toEqual({ type: "module" });

    const controller = new AbortController();
    const p = encode(Int16Array.of(1), controller.signal);
    await flush();
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);

    // ...while the snapshot is production-only and the production chunk is a
    // zero-import IIFE, so the blob is constructed with no options at all
    // (George R1 P1). `{ type: "module" }` there asks the platform to parse a
    // blob as an ES module for no benefit.
    expect(nth(1).url).toBe(BLOB_URL);
    expect(nth(1).options).toBeUndefined();
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
    await handshake(nth(1));
    nth(1).emitDone(new Uint8Array([2]).buffer);
    await expect(ok).resolves.toBeInstanceOf(Uint8Array);

    // A later crash is an OOM mid-encode, not a bad snapshot. Throwing the
    // snapshot away here would re-expose #192 after one ordinary crash.
    const p = encode(Int16Array.of(3));
    await flush();
    nth(1).emitError(new Error("out of memory"));
    await expect(p).rejects.toThrow("out of memory");
    expect(revoked).toEqual([]);

    // AND THE REPLACEMENT FAILS TOO, before it has answered anything (George R1
    // P2-2). This is the case that made proof-on-the-handle wrong: the device is
    // still under memory pressure, so the worker rebuilt from the blob dies on
    // load. Proof belongs to the BLOB, which has already been observed running,
    // so this must not revoke it — the alternative is falling back to a chunk
    // URL that a service-worker update deleted, i.e. #192 re-opened by the very
    // guard that closes it.
    const p2 = encode(Int16Array.of(4));
    await flush();
    expect(nth(2).url).toBe(BLOB_URL);
    nth(2).emitError(new Error("out of memory again"));
    await expect(p2).rejects.toThrow("out of memory again");
    expect(revoked).toEqual([]);

    // Still the blob, and it still works once the device recovers.
    const p3 = encode(Int16Array.of(5));
    await flush();
    expect(nth(3).url).toBe(BLOB_URL);
    nth(3).emitDone(new Uint8Array([5]).buffer);
    await expect(p3).resolves.toBeInstanceOf(Uint8Array);
  });

  it("falls back to the chunk URL when the platform refuses to construct a blob worker", async () => {
    await warmWithSnapshot();
    // A CSP with `worker-src 'self'`, or a WebView that throws on `blob:`. This
    // throw is SYNCHRONOUS, so the durable `error` listener never sees it — and
    // before the retry, `snapshotUrl` stayed set and every later construction
    // threw on the same blob while the chunk URL went untried (George R1 P2-3).
    FakeWorker.throwOnUrl.add(BLOB_URL);

    const controller = new AbortController();
    const p = encode(Int16Array.of(1), controller.signal);
    await flush();
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);

    // The re-warm tried the blob, was refused, discarded it, and built from the
    // chunk — inside one `encoderWorker()` call, so even `warmEncoder`'s
    // swallowing try/catch never saw a throw.
    expect(revoked).toEqual([BLOB_URL]);
    expect(isChunkUrl(nth(2).url)).toBe(true);

    const p2 = encode(Int16Array.of(2));
    await flush();
    nth(2).emitDone(new Uint8Array([2]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });
});

/**
 * The `ready` HANDSHAKE (#192 × #166) — the second way a bad snapshot shows
 * itself, and the reason it now costs nobody an encode.
 *
 * The guard #192 shipped judges one signal: an `error` event from a
 * snapshot-built worker that has never answered. #166's silence deadline landed
 * in between and added another failure mode to the same worker — source that
 * LOADS and then answers nothing errors never. Two things followed, and both
 * were wrong. Every rebuild came from the same mute blob, each encode burning a
 * full `ENCODER_SILENCE_TIMEOUT_MS`; and the encode that discovered it was the
 * one that died for it, its PCM already transferred into a worker that was about
 * to be terminated, reported to the Finished sweep as a wedged encoder.
 *
 * `mp3.worker.ts` now posts `ready` when its script has run, and an unproven
 * blob-built worker is not given a chapter's PCM until it has. A blob that never
 * answers is discarded and the job re-run on a chunk-built worker in the same
 * turn, so the caller never learns it happened.
 *
 * Fake timers, like `encoder-deadline.test.ts` — the deadlines are seconds and
 * no suite waits them out. Node has no `document`, so the page counts as visible
 * and `onStall` is free to judge, which is the state under test.
 */
describe("the ready handshake on an unproven blob (#192 × #166)", () => {
  beforeEach(() => {
    stubSnapshotEnvironment();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Let `withEncoder`'s microtask chain, and the fetch's, run to completion. */
  const microtasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /**
   * Warm, land the snapshot, then force the abort-driven REBUILD — so the live
   * worker (index 1) is the blob's, unproven, which is the one under test.
   */
  const rebuildFromSnapshot = async (): Promise<FakeWorker> => {
    warmEncoder();
    chunkFetch.land("/* the built worker chunk */");
    await microtasks();

    const controller = new AbortController();
    const aborted = encode(Int16Array.of(1), controller.signal);
    await microtasks();
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(DOMException);

    expect(nth(1).url).toBe(BLOB_URL);
    return nth(1);
  };

  it("hands no PCM to an unproven blob worker until it says ready", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const p = encode(Int16Array.of(2));
    await microtasks();
    // The whole point of the handshake: the chapter's PCM is still on this
    // thread, so a blob that turns out not to run costs nothing.
    expect(blobWorker.posted).toEqual([]);

    blobWorker.emitReady();
    await microtasks();
    expect(blobWorker.posted).toHaveLength(1);

    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    // No fallback happened: one ready, one job, one worker.
    expect(revoked).toEqual([]);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("spends both silent windows on the SAME handle, never restarting its clock", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const p = encode(Int16Array.of(2));
    await microtasks();
    expect(blobWorker.waitingForReady).toBe(true);

    // Strike one. The handle may be merely SLOW rather than dead — evaluating
    // ~170 kB of lamejs on a throttled WebView, which is the case
    // `SNAPSHOT_MUTE_STRIKES` is written for. Terminating it here and building a
    // fresh blob would throw away exactly the progress the second window exists
    // to wait for, and the replacement would start from zero: two windows that
    // cannot add up (George R4 P2). So the handle LIVES, and the next window is
    // its second, not another worker's first.
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    expect(blobWorker.terminated).toBe(false);
    expect(blobWorker.waitingForReady).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    // Still no PCM, and still no verdict on the blob.
    expect(blobWorker.posted).toEqual([]);
    expect(revoked).toEqual([]);

    // It answers inside the second window, on the budget it accumulated.
    blobWorker.emitReady();
    await microtasks();
    expect(blobWorker.posted).toHaveLength(1);
    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    // And no worker was ever built to replace it.
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("a SLOW blob costs the job nothing, even once the chunk URL is gone", async () => {
    // George R3 P2's scenario, end to end and in the environment it is about,
    // with George R4 P2's timing. The page has lived across a deploy, so
    // `cleanupOutdatedCaches` has already deleted the hashed chunk; here that is
    // a construction the stub refuses. (A real purged URL fails asynchronously
    // instead — either way the job that lands there has already transferred its
    // PCM and is lost.) The blob is not dead, only slower than one window.
    const blobWorker = await rebuildFromSnapshot();
    FakeWorker.throwOnUrl.add(String(nth(0).url));

    const p = encode(Int16Array.of(2));
    await microtasks();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();

    // Halfway through its second window the worker finishes evaluating and
    // answers — which it could not have done if the first window had killed it.
    expect(blobWorker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT / 2);
    blobWorker.emitReady();
    await microtasks();
    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);

    // Nothing was ever built from the purged URL after the warm worker that
    // predates the deploy, the snapshot is intact for the next encode, and the
    // Books shelf was never told this phone cannot make recordings smaller.
    expect(FakeWorker.instances.slice(1).map((w) => String(w.url))).toEqual([
      BLOB_URL,
    ]);
    expect(revoked).toEqual([]);
    expect(encoderHealth()).toBe("ok");
  });

  it("throws the snapshot away only after a SECOND visible silent window", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const p = encode(Int16Array.of(2));
    await microtasks();

    // Strike one: the handle is kept, and so is the snapshot.
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    expect(blobWorker.terminated).toBe(false);
    expect(revoked).toEqual([]);

    // Strike two, on the SAME handle and the same `encodeMp3` call. Two full
    // visible windows of silence is the evidence, and only now is the blob
    // written off — which is also the only thing that lets a construction go to
    // the chunk URL a deploy may have purged (George R3 P2).
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    expect(blobWorker.terminated).toBe(true);
    expect(revoked).toEqual([BLOB_URL]);
    expect(isChunkUrl(nth(2).url)).toBe(true);

    nth(2).emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });

  it("does not count the handshake window while the page is HIDDEN", async () => {
    const { setHidden } = installFakeDocument();
    const blobWorker = await rebuildFromSnapshot();

    const p = encode(Int16Array.of(2));
    await microtasks();

    // The translator puts the phone down while the blob is still evaluating
    // lamejs — which is exactly when this window is most likely to be open, the
    // launch sweep having started on a worker a cancelled Share just re-warmed.
    // A frozen worker is not a mute one, and `onStall` exists in this module for
    // the same reason (George R2 P2).
    setHidden(true);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT * 5);
    await microtasks();
    expect(revoked).toEqual([]);
    expect(blobWorker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(2);

    // It comes back and answers: no fallback ever happened, and the blob is the
    // worker that encodes.
    setHidden(false);
    blobWorker.emitReady();
    await microtasks();
    expect(blobWorker.posted).toHaveLength(1);
    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });

  it("grants one fresh window after a freeze, even if the overdue timer runs first", async () => {
    const { doc, dispatchVisibility } = installFakeDocument();
    const blobWorker = await rebuildFromSnapshot();

    const p = encode(Int16Array.of(2));
    await microtasks();

    // Hide fires normally, latching that a freeze may span this window.
    doc.hidden = true;
    dispatchVisibility();

    // The freeze ends: the platform flips `hidden` back BEFORE running the
    // queued visibilitychange handler, and the overdue timer runs in between.
    doc.hidden = false;
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    // It must not have judged the un-measurable silence it just woke up to.
    expect(revoked).toEqual([]);
    expect(blobWorker.terminated).toBe(false);

    // And it must not have counted a STRIKE for it either, which is the half of
    // this claim the round-5 loop made invisible: a strike now also re-arms on
    // the same handle, so "still alive, snapshot still here" is true whether the
    // freeze was forgiven or charged. The difference is how much budget is left.
    // One more full VISIBLE window is therefore strike one, and strike one never
    // discards — if the freeze had been charged, this would be strike two and
    // the blob would be gone.
    dispatchVisibility();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    expect(revoked).toEqual([]);
    expect(blobWorker.terminated).toBe(false);

    blobWorker.emitReady();
    await microtasks();
    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
  });

  it("does not post PCM when an abort lands while ready is winning the race", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const controller = new AbortController();
    const p = encode(Int16Array.of(2), controller.signal);
    await microtasks();
    // The job really is parked in the handshake — not still queued on the
    // encoder lane, which is how a test like this passes without ever running
    // the line it names.
    expect(blobWorker.waitingForReady).toBe(true);

    // `ready` settles the handshake, which detaches its abort listener; the
    // abort then lands in the gap before the encode starts. Nothing is
    // listening for it any more, so only an explicit re-check catches it
    // (George R2 P3) — and without that the chapter's PCM goes into the worker
    // and holds the app's single lane for a share whose menu is closed.
    blobWorker.emitReady();
    controller.abort();
    await microtasks();

    await expect(p).rejects.toBeInstanceOf(DOMException);
    expect(blobWorker.posted).toEqual([]);
  });

  it("stops waiting when an abort lands BETWEEN two handshake windows", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const controller = new AbortController();
    const p = encode(Int16Array.of(2), controller.signal);
    await microtasks();
    expect(blobWorker.waitingForReady).toBe(true);

    // Run the first window's timer SYNCHRONOUSLY, so the handshake detaches —
    // and takes its abort listener with it — before the loop's continuation has
    // run. `waitingForReady` going false is what says we are standing in that
    // gap rather than before or after it.
    vi.advanceTimersByTime(READY_TIMEOUT);
    expect(blobWorker.waitingForReady).toBe(false);

    // The abort lands there, with nothing listening for it. Only the next
    // `awaitWorkerReady` ASKING can catch it (George R4 P3-3); without that the
    // job waits out a second full window, and then encodes, for a share whose
    // menu is already closed.
    controller.abort();
    await microtasks();

    await expect(p).rejects.toBeInstanceOf(DOMException);
    expect(blobWorker.posted).toEqual([]);
    // And an abort still judges nothing about the blob.
    expect(revoked).toEqual([]);
  });

  it("never latches encoder health for a mute blob", async () => {
    await rebuildFromSnapshot();
    expect(encoderHealth()).toBe("ok");

    const p = encode(Int16Array.of(2));
    await microtasks();
    // Both windows on the one handle, then the fall-through to the chunk:
    // none of it is a health event.
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();

    // A stall verdict would have set this to `failing` on the spot — the
    // threshold is bypassed for a stall — putting "this phone cannot make
    // recordings smaller" on the Books shelf because a SNAPSHOT did not run,
    // while the chunk worker that replaced it is healthy (George R1 P2-4).
    expect(encoderHealth()).toBe("ok");

    nth(2).emitDone(new Uint8Array([2]).buffer);
    await expect(p).resolves.toBeInstanceOf(Uint8Array);
    expect(encoderHealth()).toBe("ok");
  });

  it("waits only once: a proven blob is never held up again", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const first = encode(Int16Array.of(2));
    await microtasks();
    blobWorker.emitReady();
    await microtasks();
    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(first).resolves.toBeInstanceOf(Uint8Array);

    // A crash drops the handle; the rebuild is the blob's again, and unproven as
    // a HANDLE — but the blob itself has been observed running, so no second
    // handshake. Without proof living on the snapshot this encode would sit
    // waiting for a `ready` on every rebuild for the life of the page.
    const p = encode(Int16Array.of(3));
    await microtasks();
    blobWorker.emitError(new Error("out of memory"));
    await expect(p).rejects.toThrow("out of memory");

    const p2 = encode(Int16Array.of(4));
    await microtasks();
    expect(nth(2).url).toBe(BLOB_URL);
    expect(nth(2).posted).toHaveLength(1);
    nth(2).emitDone(new Uint8Array([4]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("still reports a real stall on a PROVEN blob as a stall", async () => {
    const blobWorker = await rebuildFromSnapshot();

    const ok = encode(Int16Array.of(2));
    await microtasks();
    blobWorker.emitReady();
    await microtasks();
    blobWorker.emitDone(new Uint8Array([2]).buffer);
    await expect(ok).resolves.toBeInstanceOf(Uint8Array);

    // Now it goes quiet mid-encode: a worker killed under memory pressure, which
    // IS #166's condition. The snapshot is not the suspect and must survive.
    const p = encode(Int16Array.of(3));
    await microtasks();
    const rejection = expect(p).rejects.toBeInstanceOf(EncoderStalledError);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await rejection;
    expect(revoked).toEqual([]);
    expect(nth(2).url).toBe(BLOB_URL);
  });

  it("does not judge the snapshot when an abort lands during the handshake", async () => {
    const blobWorker = await rebuildFromSnapshot();

    // The blob has answered nothing and we cancel while it is still being
    // waited on. An abort is us stopping the job, not evidence against the blob.
    const controller = new AbortController();
    const p = encode(Int16Array.of(2), controller.signal);
    await microtasks();
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(DOMException);

    // Nothing was revoked, and the worker is left WARM rather than terminated:
    // no PCM was ever handed over, so there is no in-flight encode for
    // `terminate()` to stop — the one thing an abort exists to do.
    expect(revoked).toEqual([]);
    expect(blobWorker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(2);

    // And it is still usable: the next encode handshakes and runs on it.
    const p2 = encode(Int16Array.of(3));
    await microtasks();
    blobWorker.emitReady();
    await microtasks();
    blobWorker.emitDone(new Uint8Array([3]).buffer);
    await expect(p2).resolves.toBeInstanceOf(Uint8Array);
  });

  it("an ordinary failure, not a stall, if the fallback worker also fails", async () => {
    await rebuildFromSnapshot();

    const p = encode(Int16Array.of(2));
    await microtasks();
    // Two silent windows on the one handle are what it takes to give up on the
    // blob at all.
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
    await microtasks();

    // The chunk URL is gone too — the purge this whole mechanism is about. The
    // job fails, but as an ordinary encode failure the sweep can step past, not
    // as the wedged-encoder verdict that ends its run.
    expect(isChunkUrl(nth(2).url)).toBe(true);
    const rejection = expect(p).rejects.toBeInstanceOf(EncoderFailedError);
    nth(2).emitError(new Error("chunk failed to load"));
    await rejection;
    await expect(p).rejects.not.toBeInstanceOf(EncoderStalledError);
  });
});
