import { describe, expect, it } from "vitest";

import {
  DISPLAY_TARGET_PEAK,
  MAX_DISPLAY_GAIN,
  clampUnit,
  displayGain,
  isFirstTakeInFlight,
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

  it("does not fit an uncommitted take that is still in flight", () => {
    // George R1 P2. A paused first take's decoded preview is drawn by the same
    // canvas that replaced the live scope, so it stays at absolute level — the
    // rule the scope and the VU meter follow — and Resume, which swaps the
    // scope back, does not collapse a full-height waveform to a thin line.
    const peaks = peaksWithPeak(0.1);
    expect(displayGain(peaks, true)).toBe(1);
    // ...and the very same peaks ARE fitted once nothing is in flight. Both
    // states, not just the firing one.
    expect(displayGain(peaks, false)).toBeCloseTo(9, 6);
  });

  it("holds the uncommitted-in-flight rule at every level, including ones the cap would decide", () => {
    // The gate must not be reachable only through the fit branch: silence, a
    // capped near-silence and a full-scale take all stay at 1, so no input
    // level can smuggle a re-fit into the middle of a first take.
    for (const peak of [0, 0.002, 0.045, 0.1, 0.5, 1]) {
      expect(displayGain(peaksWithPeak(peak), true)).toBe(1);
    }
  });

  it("suppresses the fit for exactly one of the four recorder states", () => {
    // The whole of the split, in both states of both inputs. The row that
    // earned this table is the last one: a punch-in HAS A TAKE ACTIVE, and
    // gating on that alone un-fits the committed clip the translator is
    // aiming at (George R2 P2).
    const table: ReadonlyArray<[boolean, boolean, boolean]> = [
      // takeActive, hasCommittedAudio, suppress the fit
      [false, false, false], // idle, never recorded — the dotted rule
      [false, true, false], // idle with a take — fitted, the #358 fix
      [true, false, true], // FIRST take in flight — absolute, like the scope
      [true, true, false], // punch-in over committed audio — stays fitted
    ];
    for (const [takeActive, hasCommittedAudio, expected] of table) {
      expect([
        takeActive,
        hasCommittedAudio,
        isFirstTakeInFlight(takeActive, hasCommittedAudio),
      ]).toEqual([takeActive, hasCommittedAudio, expected]);
    }
  });

  it("gives the wrong answer for the #366 R3 #2 moment if the caller passes capturing-shaped input instead of takeActive's own definition (#373)", () => {
    // #373: `isFirstTakeInFlight`'s first parameter used to be named
    // `capturing`, which invites a caller to pass a bare recording/capture
    // predicate. The exact moment that breaks: Back is tapped on a
    // first-take preview. `stop()` has already flipped `state` to "idle", but
    // `isClosing` is still true for the stop→decode→save wait — the preview
    // stays on stage throughout.
    //
    // This pins the function's contract for that moment. It does NOT guard
    // the caller: both inputs are built here, and nothing observes what
    // recorder.tsx passes, so a caller that drops `isClosing` still passes
    // this suite. Making that a type error is #757.
    //
    // Premise check against the tree at this head: `RecorderState` is now
    // `"idle" | "requesting" | "recording" | "processing"` (`use-recorder.ts`)
    // — there is no separate `paused` state to OR in, so the #366-era
    // `recording || paused` collapses to `recording` alone. The shape of the
    // bug is unchanged: a state-only predicate that drops `isClosing`.
    type RecorderState = "idle" | "requesting" | "recording" | "processing";
    // Widened via the cast, not narrowed to the literal "idle": `state` here
    // stands in for a runtime value, and a literal-typed const would make the
    // `state === "recording"` comparison below a compile error rather than
    // the always-false runtime check it must be to model the bug.
    const state = "idle" as RecorderState;
    const isClosing = true;
    const hasCommittedAudio = false; // first take — nothing committed yet

    // recorder.tsx's own definition of the parameter this function requires:
    // `const takeActive = state !== "idle" || isClosing;`
    const takeActive = state !== "idle" || isClosing;
    expect(isFirstTakeInFlight(takeActive, hasCommittedAudio)).toBe(true);

    // The capturing-shaped value the old parameter name invited — a bare
    // capture predicate that drops isClosing — gives the OPPOSITE, wrong
    // answer for the identical moment: the fit would wrongly re-engage
    // mid-close and a quiet mic would look healthy for one frame, #358's own
    // complaint reintroduced.
    const capturingShaped = state === "recording";
    expect(isFirstTakeInFlight(capturingShaped, hasCommittedAudio)).toBe(false);
  });

  it("keeps committed audio fitted while a punch-in records over it", () => {
    // George R2 P2, and the reason the flag is `firstTakeInFlight` rather than
    // "a take is in flight". During a punch-in the canvas shows the segment's
    // ALREADY STORED clip — `working` does not grow until the new recording is
    // spliced at close — so un-fitting it would shrink the translator's only
    // view of what they are aiming at, at the moment they are aiming, and pop
    // it back at Back. The same peaks are drawn at Record, at Pause, on Resume
    // and at idle, and every one of them is the fitted gain.
    const committed = peaksWithPeak(0.1);
    const fitted = displayGain(committed, false);
    expect(fitted).toBeCloseTo(9, 6);
    // Every stage of a punch-in draws committed audio: `firstTakeInFlight` is
    // false throughout, so there is one gain and no jump.
    for (const stage of ["idle", "recording", "paused", "closing"]) {
      expect([stage, displayGain(committed, false)]).toEqual([stage, fitted]);
    }
  });

  it("keeps the committed gain, not the preview's, and clamps what it draws (George R3 P2)", () => {
    // The punch-in Pause+Play preview PAINTS the merged buffer (`#101`) but
    // must FIT to the committed clip alone — `waveform.tsx`'s `fitFrom`. A
    // quiet committed take fitted to ~9x, with a louder insert spliced in for
    // the preview: drawing the insert at the committed gain, unclamped, would
    // run past the canvas edge, which is exactly what `clampUnit` exists to
    // stop rather than merely look tall.
    const committed = peaksWithPeak(0.1);
    const committedGain = displayGain(committed, false);
    expect(committedGain).toBeCloseTo(9, 6);

    const louderInsert = 0.5;
    const drawnAtCommittedGain = louderInsert * committedGain;
    expect(drawnAtCommittedGain).toBeGreaterThan(1);
    expect(clampUnit(drawnAtCommittedGain)).toBe(1);
    expect(clampUnit(-drawnAtCommittedGain)).toBe(-1);

    // ...and a value the frozen gain never pushes out of range is untouched.
    expect(clampUnit(louderInsert * 1)).toBeCloseTo(0.5, 6);
  });

  it("clampUnit confines a value to [-1, 1] and leaves an in-range one alone", () => {
    expect(clampUnit(1.5)).toBe(1);
    expect(clampUnit(-1.5)).toBe(-1);
    expect(clampUnit(1)).toBe(1);
    expect(clampUnit(-1)).toBe(-1);
    expect(clampUnit(0.42)).toBe(0.42);
    expect(clampUnit(-0.42)).toBe(-0.42);
    expect(clampUnit(0)).toBe(0);
  });

  it("passes a non-finite value through clampUnit rather than coercing it", () => {
    // Neither comparison is true for NaN, so it falls to the final branch —
    // surfacing the bug rather than silently drawing a boundary bar.
    expect(Number.isNaN(clampUnit(Number.NaN))).toBe(true);
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
