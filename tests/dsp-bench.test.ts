import { afterEach, describe, expect, it, vi } from "vitest";

import { runDspBench, type DspBenchOptions } from "@/lib/phone-check/dsp-bench";
import { speechLikePcm } from "@/lib/phone-check/speech";

/**
 * #1433 step 1, task T1 — the DSP benchmark kernel.
 *
 * Two kinds of claim are pinned here, and they are kept apart:
 *
 * - Reference values from the published specifications the kernel cites:
 *   ITU-R BS.1770's stated loudness of a 1 kHz sine, its 48 kHz K-weighting
 *   table (evaluated here, in the test, as a frequency response), and the
 *   inter-sample peak of a quarter-rate sine that sample-peak metering misses.
 * - The shape the plan requires of a benchmark: chunk-size independence, a
 *   bounded working set, a limiter that holds its ceiling, a high-pass that
 *   removes rumble, an injected clock and a checksum of the processed output.
 *
 * Nothing here measures speed. Every time below comes from a fake clock.
 */

const RATE = 44_100;

/** A clock that advances `step` ms on every read, and counts its reads. */
function stepClock(step = 1) {
  let t = 0;
  let reads = 0;
  return {
    now: () => {
      reads += 1;
      t += step;
      return t;
    },
    reads: () => reads,
  };
}

function sine(
  seconds: number,
  hz: number,
  amplitude: number,
  sampleRate = RATE,
  phase = 0
): Int16Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(
      amplitude * 32767 * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase)
    );
  return out;
}

function bench(input: Int16Array, extra: Partial<DspBenchOptions> = {}) {
  return runDspBench({
    input,
    sampleRate: RATE,
    now: stepClock().now,
    ...extra,
  });
}

/** Collects the apply pass's output, in order. */
function collector() {
  const chunks: Float32Array[] = [];
  return {
    sink: (chunk: Float32Array) => {
      chunks.push(chunk.slice());
    },
    all: () => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    },
  };
}

function rms(
  x: Float32Array | Int16Array,
  from: number,
  to: number,
  scale = 1
) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = (x[i] ?? 0) / scale;
    sum += v * v;
  }
  return Math.sqrt(sum / (to - from));
}

const db = (ratio: number) => 20 * Math.log10(ratio);

/**
 * ITU-R BS.1770-4, Tables 1 and 2: the K-weighting filter's two stages at
 * 48 kHz, as the Recommendation prints them. Evaluated here as a magnitude
 * response, so the kernel's any-rate filters are checked against the spec's
 * own numbers rather than against a copy of the kernel's design.
 */
const BS1770_STAGE1 = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1, -1.69065929318241, 0.73248077421585],
};
const BS1770_STAGE2 = {
  b: [1, -2, 1],
  a: [1, -1.99004745483398, 0.99007225036621],
};

function biquadPowerGain(
  c: { b: number[]; a: number[] },
  hz: number,
  sampleRate: number
): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const re = (k: number[]) =>
    (k[0] ?? 0) + (k[1] ?? 0) * Math.cos(w) + (k[2] ?? 0) * Math.cos(2 * w);
  const im = (k: number[]) =>
    -((k[1] ?? 0) * Math.sin(w) + (k[2] ?? 0) * Math.sin(2 * w));
  const num = re(c.b) ** 2 + im(c.b) ** 2;
  const den = re(c.a) ** 2 + im(c.a) ** 2;
  return num / den;
}

describe("reference values from the cited specifications", () => {
  it("a 1 kHz sine at -20 dBFS measures -23.01 LKFS within 0.1 LU (BS.1770: 0 dBFS 1 kHz reads -3.01)", () => {
    for (const rate of [48_000, 44_100]) {
      const r = runDspBench({
        input: sine(5, 1000, 0.1, rate),
        sampleRate: rate,
        now: stepClock().now,
      });
      expect(r.loudnessLufs).not.toBeNull();
      expect(Math.abs((r.loudnessLufs ?? 0) - -23.01)).toBeLessThan(0.1);
    }
  });

  it.each([500, 1000, 2000, 5000, 10_000, 15_000])(
    "at 48 kHz, a %d Hz tone reads the loudness BS.1770's printed K-weighting table gives, within 0.05 LU",
    (hz) => {
      const amplitude = 0.1;
      const expected =
        -0.691 +
        10 *
          Math.log10(
            ((amplitude * amplitude) / 2) *
              biquadPowerGain(BS1770_STAGE1, hz, 48_000) *
              biquadPowerGain(BS1770_STAGE2, hz, 48_000)
          );
      const r = runDspBench({
        input: sine(5, hz, amplitude, 48_000),
        sampleRate: 48_000,
        now: stepClock().now,
      });
      expect(Math.abs((r.loudnessLufs ?? 0) - expected)).toBeLessThan(0.05);
    }
  );

  it("a quarter-rate sine at 45 degrees reads its true peak (-6.02 dBTP) within 0.1 dB, not its sample peak (-9.03)", () => {
    // Every sample lands at +/- amplitude * cos(45deg): the classic case
    // where a sample-peak meter under-reads by 3.01 dB (BS.1770, Annex 2).
    const input = sine(2, RATE / 4, 0.5, RATE, Math.PI / 4);
    const samplePeak = db(Math.max(...Array.from(input, Math.abs)) / 32768);
    expect(samplePeak).toBeLessThan(-8.9);
    const r = bench(input);
    expect(r.truePeakDbtp).not.toBeNull();
    expect(Math.abs((r.truePeakDbtp ?? 0) - -6.02)).toBeLessThan(0.1);
  });
});

describe("(a) chunk-size independence", () => {
  it("gives the same checksum, loudness and peak at 1 s, 0.5 s and 37 ms chunks", () => {
    const input = speechLikePcm(10);
    const runs = [1, 0.5, 0.037].map((chunkSeconds) =>
      bench(input, { chunkSeconds })
    );
    const [first, ...rest] = runs;
    expect(first?.chunks).toBe(10);
    for (const r of rest) {
      expect(r.checksum).toBe(first?.checksum);
      expect(r.loudnessLufs).toBe(first?.loudnessLufs);
      expect(r.truePeakDbtp).toBe(first?.truePeakDbtp);
      expect(r.limiterMaxReductionDb).toBe(first?.limiterMaxReductionDb);
    }
    expect(runs[2]?.chunks).toBeGreaterThan(200);
  });
});

describe("(b) the limiter's ceiling", () => {
  it("never lets a sample over the ceiling when the gain drives speech 12 dB past the default target", () => {
    const out = collector();
    const ceilingDbtp = -1.5;
    const r = bench(speechLikePcm(20), {
      targetLufs: -19 + 12,
      ceilingDbtp,
      sink: out.sink,
    });
    const samples = out.all();
    expect(samples.length).toBe(20 * RATE);
    expect(r.gainDb).toBeGreaterThan(12);
    // The limiter did real work, so the ceiling below is not vacuous.
    expect(r.limiterMaxReductionDb).toBeGreaterThan(3);
    const ceiling = 10 ** (ceilingDbtp / 20);
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(ceiling * (1 + 1e-6));
  });
});

describe("(c) the rumble high-pass at about 80 Hz", () => {
  /** Through-path attenuation in dB, with the static gain the run applied divided out. */
  function lossDb(hz: number, amplitude: number): number {
    const out = collector();
    const input = sine(4, hz, amplitude);
    const r = bench(input, { sink: out.sink });
    const y = out.all();
    // Skip the first and last second: filter start-up and the flush tail.
    const ratio = rms(y, RATE, 3 * RATE) / rms(input, RATE, 3 * RATE, 32768);
    return -(db(ratio) - r.gainDb);
  }

  it("takes at least 20 dB off a 20 Hz tone", () => {
    expect(lossDb(20, 0.01)).toBeGreaterThanOrEqual(20);
  });

  it("takes under 0.5 dB off a 1 kHz tone", () => {
    expect(Math.abs(lossDb(1000, 0.01))).toBeLessThan(0.5);
  });
});

describe("(d) a bounded working set", () => {
  it("reports the same working-set bytes for 60 s and 600 s of audio", () => {
    const rate = 8000;
    const short = runDspBench({
      input: new Int16Array(60 * rate).fill(1000),
      sampleRate: rate,
      now: stepClock().now,
    });
    const long = runDspBench({
      input: new Int16Array(600 * rate).fill(1000),
      sampleRate: rate,
      now: stepClock().now,
    });
    expect(short.workingSetBytes).toBeGreaterThan(0);
    expect(long.workingSetBytes).toBe(short.workingSetBytes);
    // A few hundred KB at most at the app's rate, as the plan requires.
    expect(bench(speechLikePcm(2)).workingSetBytes).toBeLessThan(512 * 1024);
  });
});

describe("(e) the injected clock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drives every reported time; the kernel reads no clock of its own", () => {
    const perf = vi.spyOn(performance, "now");
    const date = vi.spyOn(Date, "now");
    const clock = stepClock(10);
    const r = bench(speechLikePcm(3), { now: clock.now });
    expect(perf).not.toHaveBeenCalled();
    expect(date).not.toHaveBeenCalled();
    expect(clock.reads()).toBeGreaterThan(0);
    for (const ms of [r.measureMs, r.applyMs, r.slowestChunkMs]) {
      expect(ms).toBeGreaterThan(0);
      expect(ms % 10).toBe(0);
    }
    const stageTotal = Object.values(r.stageMs).reduce((a, b) => a + b, 0);
    expect(stageTotal).toBeGreaterThan(0);
    expect(stageTotal).toBeLessThanOrEqual(r.measureMs + r.applyMs);
    expect(Object.keys(r.stageMs).sort()).toEqual(
      ["gain", "highPass", "kWeight", "limiter", "truePeak"].sort()
    );
  });
});

describe("(f) the checksum", () => {
  it("is identical for identical input on two runs", () => {
    const input = speechLikePcm(5);
    expect(bench(input).checksum).toBe(bench(input).checksum);
  });

  it("covers the processed output, so a different gain gives a different checksum", () => {
    const input = speechLikePcm(5);
    const a = bench(input, { targetLufs: -19 });
    const b = bench(input, { targetLufs: -23 });
    expect(a.gainDb).not.toBe(b.gainDb);
    expect(a.checksum).not.toBe(b.checksum);
  });
});

describe("(g) the limiter's release", () => {
  it("recovers gradually after a loud burst instead of jumping back to full gain", () => {
    // A burst the limiter must pull down, then a quiet tone well under the
    // ceiling. Right after the burst the quiet tone must still be held down.
    const burst = sine(0.5, 1000, 1);
    const quiet = sine(2.5, 1000, 0.05);
    const input = new Int16Array(burst.length + quiet.length);
    input.set(burst, 0);
    input.set(quiet, burst.length);
    const out = collector();
    const r = bench(input, {
      targetLufs: 0,
      maxGainDb: 0,
      ceilingDbtp: -6,
      sink: out.sink,
    });
    expect(r.gainDb).toBe(0);
    expect(r.limiterMaxReductionDb).toBeGreaterThan(0);
    const y = out.all();
    const settled = rms(y, 2 * RATE, 3 * RATE);
    const start = burst.length + Math.round(0.01 * RATE);
    const justAfter = rms(y, start, start + Math.round(0.01 * RATE));
    expect(db(justAfter / settled)).toBeLessThan(-1);
    // And it does recover: the settled tone is at the input's own level.
    expect(
      Math.abs(db(settled / rms(input, 2 * RATE, 3 * RATE, 32768)))
    ).toBeLessThan(0.1);
  });
});

describe("progress and edges", () => {
  it("reports progress once per chunk, for both passes in order", () => {
    const calls: Array<[1 | 2, number, number]> = [];
    bench(speechLikePcm(3), {
      onChunk: (pass, done, total) => calls.push([pass, done, total]),
    });
    expect(calls).toEqual([
      [1, 1, 3],
      [1, 2, 3],
      [1, 3, 3],
      [2, 1, 3],
      [2, 2, 3],
      [2, 3, 3],
    ]);
  });

  it("reads silence as no loudness, applies no gain and produces finite output", () => {
    const out = collector();
    const r = bench(new Int16Array(RATE), { sink: out.sink });
    expect(r.loudnessLufs).toBeNull();
    expect(r.truePeakDbtp).toBeNull();
    expect(r.gainDb).toBe(0);
    expect(r.audioSeconds).toBe(1);
    expect(out.all().every((v) => v === 0)).toBe(true);
    expect(Number.isFinite(r.checksum)).toBe(true);
  });
});
