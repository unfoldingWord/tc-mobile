import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

/**
 * R13 on #1294, the tap's half: `createLevelTap`'s `onCaptureSilent` option
 * is called once when the analyser has read nothing but exact zeros for
 * `CAPTURE_SILENCE_MS` of wall time, on a running context whose clock moves.
 * Both pulls feed it: `readFrame()` (the live scope) and `read()` (the meter).
 *
 * Node fakes, not a browser: this proves the wiring, not that an alarm on a
 * phone produces zeros on the capture clone. That is the device sheet's
 * question (T3 on #1294).
 */

/** What the fake analyser copies into the caller's frame. */
let analyserFill = 0;

class FakeContext {
  static made: FakeContext[] = [];
  state = "running";
  /** When true, every read of `currentTime` moves the clock on. */
  advancing = true;
  private clock = 5;
  constructor() {
    FakeContext.made.push(this);
  }
  get currentTime(): number {
    if (this.advancing) this.clock += 0.01;
    return this.clock;
  }
  get destination(): unknown {
    return {};
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
  createMediaStreamSource(): unknown {
    return { connect(): void {}, disconnect(): void {} };
  }
  createAnalyser(): unknown {
    return {
      fftSize: 8,
      connect(): void {},
      disconnect(): void {},
      getFloatTimeDomainData(frame: Float32Array): void {
        frame.fill(analyserFill);
      },
    };
  }
  createGain(): unknown {
    return { gain: { value: 1 }, connect(): void {}, disconnect(): void {} };
  }
}

async function loadAudioIo() {
  vi.resetModules();
  vi.stubGlobal("window", { AudioContext: FakeContext });
  const io = await import("@/hooks/audio-io");
  const { CAPTURE_SILENCE_MS } = await import("@/lib/audio/capture-silence");
  return { ...io, CAPTURE_SILENCE_MS };
}

/** A stream whose clone has no tracks: enough for `createLevelTap`. */
const fakeStream = {
  clone: () => ({ getTracks: () => [] }),
} as unknown as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  FakeContext.made = [];
  analyserFill = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  reportFailure.mockReset();
});

describe("createLevelTap — onCaptureSilent (#1294, R13)", () => {
  it("is called once by the live scope's pull after five seconds of exact zeros, and writes no row itself", async () => {
    const { createLevelTap, CAPTURE_SILENCE_MS } = await loadAudioIo();
    const onCaptureSilent = vi.fn();
    const tap = createLevelTap(fakeStream, { onCaptureSilent });

    tap.readFrame();
    vi.setSystemTime(CAPTURE_SILENCE_MS - 1);
    tap.readFrame();
    expect(onCaptureSilent).not.toHaveBeenCalled();

    vi.setSystemTime(CAPTURE_SILENCE_MS);
    tap.readFrame();
    vi.setSystemTime(CAPTURE_SILENCE_MS * 4);
    tap.readFrame();

    expect(onCaptureSilent).toHaveBeenCalledOnce();
    // The hook owns the row; the tap only says what it read.
    expect(reportFailure).not.toHaveBeenCalled();
    tap.close();
  });

  it("the meter's pull feeds it as well", async () => {
    const { createLevelTap, CAPTURE_SILENCE_MS } = await loadAudioIo();
    const onCaptureSilent = vi.fn();
    const tap = createLevelTap(fakeStream, { onCaptureSilent });

    tap.read();
    vi.setSystemTime(CAPTURE_SILENCE_MS);
    tap.read();

    expect(onCaptureSilent).toHaveBeenCalledOnce();
    tap.close();
  });

  it("a frame with any level in it is never silence", async () => {
    analyserFill = 0.001;
    const { createLevelTap, CAPTURE_SILENCE_MS } = await loadAudioIo();
    const onCaptureSilent = vi.fn();
    const tap = createLevelTap(fakeStream, { onCaptureSilent });

    for (let i = 0; i <= 6; i++) {
      vi.setSystemTime(i * CAPTURE_SILENCE_MS);
      tap.readFrame();
      tap.read();
    }

    expect(onCaptureSilent).not.toHaveBeenCalled();
    tap.close();
  });

  it("a context that is not running is not judged, and its gap restarts the run", async () => {
    const { createLevelTap, CAPTURE_SILENCE_MS } = await loadAudioIo();
    const onCaptureSilent = vi.fn();
    const tap = createLevelTap(fakeStream, { onCaptureSilent });
    const ctx = FakeContext.made[0]!;

    tap.readFrame();
    ctx.state = "suspended";
    vi.setSystemTime(CAPTURE_SILENCE_MS * 2);
    tap.readFrame();
    tap.read();
    // The meter keeps pulling on its own clock while the context is out of
    // "running"; those reads are not judged either.
    vi.setSystemTime(CAPTURE_SILENCE_MS * 3);
    tap.read();
    expect(onCaptureSilent).not.toHaveBeenCalled();

    ctx.state = "running";
    tap.readFrame();
    expect(onCaptureSilent).not.toHaveBeenCalled();
    vi.setSystemTime(CAPTURE_SILENCE_MS * 4);
    tap.readFrame();
    expect(onCaptureSilent).toHaveBeenCalledOnce();
    tap.close();
  });

  it("a frozen clock is #1251's case, not this one", async () => {
    const { createLevelTap, CAPTURE_SILENCE_MS } = await loadAudioIo();
    const onCaptureSilent = vi.fn();
    const tap = createLevelTap(fakeStream, { onCaptureSilent });
    FakeContext.made[0]!.advancing = false;

    for (let i = 0; i <= 6; i++) {
      vi.setSystemTime(i * CAPTURE_SILENCE_MS);
      tap.read();
    }

    expect(onCaptureSilent).not.toHaveBeenCalled();
    tap.close();
  });

  it("a disconnected tap reads nothing, so it judges nothing", async () => {
    const { createLevelTap, CAPTURE_SILENCE_MS } = await loadAudioIo();
    const onCaptureSilent = vi.fn();
    const tap = createLevelTap(fakeStream, { onCaptureSilent });

    tap.readFrame();
    tap.disconnect();
    vi.setSystemTime(CAPTURE_SILENCE_MS * 2);
    tap.readFrame();
    tap.read();

    expect(onCaptureSilent).not.toHaveBeenCalled();
    tap.close();
  });
});
