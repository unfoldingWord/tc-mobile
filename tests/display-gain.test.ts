import { describe, expect, it } from "vitest";

import {
  DISPLAY_TARGET_PEAK,
  MAX_DISPLAY_GAIN,
  displayGain,
} from "@/lib/audio/display-gain";
import { computePeaks } from "@/lib/audio/peaks";
import { INT16_MAX } from "@/lib/audio/format";
import type { Peaks } from "@/types/audio";

/**
 * Peaks whose loudest bucket reaches `peak`, with quieter, asymmetric buckets
 * around it — the shape real speech has. The loudest excursion is deliberately
 * NOT in the first bucket, so a gain that only read `max[0]` would fail.
 */
function peaksWithPeak(peak: number, buckets = 8): Peaks {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    max[i] = peak / 4;
    min[i] = -peak / 8;
  }
  max[buckets - 2] = peak;
  return { min, max, samplesPerBucket: 100 };
}

/** The loudest drawn excursion once `gain` is applied. */
function drawnPeak(peaks: Peaks, gain: number): number {
  let loudest = 0;
  for (let i = 0; i < peaks.max.length; i++) {
    loudest = Math.max(
      loudest,
      Math.abs(peaks.max[i]!),
      Math.abs(peaks.min[i]!)
    );
  }
  return loudest * gain;
}

describe("displayGain", () => {
  it("leaves a full-scale take alone", () => {
    // The take already fills the lane. Fitting it to the 0.9 target would
    // SHRINK it, which is not what a display scale is for: the gain never
    // attenuates.
    expect(displayGain(peaksWithPeak(1), false)).toBe(1);
  });

  it("does not attenuate a take whose peak is already above the target", () => {
    const peaks = peaksWithPeak(0.95);
    const gain = displayGain(peaks, false);
    expect(gain).toBe(1);
    // ...and the drawn excursion still fits the lane, so nothing is clipped off
    // the top of the canvas.
    expect(drawnPeak(peaks, gain)).toBeCloseTo(0.95, 6);
    expect(drawnPeak(peaks, gain)).toBeLessThanOrEqual(1);
  });

  it("scales a quiet take so its loudest peak reaches the target", () => {
    // The #358 case: a Moto G take peaking at a tenth of full scale.
    const peaks = peaksWithPeak(0.1);
    const gain = displayGain(peaks, false);
    expect(gain).toBeCloseTo(9, 6);
    expect(drawnPeak(peaks, gain)).toBeCloseTo(DISPLAY_TARGET_PEAK, 6);
  });

  it("scales a very quiet take up to exactly the target at the floor crossover", () => {
    // The quietest take the cap still fits to the full target: any quieter and
    // the cap, not the fit, decides. This is the legitimate state on the
    // firing side of the boundary.
    const crossover = DISPLAY_TARGET_PEAK / MAX_DISPLAY_GAIN;
    const peaks = peaksWithPeak(crossover);
    const gain = displayGain(peaks, false);
    // Looser than the other cases on purpose: `Peaks` holds Float32, so 0.045
    // round-trips as 0.044999998... and the fitted gain lands a part in 10^7
    // under the cap. The point of the case is which branch decides, not the
    // seventh decimal.
    expect(gain).toBeCloseTo(MAX_DISPLAY_GAIN, 4);
    expect(gain).toBeLessThanOrEqual(MAX_DISPLAY_GAIN);
    expect(drawnPeak(peaks, gain)).toBeCloseTo(DISPLAY_TARGET_PEAK, 4);
  });

  it("caps the gain so near-silence does not blow up to full height", () => {
    // Room tone, ~-54 dBFS. Without the cap this would be scaled by 450 and a
    // recording of nothing would draw as a full-height waveform.
    const peaks = peaksWithPeak(0.002);
    const gain = displayGain(peaks, false);
    expect(gain).toBe(MAX_DISPLAY_GAIN);
    expect(drawnPeak(peaks, gain)).toBeCloseTo(0.04, 6);
    expect(drawnPeak(peaks, gain)).toBeLessThan(DISPLAY_TARGET_PEAK);
  });

  it("reads the loudest excursion whichever side of the centreline it is on", () => {
    // Speech is asymmetric; a gain taken from `max` alone would under-scale a
    // take whose loudest excursion is negative, and could then draw `min`
    // below the bottom of the canvas.
    const min = Float32Array.from([-0.2, -0.05, -0.01]);
    const max = Float32Array.from([0.05, 0.02, 0.01]);
    const peaks: Peaks = { min, max, samplesPerBucket: 100 };
    expect(displayGain(peaks, false)).toBeCloseTo(DISPLAY_TARGET_PEAK / 0.2, 6);
  });

  it("is unity for a segment with no peaks at all", () => {
    expect(displayGain(null, false)).toBe(1);
  });

  it("is unity for digital silence rather than the cap", () => {
    // An all-zero take has no loudest point to fit to. Returning the cap would
    // be a divide-by-zero dressed up as a number, and multiplying zeroes by 20
    // draws the same flat line anyway — but only unity says honestly that
    // nothing was scaled.
    const peaks = peaksWithPeak(0);
    expect(displayGain(peaks, false)).toBe(1);
  });

  it("never draws a take outside the lane, at any input level", () => {
    // The invariant the draw site depends on: `value * gain` stays within
    // [-1, 1], so no bar is clipped by the top or bottom of the canvas and the
    // draw code needs no clamp of its own.
    for (const peak of [
      0, 1e-6, 0.0005, 0.002, 0.045, 0.1, 0.3, 0.5, 0.89, 0.9, 0.91, 0.99, 1,
    ]) {
      const peaks = peaksWithPeak(peak);
      expect(drawnPeak(peaks, displayGain(peaks, false))).toBeLessThanOrEqual(
        1
      );
    }
  });

  it("ignores a non-finite bucket instead of collapsing the gain", () => {
    // `computePeaks` cannot emit one, but a NaN reaching the max search would
    // leave the loudest excursion at NaN and the gain NaN — every bar would
    // then vanish from the canvas rather than draw wrong, which is far harder
    // to diagnose in the field.
    const min = Float32Array.from([-0.1, Number.NaN]);
    const max = Float32Array.from([Number.POSITIVE_INFINITY, 0.1]);
    const peaks: Peaks = { min, max, samplesPerBucket: 100 };
    expect(displayGain(peaks, false)).toBeCloseTo(DISPLAY_TARGET_PEAK / 0.1, 6);
  });

  it("does not fit a take that is still in flight", () => {
    // George R1 P2. While a take is being made, the drawn waveform stays at
    // absolute level — the same rule the live scope and the VU meter follow, so
    // a microphone capturing far too quietly cannot be made to look healthy by
    // the display while there is still something to do about it.
    const peaks = peaksWithPeak(0.1);
    expect(displayGain(peaks, true)).toBe(1);
    // ...and the very same peaks ARE fitted once the take is no longer in
    // flight. Both states, not just the firing one.
    expect(displayGain(peaks, false)).toBeCloseTo(9, 6);
  });

  it("holds the in-flight rule at every level, including ones the cap would decide", () => {
    // The gate must not be reachable only through the fit branch: silence, a
    // capped near-silence and a full-scale take all stay at 1 in flight, so no
    // input level can smuggle a re-fit into the middle of a take.
    for (const peak of [0, 0.002, 0.045, 0.1, 0.5, 1]) {
      expect(displayGain(peaksWithPeak(peak), true)).toBe(1);
    }
  });

  it("leaves an in-flight take's peaks untouched even when they change mid-take", () => {
    // The punch-in case (George R1 P3 #2): appending a loud phrase to a quiet
    // take swaps the peaks object the recorder draws, which would otherwise
    // re-fit the whole take to the new, louder peak and visibly shrink the
    // speech that was already there. In flight, both draw at 1.
    const quiet = peaksWithPeak(0.1);
    const afterLoudInsert = peaksWithPeak(0.5);
    expect(displayGain(quiet, true)).toBe(1);
    expect(displayGain(afterLoudInsert, true)).toBe(1);
  });

  it("fits peaks taken from a real quiet PCM buffer", () => {
    // End to end through the actual peak pass: a 16-bit buffer peaking around
    // -26 dBFS, which is roughly what the #358 report describes.
    const samples = new Int16Array(4_000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.round(Math.sin(i / 8) * INT16_MAX * 0.05);
    }
    const peaks = computePeaks(samples, 40);
    const gain = displayGain(peaks, false);
    expect(gain).toBeGreaterThan(1);
    expect(gain).toBeLessThanOrEqual(MAX_DISPLAY_GAIN);
    expect(drawnPeak(peaks, gain)).toBeCloseTo(DISPLAY_TARGET_PEAK, 2);
  });
});
