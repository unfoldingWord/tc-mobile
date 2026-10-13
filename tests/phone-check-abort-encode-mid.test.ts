import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1379 (from #1384 George r3): an abort DURING the encode, with the PCM
 * already posted to the worker, rejects with the signal's own reason. The
 * rejection is built in the page (`abortReason(signal)`), never carried back
 * from the worker, so no structured clone is involved and identity holds.
 * Without it `isAbortCause` would not recognise a cancel and it would be
 * reported as a probe failure. A stubbed Worker stands in; no thread runs.
 */

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  private messageListeners: ((event: { data: unknown }) => void)[] = [];
  constructor() {
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
  emitReady(): void {
    for (const fn of [...this.messageListeners])
      fn({ data: { kind: "ready" } });
  }
}

type Codec = typeof import("@/hooks/mp3-codec");
type Probes = typeof import("@/hooks/phone-check-probes");
let withEncoder: Codec["withEncoder"];
let isAbortCause: Probes["isAbortCause"];
let settleProbe: Probes["settleProbe"];
let subscribeToFailures: typeof import("@/hooks/report-failure").subscribeToFailures;

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  ({ withEncoder } = await import("@/hooks/mp3-codec"));
  ({ isAbortCause, settleProbe } = await import("@/hooks/phone-check-probes"));
  ({ subscribeToFailures } = await import("@/hooks/report-failure"));
});

afterEach(() => {
  delete (globalThis as { Worker?: unknown }).Worker;
});

/** Start an encode, let the worker become ready, and wait until PCM is posted. */
async function encodeUntilPosted(signal: AbortSignal): Promise<{
  worker: FakeWorker;
  settled: Promise<unknown>;
}> {
  const settled = withEncoder(signal, (codec) =>
    codec.encodeMp3(new Int16Array(8))
  );
  // Observe the rejection before it can be unhandled.
  const outcome = settled.then(
    () => "resolved",
    (cause: unknown) => cause
  );
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
  const worker = FakeWorker.instances[0]!;
  worker.emitReady();
  await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThan(0));
  return { worker, settled: outcome };
}

describe("an abort during the encode", () => {
  it("rejects with the signal's own reason after a no-argument abort", async () => {
    const run = new AbortController();
    const { worker, settled } = await encodeUntilPosted(run.signal);
    run.abort();
    const cause = await settled;
    expect(cause).toBe(run.signal.reason);
    expect(isAbortCause(cause, run.signal)).toBe(true);
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the custom reason after abort(customReason)", async () => {
    const run = new AbortController();
    const { worker, settled } = await encodeUntilPosted(run.signal);
    run.abort(new Error("custom reason"));
    const cause = await settled;
    expect(cause).toBe(run.signal.reason);
    expect(isAbortCause(cause, run.signal)).toBe(true);
    expect(worker.terminated).toBe(true);
  });

  it("is not reported to the failure funnel by settleProbe", async () => {
    const seen: unknown[] = [];
    const off = subscribeToFailures((r) => void seen.push(r));
    const run = new AbortController();
    const outcome = settleProbe(
      () =>
        withEncoder(run.signal, (codec) => codec.encodeMp3(new Int16Array(8))),
      run.signal
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0]!;
    worker.emitReady();
    await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThan(0));
    run.abort();
    expect((await outcome).status).toBe("failed");
    off();
    expect(seen).toHaveLength(0);
  });
});
