import { describe, expect, it } from "vitest";

import { INT16_MAX } from "@/lib/audio/format";
import {
  LOUDNESS_TARGET,
  LoudnessMeter,
  NORMALIZE_STAGES,
  normalizePcm,
} from "@/lib/audio/loudness";
import { speechLikePcm } from "@/lib/phone-check/speech";

/**
 * `normalizePcm` (#1433 step 3): the chain the Finished transcode runs, over
 * a whole clip's Int16 PCM, in place. The stages' own arithmetic is pinned in
 * `tests/loudness.test.ts`; this file pins the clip-level contract the worker
 * relies on.
 */

const RATE = 44_100;

/** Integrated loudness and true peak of Int16 PCM, measured afresh. */
function measure(samples: Int16Array) {
  const meter = new LoudnessMeter(RATE, samples.length);
  const x = Float32Array.from(samples, (v) => Math.max(-1, v / INT16_MAX));
  meter.push(x, x.length);
  return meter.finish();
}

/** Synthetic speech scaled down by `db`. */
function quietSpeech(seconds: number, db: number): Int16Array {
  const speech = speechLikePcm(seconds, RATE);
  const g = 10 ** (-db / 20);
  return Int16Array.from(speech, (v) => Math.round(v * g));
}

describe("normalizePcm (#1433)", () => {
  it("brings a quiet take to the target, under the ceiling, in place and at the same length", () => {
    const samples = quietSpeech(6, 12);
    const before = measure(samples);
    const length = samples.length;

    const record = normalizePcm(samples, RATE);

    expect(samples.length).toBe(length);
    const after = measure(samples);
    expect(after.integratedLufs!).toBeCloseTo(LOUDNESS_TARGET.lufs, 0);
    // Int16 rounding and the meter's own high-pass allow a hair over.
    expect(after.truePeakDbtp!).toBeLessThanOrEqual(
      LOUDNESS_TARGET.ceilingDbtp + 0.1
    );
    expect(record.stages).toEqual(NORMALIZE_STAGES);
    expect(record.measuredLufs!).toBeCloseTo(before.integratedLufs!, 1);
    expect(record.measuredTruePeakDbtp!).toBeCloseTo(before.truePeakDbtp!, 1);
    expect(record.appliedGainDb).toBeCloseTo(
      LOUDNESS_TARGET.lufs - record.measuredLufs!,
      6
    );
  });

  it("records null loudness and 0 dB for digital silence, and leaves it silent", () => {
    const samples = new Int16Array(RATE * 2);
    const record = normalizePcm(samples, RATE);
    expect(record.measuredLufs).toBeNull();
    expect(record.measuredTruePeakDbtp).toBeNull();
    expect(record.appliedGainDb).toBe(0);
    expect(samples.every((v) => v === 0)).toBe(true);
  });

  it("reports progress after every chunk of both passes, ending at 1", () => {
    const fractions: number[] = [];
    normalizePcm(quietSpeech(3, 6), RATE, (f) => fractions.push(f));
    // Three one-second chunks, two passes.
    expect(fractions).toHaveLength(6);
    expect(fractions.at(-1)).toBe(1);
    for (let i = 1; i < fractions.length; i++)
      expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
  });
});
