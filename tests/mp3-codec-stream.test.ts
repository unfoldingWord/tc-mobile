import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";

/**
 * The streamed encode's WIRE (#1003 part b), both ends, in Node.
 *
 * The client half (`hooks/mp3-codec.ts`, `codec.openMp3Stream`) runs against
 * a stubbed `globalThis.Worker`, the same stand-in shape
 * `tests/mp3-codec.test.ts` uses, so each test decides when the worker
 * answers, errors or dies. What it pins: the stream is additive (the whole
 * encode is untouched and still one message), each step waits for its ack,
 * the stream is bound to the worker that opened it, and abort / error /
 * crash mid-stream end it the way ADR 0009 ends an encode.
 *
 * The worker half (`hooks/mp3.worker.ts`) is imported with its two
 * worker-scope globals stubbed, and its message handler driven directly:
 * that the real handler's streamed bytes equal a whole encode's is a Node
 * fact; that the real thread and the transfer do the same is the harness
 * smoke's (`e2e/browser-boundary-smoke.spec.ts`), not this file's.
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
  /** Thrown, once, by the next `postMessage` — the worker itself stays alive. */
  failNextPost: Error | null = null;
  postMessage(message: unknown, transfer?: unknown): void {
    const failure = this.failNextPost;
    if (failure) {
      this.failNextPost = null;
      throw failure;
    }
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
  emitError(error: Error): void {
    const event: ErrorEventish = { error, message: error.message };
    for (const fn of [...this.errorListeners]) fn(event);
    this.onerror?.(event);
  }
  /** The kinds of message posted so far, in order. */
  kinds(): unknown[] {
    return this.posted.map((p) =>
      typeof p.message === "object" && p.message && "kind" in p.message
        ? (p.message as { kind: unknown }).kind
        : "whole"
    );
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ack = { kind: "stream-ack" };

const nth = (n: number): FakeWorker => {
  const worker = FakeWorker.instances[n];
  if (!worker) throw new Error(`expected a FakeWorker #${n}, found none`);
  return worker;
};

let codecModule: typeof import("@/hooks/mp3-codec");

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  codecModule = await import("@/hooks/mp3-codec");
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { Worker?: unknown }).Worker;
});

/** Open a stream inside a lane turn the test holds until `release`. */
async function openStream(signal?: AbortSignal) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let resolveStream!: (s: import("@/types/audio").Mp3Stream) => void;
  const stream = new Promise<import("@/types/audio").Mp3Stream>(
    (r) => (resolveStream = r)
  );
  const turn = codecModule.withEncoder(signal, async (codec) => {
    const opening = codec.openMp3Stream!();
    await flush();
    nth(0).emit(ack);
    resolveStream(await opening);
    await held;
  });
  return { stream: await stream, release, turn };
}

describe("codec.openMp3Stream — the client half (#1003 b)", () => {
  it("opens, writes each chunk only after the last one's ack, and finishes with the MP3", async () => {
    const { stream, release, turn } = await openStream();
    const worker = nth(0);
    expect(worker.posted[0]!.message).toEqual({ v: 1, kind: "stream-open" });

    const pcm = Int16Array.of(1, 2, 3);
    const writing = stream.write(pcm);
    await flush();
    const chunk = worker.posted[1]!;
    expect(chunk.message).toMatchObject({
      v: 1,
      kind: "stream-chunk",
      byteOffset: 0,
      length: 3,
    });
    // Transferred, not copied: the chapter's PCM is never held twice.
    expect(chunk.transfer).toEqual([pcm.buffer]);
    let written = false;
    void writing.then(() => (written = true));
    await flush();
    expect(written).toBe(false);
    worker.emit(ack);
    await writing;

    const finishing = stream.finish();
    await flush();
    expect(worker.posted[2]!.message).toEqual({ v: 1, kind: "stream-finish" });
    worker.emit({ kind: "done", mp3: Uint8Array.of(9, 8).buffer });
    expect(Array.from(await finishing)).toEqual([9, 8]);

    // After a finish, cancel posts nothing.
    stream.cancel();
    expect(worker.kinds()).toEqual([
      "stream-open",
      "stream-chunk",
      "stream-finish",
    ]);
    expect(codecModule.encoderHealth()).toBe("ok");
    release();
    await turn;
  });

  it("leaves the whole encode exactly as it was: one unversioned message", async () => {
    const encoding = codecModule.withEncoder(undefined, (codec) =>
      codec.encodeMp3(Int16Array.of(1, 2))
    );
    await flush();
    const posted = nth(0).posted[0]!.message;
    expect(posted).toEqual({
      buffer: expect.any(ArrayBuffer),
      byteOffset: 0,
      length: 2,
    });
    expect(posted).not.toHaveProperty("v");
    nth(0).emit({ kind: "done", mp3: Uint8Array.of(1).buffer });
    await expect(encoding).resolves.toBeInstanceOf(Uint8Array);
  });

  it("cancel posts one stream-cancel and nothing after it", async () => {
    const { stream, release, turn } = await openStream();
    stream.cancel();
    stream.cancel();
    expect(nth(0).kinds()).toEqual(["stream-open", "stream-cancel"]);
    await expect(stream.write(Int16Array.of(1))).rejects.toThrow(/closed/);
    release();
    await turn;
  });

  it("a worker crash mid-chunk rejects that write as the encoder's failure, and the stream is closed", async () => {
    const { stream, release, turn } = await openStream();
    const writing = stream.write(Int16Array.of(1));
    await flush();
    nth(0).emitError(new Error("worker ran out of memory"));
    await expect(writing).rejects.toBeInstanceOf(
      codecModule.EncoderFailedError
    );
    await expect(stream.finish()).rejects.toThrow(/closed/);
    // The durable listener dropped the dead handle; cancel has nothing to post.
    stream.cancel();
    expect(nth(0).kinds()).toEqual(["stream-open", "stream-chunk"]);
    release();
    await turn;
  });

  it("an encoder error answer mid-stream rejects with the worker's words and counts against health", async () => {
    // One lane turn per share; a failed step closes that share's stream.
    for (let i = 0; i < codecModule.ENCODER_FAILURE_THRESHOLD; i++) {
      const { stream, release, turn } = await openStream();
      const writing = stream.write(Int16Array.of(1));
      await flush();
      nth(0).emit({ kind: "error", message: "lame broke" });
      await expect(writing).rejects.toThrow(/lame broke/);
      await expect(stream.finish()).rejects.toThrow(/closed/);
      release();
      await turn;
    }
    expect(codecModule.encoderHealth()).toBe("failing");
  });

  it("a chunk whose postMessage throws still lets the live worker's session go: cancel posts stream-cancel (#1132 George R1 #1)", async () => {
    const { stream, release, turn } = await openStream();
    const worker = nth(0);
    worker.failNextPost = new DOMException("detached", "DataCloneError");
    await expect(stream.write(Int16Array.of(1))).rejects.toThrow(/detached/);
    // The message failed, not the worker: it is still the warm one.
    expect(worker.terminated).toBe(false);
    await expect(stream.write(Int16Array.of(2))).rejects.toThrow(/closed/);
    stream.cancel();
    stream.cancel();
    expect(worker.kinds()).toEqual(["stream-open", "stream-cancel"]);
    release();
    await turn;
  });

  it("a worker that died BETWEEN writes is not written to: the next write rejects, and the replacement sees nothing", async () => {
    const { stream, release, turn } = await openStream();
    // Idle between chunks, the worker dies; the durable listener drops it.
    nth(0).emitError(new Error("killed while idle"));
    await expect(stream.write(Int16Array.of(1))).rejects.toThrow(
      /restarted in the middle of a chapter/
    );
    expect(nth(0).kinds()).toEqual(["stream-open"]);
    release();
    await turn;
    // The next job builds a fresh worker, which never heard of the stream.
    const encoding = codecModule.withEncoder(undefined, (codec) =>
      codec.encodeMp3(Int16Array.of(2))
    );
    await flush();
    expect(nth(1).kinds()).toEqual(["whole"]);
    nth(1).emit({ kind: "done", mp3: Uint8Array.of(1).buffer });
    await encoding;
  });

  it("an abort mid-chunk rejects, terminates the worker and re-warms one, as an encode abort does", async () => {
    const controller = new AbortController();
    const { stream, release, turn } = await openStream(controller.signal);
    const writing = stream.write(Int16Array.of(1));
    await flush();
    controller.abort();
    await expect(writing).rejects.toBeInstanceOf(DOMException);
    expect(nth(0).terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    release();
    await turn.catch(() => {});
  });

  it("an abort BETWEEN writes rejects the next write without posting it, and cancel still lets the worker's session go", async () => {
    const controller = new AbortController();
    const { stream, release, turn } = await openStream(controller.signal);
    controller.abort();
    await expect(stream.write(Int16Array.of(1))).rejects.toBeInstanceOf(
      DOMException
    );
    stream.cancel();
    expect(nth(0).kinds()).toEqual(["stream-open", "stream-cancel"]);
    release();
    await turn.catch(() => {});
  });

  it("a chunk the worker never answers is a stall, under the same silence deadline", async () => {
    const { stream, release, turn } = await openStream();
    vi.useFakeTimers();
    const writing = stream.write(Int16Array.of(1));
    const settled = writing.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(
      codecModule.ENCODER_SILENCE_TIMEOUT_MS + 1
    );
    expect(await settled).toBeInstanceOf(codecModule.EncoderStalledError);
    expect(nth(0).terminated).toBe(true);
    vi.useRealTimers();
    release();
    await turn;
  });
});

describe("mp3.worker — the worker half (#1003 b)", () => {
  let handler: (event: { data: unknown }) => void;
  let posted: unknown[];

  beforeEach(async () => {
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
  const pcm = (from: Int16Array, start: number, end: number) => {
    const copy = from.slice(start, end);
    return { buffer: copy.buffer, byteOffset: 0, length: copy.length };
  };
  const tone = (() => {
    const out = new Int16Array(44_100 + 555);
    for (let i = 0; i < out.length; i++)
      out[i] = Math.round(5000 * Math.sin(i / 9));
    return out;
  })();

  it("acks open and each chunk, and finishes with the bytes a whole encode makes", () => {
    send({ v: 1, kind: "stream-open" });
    for (const [a, b] of [
      [0, 1000],
      [1000, 1001],
      [1001, 30_000],
      [30_000, tone.length],
    ] as const)
      send({ v: 1, kind: "stream-chunk", ...pcm(tone, a, b) });
    send({ v: 1, kind: "stream-finish" });
    const kinds = posted.map((m) => (m as { kind: string }).kind);
    expect(kinds.filter((k) => k !== "progress")).toEqual([
      "stream-ack",
      "stream-ack",
      "stream-ack",
      "stream-ack",
      "stream-ack",
      "done",
    ]);
    const done = posted.at(-1) as { mp3: ArrayBuffer };
    expect(
      Buffer.from(done.mp3).equals(Buffer.from(encodeMp3(tone.slice())))
    ).toBe(true);
  });

  it("still answers the unversioned whole encode with one done", () => {
    send(pcm(tone, 0, tone.length));
    const done = posted.filter((m) => (m as { kind: string }).kind === "done");
    expect(done).toHaveLength(1);
    expect(
      Buffer.from((done[0] as { mp3: ArrayBuffer }).mp3).equals(
        Buffer.from(encodeMp3(tone.slice()))
      )
    ).toBe(true);
  });

  it("refuses a chunk or a finish with no open stream, and an unknown version", () => {
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 10) });
    send({ v: 1, kind: "stream-finish" });
    send({ v: 2, kind: "stream-open" });
    expect(posted).toEqual([
      {
        kind: "error",
        message: expect.stringMatching(/No MP3 stream is open/),
      },
      {
        kind: "error",
        message: expect.stringMatching(/No MP3 stream is open/),
      },
      { kind: "error", message: expect.stringMatching(/version: 2/) },
    ]);
  });

  it("finish ends the session: a chunk after it is refused", () => {
    send({ v: 1, kind: "stream-open" });
    send({ v: 1, kind: "stream-finish" });
    posted.length = 0;
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 10) });
    expect(posted).toEqual([
      {
        kind: "error",
        message: expect.stringMatching(/No MP3 stream is open/),
      },
    ]);
  });

  it("cancel ends the session without an answer; a chunk after it is refused", () => {
    send({ v: 1, kind: "stream-open" });
    posted.length = 0;
    send({ v: 1, kind: "stream-cancel" });
    expect(posted).toEqual([]);
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 10) });
    expect(posted).toEqual([
      {
        kind: "error",
        message: expect.stringMatching(/No MP3 stream is open/),
      },
    ]);
  });

  it("a whole encode drops a session left behind: its bytes are unchanged and a chunk after it is refused (#1132 George R1 #1)", () => {
    send({ v: 1, kind: "stream-open" });
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 20_000) });
    posted.length = 0;
    send(pcm(tone, 0, tone.length));
    const done = posted.filter((m) => (m as { kind: string }).kind === "done");
    expect(done).toHaveLength(1);
    expect(
      Buffer.from((done[0] as { mp3: ArrayBuffer }).mp3).equals(
        Buffer.from(encodeMp3(tone.slice()))
      )
    ).toBe(true);
    posted.length = 0;
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 10) });
    expect(posted).toEqual([
      {
        kind: "error",
        message: expect.stringMatching(/No MP3 stream is open/),
      },
    ]);
  });

  it("an unknown kind is a typed error answer and ends the session (#1132 George R1 #3)", () => {
    send({ v: 1, kind: "stream-open" });
    posted.length = 0;
    send({ v: 1, kind: "stream-rewind" });
    expect(posted).toEqual([
      {
        kind: "error",
        message: expect.stringMatching(
          /Unknown MP3 stream request: stream-rewind/
        ),
      },
    ]);
    posted.length = 0;
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 10) });
    expect(posted).toEqual([
      {
        kind: "error",
        message: expect.stringMatching(/No MP3 stream is open/),
      },
    ]);
  });

  it("a new open replaces a session a cancelled share left behind", () => {
    send({ v: 1, kind: "stream-open" });
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, 20_000) });
    send({ v: 1, kind: "stream-open" });
    send({ v: 1, kind: "stream-chunk", ...pcm(tone, 0, tone.length) });
    send({ v: 1, kind: "stream-finish" });
    const done = posted.at(-1) as { mp3: ArrayBuffer };
    expect(
      Buffer.from(done.mp3).equals(Buffer.from(encodeMp3(tone.slice())))
    ).toBe(true);
  });
});
