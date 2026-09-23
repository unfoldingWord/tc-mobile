import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE, INT16_MAX } from "@/lib/audio/format";

/**
 * The stored-playback level probe (#555, #612, #269), at the audio boundary.
 *
 * The code read in the PR that adds this found no gain difference between the
 * playback paths in the web layer, so the open question is what a DEVICE hands
 * the app and what the app hands the device. The probe answers it by recording
 * the level of every buffer `playSamples` sounds and every buffer
 * `decodeAudioData` returns, per source path. These cases pin the two halves a
 * device reading depends on: it records nothing unless asked to, and when
 * asked, what it records is the buffer that was actually handled.
 *
 * What this cannot tell: anything about a real engine. The fakes below are a
 * model of the Web Audio surface `audio-io` touches, nothing more.
 */

const PROBE_KEY = "tc-mobile.audio-probe";

class FakeAudioBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
    private readonly channels: Float32Array[] = []
  ) {}
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(): void {}
  getChannelData(channel: number): Float32Array {
    return this.channels[channel] ?? new Float32Array(this.length);
  }
}

/** What the next `decodeAudioData` call resolves to. */
let nextDecode: FakeAudioBuffer | null = null;

class FakeAudioContext {
  state = "running";
  readonly sampleRate = CANONICAL_SAMPLE_RATE;
  readonly destination = { channelCount: 2, maxChannelCount: 2 };
  get currentTime(): number {
    return 0;
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  async decodeAudioData(): Promise<FakeAudioBuffer> {
    if (!nextDecode) throw new Error("test set no decode result");
    return nextDecode;
  }
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number
  ): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }
  createBufferSource(): unknown {
    return {
      buffer: null,
      onended: null,
      connect(): void {},
      start(): void {},
      stop(): void {},
    };
  }
}

/** Renders the canonical mono frame count as silence; the level is not its job. */
class FakeOfflineAudioContext {
  readonly destination = {};
  constructor(
    readonly channels: number,
    readonly frames: number,
    readonly rate: number
  ) {}
  createBufferSource(): unknown {
    return { buffer: null, connect(): void {}, start(): void {} };
  }
  async startRendering(): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer(this.channels, this.frames, this.rate);
  }
}

let info: ReturnType<typeof vi.spyOn>;

async function loadAudioIo(flag: string | null | "throws") {
  vi.resetModules();
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    localStorage: {
      getItem(key: string): string | null {
        if (flag === "throws")
          throw new DOMException("denied", "SecurityError");
        return key === PROBE_KEY ? flag : null;
      },
    },
  });
  vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
  return import("@/hooks/audio-io");
}

interface ProbeReadings {
  readonly stage: string;
  readonly [field: string]: unknown;
}

function readings(): ProbeReadings[] | undefined {
  return (globalThis as { __tcAudioProbe?: ProbeReadings[] }).__tcAudioProbe;
}

beforeEach(() => {
  delete (globalThis as { __tcAudioProbe?: unknown }).__tcAudioProbe;
  nextDecode = null;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  info.mockRestore();
  vi.unstubAllGlobals();
});

function tone(amplitude: number, length: number): Int16Array {
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * i) / 100));
  }
  return out;
}

describe("the probe is off unless asked for", () => {
  it.each([
    ["no flag", null],
    ["a flag that is not exactly 1", "true"],
    ["a storage accessor that throws", "throws"],
  ] as const)("records nothing with %s", async (_name, flag) => {
    const { playSamples } = await loadAudioIo(flag);
    await playSamples(tone(8_000, 1_000), {
      source: "stored-pcm",
      isStillCurrent: () => true,
    });
    expect(readings()).toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });
});

describe("playSamples, probe on", () => {
  it("records the level of exactly the view it sounds, and where the view sits", async () => {
    const { playSamples } = await loadAudioIo("1");
    // A loud buffer with a quieter span in the middle — the #612 shape: the
    // audition sounds `working.subarray(start, end)`.
    const working = tone(16_000, 3_000);
    working.set(tone(4_000, 1_000), 1_000);
    const span = working.subarray(1_000, 2_000);

    await playSamples(span, {
      source: "working",
      offsetSeconds: 0,
      isStillCurrent: () => true,
    });

    const [entry, ...rest] = readings() ?? [];
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      stage: "play",
      source: "working",
      viewOffset: 1_000,
      backingFrames: 3_000,
      offsetSeconds: 0,
      contextState: "running",
      contextRate: CANONICAL_SAMPLE_RATE,
      destinationChannels: 2,
    });
    const level = entry!.level as { frames: number; peakDbfs: number };
    expect(level.frames).toBe(1_000);
    // The SPAN's peak (4000), not the backing buffer's (16000).
    expect(level.peakDbfs).toBeCloseTo(20 * Math.log10(4_000 / INT16_MAX), 1);
    expect(info).toHaveBeenCalledWith("TCPROBE", expect.any(String));
  });

  it("labels an unlabelled caller as such rather than guessing a path", async () => {
    const { playSamples } = await loadAudioIo("1");
    await playSamples(tone(8_000, 500), { isStillCurrent: () => true });
    expect(readings()?.[0]).toMatchObject({
      stage: "play",
      source: "unlabelled",
    });
  });

  it("records nothing for a play superseded before it sounded", async () => {
    const { playSamples } = await loadAudioIo("1");
    await playSamples(tone(8_000, 500), {
      source: "working",
      isStillCurrent: () => false,
    });
    expect(readings()).toBeUndefined();
  });

  it("keeps a bounded number of readings, newest last", async () => {
    const { playSamples } = await loadAudioIo("1");
    for (let i = 0; i < 205; i++) {
      await playSamples(tone(8_000, 10 + i), {
        source: "working",
        isStillCurrent: () => true,
      });
    }
    const all = readings() ?? [];
    expect(all).toHaveLength(200);
    const last = all[all.length - 1]!.level as { frames: number };
    expect(last.frames).toBe(10 + 204);
  });
});

describe("the capture track", () => {
  function stream(settings: Record<string, unknown>): MediaStream {
    return {
      getAudioTracks: () => [{ getSettings: () => settings }],
    } as unknown as MediaStream;
  }

  it("records the granted channel count and processing, and no device ids", async () => {
    const { probeCaptureTrack } = await loadAudioIo("1");
    probeCaptureTrack(
      stream({
        channelCount: 2,
        sampleRate: 48_000,
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: "opaque-device",
        groupId: "opaque-group",
      })
    );
    const [entry] = readings() ?? [];
    expect(entry).toMatchObject({
      stage: "capture-track",
      settings: {
        audioTracks: 1,
        channelCount: 2,
        sampleRate: 48_000,
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const settings = entry!.settings as Record<string, unknown>;
    expect(settings).not.toHaveProperty("deviceId");
    expect(settings).not.toHaveProperty("groupId");
  });

  it("records nothing with the probe off", async () => {
    const { probeCaptureTrack } = await loadAudioIo(null);
    probeCaptureTrack(stream({ channelCount: 2 }));
    expect(readings()).toBeUndefined();
  });
});

describe("decode, probe on", () => {
  it("records every decoded channel separately, so a dead second channel shows", async () => {
    // The #555 `channelCount` hypothesis: a two-channel capture whose second
    // channel is silent loses 6.02 dB in the canonical downmix. Only a
    // per-channel reading of the decode can show that shape on a device.
    const { decodeToCanonical } = await loadAudioIo("1");
    const left = Float32Array.from(tone(16_000, 4_800), (s) => s / INT16_MAX);
    nextDecode = new FakeAudioBuffer(2, 4_800, 48_000, [
      left,
      new Float32Array(4_800),
    ]);

    await decodeToCanonical(new Blob([new Uint8Array(8)]));

    const [entry, ...rest] = readings() ?? [];
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      stage: "decode",
      source: "capture",
      channels: 2,
      sampleRate: 48_000,
      frames: 4_800,
    });
    const perChannel = entry!.perChannel as { rmsDbfs: number }[];
    expect(perChannel).toHaveLength(2);
    expect(perChannel[0]!.rmsDbfs).toBeCloseTo(
      20 * Math.log10(16_000 / Math.SQRT2 / INT16_MAX),
      1
    );
    expect(perChannel[1]!.rmsDbfs).toBe(-Infinity);
  });

  it("tags a stored MP3's decode as the stored-MP3 path", async () => {
    const { decodeMp3ToCanonical } = await loadAudioIo("1");
    nextDecode = new FakeAudioBuffer(1, 1_000, CANONICAL_SAMPLE_RATE, [
      Float32Array.from(tone(8_000, 1_000), (s) => s / INT16_MAX),
    ]);
    await decodeMp3ToCanonical(new Uint8Array(8));
    expect(readings()?.[0]).toMatchObject({
      stage: "decode",
      source: "stored-mp3",
      channels: 1,
    });
  });

  it("records nothing with the probe off", async () => {
    const { decodeToCanonical } = await loadAudioIo(null);
    nextDecode = new FakeAudioBuffer(1, 100, CANONICAL_SAMPLE_RATE);
    await decodeToCanonical(new Blob([new Uint8Array(8)]));
    expect(readings()).toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });
});
