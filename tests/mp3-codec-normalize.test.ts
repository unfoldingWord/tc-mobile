import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NORMALIZE_STAGES, normalizePcm } from "@/lib/audio/loudness";
import { speechLikePcm } from "@/lib/phone-check/speech";
import type { ClipProcessing } from "@/types/audio";

/**
 * The Finished chain's WIRE (#1433 step 3), both ends, in Node.
 *
 * `codec.normalizePcm` sends a clip's PCM to the MP3 worker as a versioned
 * `normalize` request and gets the processed PCM back with its record. It
 * runs under the same silence deadline an encode does, so the worker must
 * heartbeat through a long chain or the client would judge it stalled. The
 * client half runs against a stubbed `globalThis.Worker` (the seam
 * `tests/mp3-codec-dsp-bench.test.ts` uses); the worker half is imported with
 * its worker-scope globals stubbed and its handler driven directly.
 */

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  posted: Array<{ message: unknown; transfer: unknown }> = [];
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

const RECORD: ClipProcessing = {
  stages: NORMALIZE_STAGES,
  measuredLufs: -30,
  measuredTruePeakDbtp: -12,
  appliedGainDb: 11,
};

type Codec = typeof import("@/hooks/mp3-codec");
let codecModule: Codec;

function normalize(samples: Int16Array) {
  const settled = codecModule
    .withEncoder(undefined, (codec) => codec.normalizePcm!(samples, 44_100))
    .then(
      (value) => value,
      (error: unknown) => error
    );
  return settled;
}

describe("codec.normalizePcm — the client half (#1433)", () => {
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

  it("transfers the PCM in one versioned request and resolves with the processed PCM and its record", async () => {
    const samples = Int16Array.of(1, 2, 3);
    const buffer = samples.buffer;
    const settled = normalize(samples);
    await microtasks();
    const posted = live().posted[0]!;
    expect(posted.message).toEqual({
      v: 1,
      kind: "normalize",
      sampleRate: 44_100,
      buffer,
      byteOffset: 0,
      length: 3,
    });
    expect(posted.transfer).toEqual([buffer]);
    live().emit({
      kind: "normalized",
      buffer: Int16Array.of(4, 5, 6).buffer,
      byteOffset: 0,
      length: 3,
      processing: RECORD,
    });
    const result = (await settled) as {
      samples: Int16Array;
      processing: ClipProcessing;
    };
    expect(Array.from(result.samples)).toEqual([4, 5, 6]);
    expect(result.processing).toEqual(RECORD);
  });

  it("a heartbeat during the chain resets the silence window", async () => {
    let done = false;
    const settled = normalize(Int16Array.of(1));
    void settled.then(() => (done = true));
    await microtasks();
    const almost = codecModule.ENCODER_SILENCE_TIMEOUT_MS - 1;
    await vi.advanceTimersByTimeAsync(almost);
    live().emit({ kind: "progress", fraction: 0.5 });
    await vi.advanceTimersByTimeAsync(almost);
    expect(done).toBe(false);
    expect(FakeWorker.instances[0]!.terminated).toBe(false);
    live().emit({
      kind: "normalized",
      buffer: Int16Array.of(9).buffer,
      byteOffset: 0,
      length: 1,
      processing: RECORD,
    });
    expect(await settled).toMatchObject({ processing: RECORD });
  });

  it("a chain silent past the deadline is a stall", async () => {
    const settled = normalize(Int16Array.of(1));
    await microtasks();
    await vi.advanceTimersByTimeAsync(
      codecModule.ENCODER_SILENCE_TIMEOUT_MS + 1
    );
    expect(await settled).toBeInstanceOf(codecModule.EncoderStalledError);
  });

  it("a normalize answered with an MP3 is a typed encoder failure", async () => {
    const settled = normalize(Int16Array.of(1));
    await microtasks();
    live().emit({ kind: "done", mp3: Uint8Array.of(1).buffer });
    expect(await settled).toBeInstanceOf(codecModule.EncoderFailedError);
  });
});

describe("mp3.worker — the normalize half (#1433)", () => {
  let handler: (event: { data: unknown }) => void;
  let posted: Array<{ kind: string } & Record<string, unknown>>;

  beforeEach(async () => {
    vi.resetModules();
    posted = [];
    vi.stubGlobal(
      "addEventListener",
      (_: string, fn: (event: { data: unknown }) => void) => (handler = fn)
    );
    vi.stubGlobal("postMessage", (message: never) => posted.push(message));
    await import("@/hooks/mp3.worker");
    posted.length = 0; // the module's own `ready`
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("heartbeats through a long chain, then answers once with the processed PCM and the record", () => {
    // A clock that moves a second per read: every throttled beat is due.
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 1000));
    const samples = speechLikePcm(4, 44_100);
    const original = Int16Array.from(samples);
    handler({
      data: {
        v: 1,
        kind: "normalize",
        sampleRate: 44_100,
        buffer: samples.buffer,
        byteOffset: 0,
        length: samples.length,
      },
    });
    const beats = posted.filter((m) => m.kind === "progress");
    // Four one-second chunks per pass, two passes: a beat for each.
    expect(beats).toHaveLength(8);
    const answers = posted.filter((m) => m.kind !== "progress");
    expect(answers).toHaveLength(1);
    expect(posted.at(-1)!.kind).toBe("normalized");
    const answer = answers[0] as unknown as {
      buffer: ArrayBuffer;
      byteOffset: number;
      length: number;
      processing: ClipProcessing;
    };
    expect(answer.length).toBe(original.length);
    expect(answer.processing.stages).toEqual(NORMALIZE_STAGES);
    const out = new Int16Array(answer.buffer, answer.byteOffset, answer.length);
    // Exactly the chain's own output over the same input, run here.
    const expected = Int16Array.from(original);
    expect(answer.processing).toEqual(normalizePcm(expected, 44_100));
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it("refuses an unknown version with an error answer", () => {
    handler({
      data: {
        v: 2,
        kind: "normalize",
        sampleRate: 44_100,
        buffer: new ArrayBuffer(2),
        byteOffset: 0,
        length: 1,
      },
    });
    expect(posted).toEqual([
      { kind: "error", message: expect.stringMatching(/version: 2/) },
    ]);
  });
});
