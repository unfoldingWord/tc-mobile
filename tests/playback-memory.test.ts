import { afterEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE, INT16_MAX } from "@/lib/audio/format";

/**
 * Playback and decode memory at the audio boundary (#175, audit A-9).
 *
 * Two allocations dominated a Play tap, and both are read from the code rather
 * than measured on a phone:
 *
 * 1. The shared `AudioContext` was built with no options, so it ran at the
 *    device's rate. `decodeAudioData` resamples to the context rate, so on a
 *    48 kHz device EVERY decode then went through an `OfflineAudioContext`
 *    render in `toCanonical` — a third whole-clip copy on top of the two below.
 * 2. `toAudioBuffer` built one whole-clip `Float32Array` (`int16ToFloat`) and
 *    handed it to a whole-clip `AudioBuffer`, so a ten-minute segment was about
 *    265 MB resident on one tap.
 *
 * The fix pins the context to `CANONICAL_SAMPLE_RATE` (the decode lands already
 * canonical, so the resample and its copy disappear) and fills the playback
 * buffer through one reused one-second window instead of materialising the clip.
 *
 * The fake context here is a different instrument from the one in
 * `audio-context-resume.test.ts`: that one observes `resume()` and source
 * construction, this one observes the CONSTRUCTOR ARGUMENTS and every
 * `copyToChannel` write. It snapshots each write, which is load-bearing — the
 * fix reuses one scratch buffer, so storing the reference would alias every
 * window to the last one and the assertions below would read as passing.
 */

interface ChannelWrite {
  readonly offset: number;
  readonly data: Float32Array;
}

class FakeAudioBuffer {
  readonly writes: ChannelWrite[] = [];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {}
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(source: Float32Array, _channel: number, offset = 0): void {
    // Snapshot: the caller reuses one scratch window across the whole clip.
    this.writes.push({ offset, data: Float32Array.from(source) });
  }
}

class FakeAudioContext {
  buffersCreated: FakeAudioBuffer[] = [];
  state = "running";
  constructor(readonly options?: { sampleRate?: number }) {}
  get currentTime(): number {
    return 0;
  }
  get destination(): unknown {
    return {};
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number
  ): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.buffersCreated.push(buffer);
    return buffer;
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

/** Every context this module constructed, newest last, with its options. */
let constructed: FakeAudioContext[] = [];

/**
 * Load a fresh `audio-io` (the shared context is module state) whose
 * `window.AudioContext` records its options. `rejectOptions` stands in for a
 * device that refuses an explicit rate — Safari before 14.1 throws
 * `NotSupportedError` on the `sampleRate` option.
 */
async function loadAudioIo({ rejectOptions = false } = {}) {
  vi.resetModules();
  constructed = [];
  vi.stubGlobal("window", {
    AudioContext: function (options?: { sampleRate?: number }) {
      if (rejectOptions && options !== undefined) {
        throw new DOMException("unsupported sample rate", "NotSupportedError");
      }
      const ctx = new FakeAudioContext(options);
      constructed.push(ctx);
      return ctx;
    },
  });
  return import("@/hooks/audio-io");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The reference conversion, written out rather than reusing the module's. */
function expectedFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1, samples[i]! / INT16_MAX);
  }
  return out;
}

function ramp(length: number): Int16Array {
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    // Spans the range including the asymmetric floor, so a clamp regression
    // shows up in the reassembled data rather than only at the edges.
    out[i] = ((i * 977) % 65_536) - 32_768;
  }
  return out;
}

describe("the shared AudioContext rate (#175)", () => {
  it("is pinned to the canonical rate, so a decode needs no resample", async () => {
    const { resumeAudioContext } = await loadAudioIo();
    await resumeAudioContext();
    expect(constructed).toHaveLength(1);
    expect(constructed[0]!.options?.sampleRate).toBe(CANONICAL_SAMPLE_RATE);
  });

  it("still gets a context on a device that refuses the requested rate", async () => {
    // Safari < 14.1 throws on the option. The resample path in `toCanonical`
    // remains the fallback, so pinning must be best-effort, never fatal.
    const { resumeAudioContext } = await loadAudioIo({ rejectOptions: true });
    await expect(resumeAudioContext()).resolves.toBeUndefined();
    expect(constructed).toHaveLength(1);
    expect(constructed[0]!.options).toBeUndefined();
  });
});

describe("playback buffer fill — windowed, not whole-clip (#175)", () => {
  const WINDOW = CANONICAL_SAMPLE_RATE; // the one-second fill window

  it("fills a long clip through repeated bounded windows", async () => {
    const samples = ramp(WINDOW * 2 + 17);
    const { playSamples } = await loadAudioIo();
    await playSamples(samples, { isStillCurrent: () => true });

    const buffer = constructed[0]!.buffersCreated[0]!;
    expect(buffer.length).toBe(samples.length);
    // Three writes, not one whole-clip copy: two full windows and the tail.
    expect(buffer.writes.map((w) => w.offset)).toEqual([0, WINDOW, WINDOW * 2]);
    expect(buffer.writes.map((w) => w.data.length)).toEqual([
      WINDOW,
      WINDOW,
      17,
    ]);
    // No single write ever materialises more than one window.
    for (const write of buffer.writes) {
      expect(write.data.length).toBeLessThanOrEqual(WINDOW);
    }
  });

  it("reassembles to exactly the samples the whole-clip copy produced", async () => {
    const samples = ramp(WINDOW * 2 + 17);
    const { playSamples } = await loadAudioIo();
    await playSamples(samples, { isStillCurrent: () => true });

    const buffer = constructed[0]!.buffersCreated[0]!;
    const assembled = new Float32Array(samples.length);
    for (const write of buffer.writes) assembled.set(write.data, write.offset);
    expect(assembled).toEqual(expectedFloat(samples));
  });

  /**
   * Lead 1 of issue 553 alleges the edit-mode audition is quiet because it
   * sounds a VIEW: `soundRange` in `components/recorder.tsx` plays
   * `editor.working.subarray(start, end)`, and the lead supposes something on
   * the way to Web Audio reads that view through its BACKING STORE — so a
   * mid-buffer range would sound a different, generally lower-energy window
   * instead of its own samples.
   *
   * `int16ToFloatInto` indexes `input[start + i]`, which is a VIEW index, so
   * the allegation does not hold. This pins that as an assertion rather than
   * as a code read: a mid-buffer view must reassemble to exactly the floats
   * its own samples produce. The zero-offset cases above cannot see it — for
   * them the view and its backing store are the same array — which is why
   * this is a separate case and not a wider assertion on one of them.
   *
   * Refuting this one lead does not resolve issue 553; its others stand.
   */
  it("plays a mid-buffer view as its own samples, not its backing store's", async () => {
    const backing = ramp(WINDOW * 2 + 17);
    // Deliberately not window-aligned, and longer than one fill window, so the
    // reassembly crosses a window boundary at a non-zero view offset.
    const from = 1_000;
    const to = from + WINDOW + 5;
    const view = backing.subarray(from, to);
    const { playSamples } = await loadAudioIo();
    await playSamples(view, { isStillCurrent: () => true });

    const buffer = constructed[0]!.buffersCreated[0]!;
    expect(buffer.length).toBe(view.length);
    const assembled = new Float32Array(view.length);
    for (const write of buffer.writes) assembled.set(write.data, write.offset);
    // `slice` copies, so the expectation is built from the view's OWN samples
    // and shares no backing store with the input.
    expect(assembled).toEqual(expectedFloat(backing.slice(from, to)));
  });

  it("writes a clip shorter than one window exactly once", async () => {
    const samples = ramp(1_000);
    const { playSamples } = await loadAudioIo();
    await playSamples(samples, { isStillCurrent: () => true });

    const buffer = constructed[0]!.buffersCreated[0]!;
    expect(buffer.writes).toHaveLength(1);
    expect(buffer.writes[0]!.offset).toBe(0);
    expect(buffer.writes[0]!.data).toEqual(expectedFloat(samples));
  });

  it("writes nothing for an empty clip, and still builds a playable buffer", async () => {
    const { playSamples } = await loadAudioIo();
    await playSamples(new Int16Array(0), { isStillCurrent: () => true });

    const buffer = constructed[0]!.buffersCreated[0]!;
    // `createBuffer` rejects a zero length, so the floor of one frame stands.
    expect(buffer.length).toBe(1);
    expect(buffer.writes).toHaveLength(0);
  });
});
