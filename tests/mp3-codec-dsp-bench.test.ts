import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DspBenchResult } from "@/types/audio";

/**
 * The DSP benchmark's WIRE (#1433 step 1, task T2), both ends, in Node.
 *
 * The benchmark runs in the MP3 worker, the lane the planned loudness chain
 * will run in, but it is not an encode: it has its own request
 * (`{ v: 1, kind: "dsp-bench" }`) and its own answers (`bench-result`,
 * `bench-error`), and none of them may move the encoder's health. A phone whose
 * benchmark throws three times must not be told its working encoder is broken.
 *
 * The client half (`hooks/mp3-codec.ts`, `codec.benchDsp`) runs against a
 * stubbed `globalThis.Worker`, the seam `tests/mp3-codec-stream.test.ts` uses.
 * The worker half (`hooks/mp3.worker.ts`) is imported with its two worker-scope
 * globals stubbed and its handler driven directly. That the real thread, the
 * blob snapshot and the real clock do the same is the browser's to show, not
 * this file's, and no figure here says how fast anything is.
 */

type ErrorEventish = { error?: Error; message?: string };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: ErrorEventish) => void) | null = null;
  terminated = false;
  posted: Array<{ message: unknown; transfer: unknown }> = [];
  private errorListeners: ((event: ErrorEventish) => void)[] = [];
  private messageListeners: ((event: { data: unknown }) => void)[] = [];

  constructor(public url: string | URL) {
    FakeWorker.instances.push(this);
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
  postMessage(message: unknown, transfer?: unknown): void {
    this.posted.push({ message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: unknown): void {
    const event = { data };
    for (const fn of [...this.messageListeners]) fn(event);
    this.onmessage?.(event);
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

const RESULT: DspBenchResult = {
  audioSeconds: 60,
  chunks: 60,
  measureMs: 1200,
  applyMs: 1500,
  stageMs: {
    highPass: 400,
    kWeight: 500,
    truePeak: 300,
    gain: 50,
    limiter: 1450,
  },
  slowestChunkMs: 80,
  workingSetBytes: 1_234_567,
  checksum: 0xdead_beef,
  loudnessLufs: -23.4,
  truePeakDbtp: -6.2,
  gainDb: 4.4,
  limiterMaxReductionDb: 0.3,
};

/**
 * Start `job` and let it reach the worker. The settlement comes back in a
 * box: a bare promise returned from an async function would be adopted, and
 * the caller would wait for the very job it means to settle by hand.
 */
async function start<T>(
  job: Promise<T>
): Promise<{ settled: Promise<unknown> }> {
  const settled = job.then(
    (value) => value,
    (error: unknown) => error
  );
  await microtasks();
  return { settled };
}

type Codec = typeof import("@/hooks/mp3-codec");
let codecModule: Codec;

const bench = (signal?: AbortSignal, seconds = 60) =>
  codecModule.withEncoder(signal, (codec) => codec.benchDsp!(seconds));
const encode = () =>
  codecModule.withEncoder(undefined, (codec) =>
    codec.encodeMp3(Int16Array.of(1))
  );

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  codecModule = await import("@/hooks/mp3-codec");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { Worker?: unknown }).Worker;
});

describe("codec.benchDsp — the client half (#1433 T2)", () => {
  it("posts one versioned request that carries no PCM, and resolves with the worker's result", async () => {
    const outcome = await start(bench(undefined, 60));
    const posted = live().posted[0]!;
    expect(posted.message).toEqual({ v: 1, kind: "dsp-bench", seconds: 60 });
    expect(posted.transfer).toEqual([]);
    live().emit({ kind: "bench-result", result: RESULT });
    expect(await outcome.settled).toEqual(RESULT);
  });

  it("three failing benches in a row leave the encoder's health at ok", async () => {
    for (let i = 0; i < codecModule.ENCODER_FAILURE_THRESHOLD; i++) {
      const outcome = await start(bench());
      live().emit({ kind: "bench-error", message: "kernel blew up" });
      const error = await outcome.settled;
      expect(error).toBeInstanceOf(codecModule.DspBenchFailedError);
      expect((error as Error).message).toMatch(/kernel blew up/);
    }
    expect(codecModule.encoderHealth()).toBe("ok");
  });

  it("a bench the worker refuses with an error answer (a version mismatch) is not an encode failure either", async () => {
    for (let i = 0; i < codecModule.ENCODER_FAILURE_THRESHOLD; i++) {
      const outcome = await start(bench());
      live().emit({ kind: "error", message: "Unsupported version: 2" });
      expect(await outcome.settled).toBeInstanceOf(
        codecModule.DspBenchFailedError
      );
    }
    expect(codecModule.encoderHealth()).toBe("ok");
  });

  it("a successful bench does not clear a standing encode failure count", async () => {
    const fail = async () => {
      const outcome = await start(encode());
      live().emit({ kind: "error", message: "lame broke" });
      await outcome.settled;
    };
    await fail();
    await fail();
    const outcome = await start(bench());
    live().emit({ kind: "bench-result", result: RESULT });
    await outcome.settled;
    // Two strikes stand; one more is the third. A bench that cleared the count
    // would leave this at ok.
    await fail();
    expect(codecModule.encoderHealth()).toBe("failing");
  });

  it("a bench answered with an encode's done is the bench's failure and does not clear a standing encode failure count", async () => {
    const fail = async () => {
      const outcome = await start(encode());
      live().emit({ kind: "error", message: "lame broke" });
      await outcome.settled;
    };
    await fail();
    await fail();
    const outcome = await start(bench());
    live().emit({ kind: "done", mp3: Uint8Array.of(1).buffer });
    expect(await outcome.settled).toBeInstanceOf(
      codecModule.DspBenchFailedError
    );
    await fail();
    expect(codecModule.encoderHealth()).toBe("failing");
  });

  it("an encode answered with a bench-result counts as an encode failure", async () => {
    for (let i = 0; i < codecModule.ENCODER_FAILURE_THRESHOLD; i++) {
      const outcome = await start(encode());
      live().emit({ kind: "bench-result", result: RESULT });
      expect(await outcome.settled).toBeInstanceOf(
        codecModule.EncoderFailedError
      );
    }
    expect(codecModule.encoderHealth()).toBe("failing");
  });

  it("a bench that stays silent past the deadline is a stall: the lane is released and the next encode runs", async () => {
    const outcome = await start(bench());
    await vi.advanceTimersByTimeAsync(
      codecModule.ENCODER_SILENCE_TIMEOUT_MS + 1
    );
    expect(await outcome.settled).toBeInstanceOf(
      codecModule.EncoderStalledError
    );
    expect(FakeWorker.instances[0]!.terminated).toBe(true);

    const next = await start(encode());
    live().emit({ kind: "done", mp3: Uint8Array.of(7).buffer });
    expect(await next.settled).toEqual(Uint8Array.of(7));
  });

  it("a heartbeat during the bench resets the silence window", async () => {
    let settled = false;
    const outcome = await start(bench());
    void outcome.settled.then(() => (settled = true));
    const almost = codecModule.ENCODER_SILENCE_TIMEOUT_MS - 1;
    await vi.advanceTimersByTimeAsync(almost);
    live().emit({ kind: "progress", fraction: 0.5 });
    await vi.advanceTimersByTimeAsync(almost);
    expect(settled).toBe(false);
    expect(FakeWorker.instances[0]!.terminated).toBe(false);
    live().emit({ kind: "bench-result", result: RESULT });
    expect(await outcome.settled).toEqual(RESULT);
  });

  it("an abort terminates the worker and rejects with the signal's reason", async () => {
    const controller = new AbortController();
    const outcome = await start(bench(controller.signal));
    const reason = new Error("phone check closed");
    controller.abort(reason);
    expect(await outcome.settled).toBe(reason);
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    expect(codecModule.encoderHealth()).toBe("ok");
  });

  it("a normal encode right after a bench still works on the same warm worker", async () => {
    const outcome = await start(bench());
    live().emit({ kind: "bench-result", result: RESULT });
    await outcome.settled;
    const next = await start(encode());
    expect(FakeWorker.instances).toHaveLength(1);
    live().emit({ kind: "done", mp3: Uint8Array.of(3).buffer });
    expect(await next.settled).toEqual(Uint8Array.of(3));
  });
});

describe("mp3.worker — the bench half (#1433 T2)", () => {
  let handler: (event: { data: unknown }) => void;
  let posted: unknown[];

  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    posted = [];
    vi.stubGlobal(
      "addEventListener",
      (_: string, fn: (event: { data: unknown }) => void) => (handler = fn)
    );
    vi.stubGlobal("postMessage", (message: unknown) => posted.push(message));
    await import("@/hooks/mp3.worker");
    posted.length = 0; // the module's own `ready`
  });

  afterEach(() => vi.unstubAllGlobals());

  const send = (data: unknown) => handler({ data });

  it("builds the speech itself and answers one bench-result with finite figures", () => {
    send({ v: 1, kind: "dsp-bench", seconds: 2 });
    // The heartbeat the client's silence deadline lives on: at least one,
    // carrying a fraction of the whole run.
    const beats = posted.filter(
      (m) => (m as { kind: string }).kind === "progress"
    ) as { fraction: number }[];
    expect(beats.length).toBeGreaterThan(0);
    for (const beat of beats) {
      expect(beat.fraction).toBeGreaterThan(0);
      expect(beat.fraction).toBeLessThanOrEqual(1);
    }
    const answers = posted.filter(
      (m) => (m as { kind: string }).kind !== "progress"
    );
    expect(answers).toHaveLength(1);
    const answer = answers[0] as { kind: string; result: DspBenchResult };
    expect(answer.kind).toBe("bench-result");
    expect(answer.result.audioSeconds).toBeCloseTo(2, 3);
    expect(answer.result.chunks).toBe(2);
    expect(Number.isFinite(answer.result.measureMs)).toBe(true);
    expect(Number.isFinite(answer.result.applyMs)).toBe(true);
    expect(answer.result.checksum).toBeGreaterThan(0);
  });

  it("answers a length it cannot run with a bench-error, not an error", () => {
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "60"])
      send({ v: 1, kind: "dsp-bench", seconds });
    expect(posted).toHaveLength(5);
    for (const answer of posted)
      expect(answer).toEqual({
        kind: "bench-error",
        message: expect.stringMatching(/seconds/),
      });
  });

  it("refuses an unknown version with an error answer", () => {
    send({ v: 2, kind: "dsp-bench", seconds: 2 });
    expect(posted).toEqual([
      { kind: "error", message: expect.stringMatching(/version: 2/) },
    ]);
  });
});
