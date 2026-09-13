import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `LevelTap.available()` is the meter's per-frame trust signal (#76): a wired tap
 * whose shared `AudioContext` has gone `"suspended"`/`"interrupted"` (iOS
 * backgrounding or an OS interruption) reads all-zeros from its analyser with no
 * error, so the VU meter must hatch "unavailable" rather than animate to an empty
 * strip a translator reads as a dead microphone.
 *
 * The DECISION lives in the pure `meterReadable` (see `meter.test.ts`); this
 * proves the WIRING — that `createLevelTap(...).available()` actually reads the
 * LIVE context state and its own disconnected flag. The mutation that must fail
 * if the fix is dropped: reverting `available` to `() => !disconnected` (ignoring
 * the context state) turns the suspended/interrupted cases below green→red.
 *
 * A minimal Web Audio fake stands in for the browser, the same approach
 * `audio-context-resume.test.ts` uses: `audio-io.ts` reads `window.AudioContext`
 * lazily and caches one shared context, so each case resets the module registry
 * and installs a fresh fake whose `state` is observable and mutable.
 */

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData(): void {
    // Never invoked by these tests — `available()` and `disconnect()` do not read
    // a frame — but present so the fake analyser is shaped like the real node.
  }
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeTrack {
  stopped = 0;
  stop(): void {
    this.stopped++;
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[] = [new FakeTrack()]) {}
  clone(): FakeStream {
    // The tap taps a CLONE; give it its own tracks so a clone stop is observable.
    return new FakeStream([new FakeTrack()]);
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeAudioContext {
  // Mutable so a test can drive the tap through an iOS interruption mid-take.
  constructor(public state: string) {}
  get destination(): unknown {
    return new FakeNode();
  }
  createMediaStreamSource(): FakeNode {
    return new FakeNode();
  }
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
}

async function loadAudioIo(ctx: FakeAudioContext) {
  vi.resetModules();
  vi.stubGlobal("window", {
    AudioContext: function () {
      return ctx;
    },
  });
  return import("@/hooks/audio-io");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LevelTap.available — the meter's per-frame trust signal (#76)", () => {
  it("is available on a running context", async () => {
    const ctx = new FakeAudioContext("running");
    const { createLevelTap } = await loadAudioIo(ctx);
    const tap = createLevelTap(new FakeStream() as unknown as MediaStream);
    expect(tap.available()).toBe(true);
  });

  it("is UNavailable when the context goes suspended mid-take", async () => {
    const ctx = new FakeAudioContext("running");
    const { createLevelTap } = await loadAudioIo(ctx);
    const tap = createLevelTap(new FakeStream() as unknown as MediaStream);
    expect(tap.available()).toBe(true);
    // iOS backgrounding suspends the shared context without tearing the tap down.
    ctx.state = "suspended";
    expect(tap.available()).toBe(false);
  });

  it("is UNavailable on WebKit's interrupted state", async () => {
    const ctx = new FakeAudioContext("interrupted");
    const { createLevelTap } = await loadAudioIo(ctx);
    const tap = createLevelTap(new FakeStream() as unknown as MediaStream);
    expect(tap.available()).toBe(false);
  });

  it("recovers to available when the context resumes to running", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { createLevelTap } = await loadAudioIo(ctx);
    const tap = createLevelTap(new FakeStream() as unknown as MediaStream);
    expect(tap.available()).toBe(false);
    ctx.state = "running";
    expect(tap.available()).toBe(true);
  });

  it("is UNavailable once disconnected, even on a running context", async () => {
    const ctx = new FakeAudioContext("running");
    const { createLevelTap } = await loadAudioIo(ctx);
    const tap = createLevelTap(new FakeStream() as unknown as MediaStream);
    tap.disconnect();
    expect(tap.available()).toBe(false);
  });
});
