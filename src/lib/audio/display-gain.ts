/**
 * Display scaling for a drawn waveform (#358) — pure math, no DOM.
 *
 * `computePeaks` normalises to full-scale Int16, so the drawn height is the
 * recording's ABSOLUTE level. On a phone whose microphone captures quietly —
 * the Moto G in #358 — a perfectly good 19-second take occupies about a tenth
 * of the canvas, speech and pauses are indistinguishable, and the editing model
 * (select, cut, paste at the centreline) has nothing to aim at. The waveform is
 * the translator's only view of what they recorded.
 *
 * So the drawer scales the peaks it was handed by one factor per take, fitted
 * to that take's own loudest excursion. This is a DRAW-TIME factor and nothing
 * else: the PCM, the stored peaks, the MP3 and the export are all untouched. It
 * is not a gain on the audio — making the capture itself louder is #359, a
 * different remedy to the same symptom, and the two are independent.
 *
 * The VU meter is deliberately NOT scaled here, and neither is the live capture
 * scope: absolute level has to keep reading as absolute level somewhere, or a
 * genuinely too-quiet microphone becomes invisible (see `LiveScope`'s comment
 * and #359).
 */

import type { Peaks } from "@/types/audio";

/**
 * The fraction of the lane the loudest point of a fitted take fills.
 *
 * Not 1: a waveform drawn flush to the top and bottom edges reads as clipped —
 * and the bars are rounded up to a 1.5 px minimum height at the draw site, so a
 * little headroom also keeps the loudest bar visually distinct from the rest.
 */
export const DISPLAY_TARGET_PEAK = 0.9;

/**
 * The most a take is ever scaled up for display: 20x, about +26 dB.
 *
 * The cap is what stops a recording of nothing from drawing like speech. With
 * it, a take is fitted to the full target only down to a peak of
 * `DISPLAY_TARGET_PEAK / MAX_DISPLAY_GAIN` = 0.045 full scale (~-27 dBFS,
 * about 1 474 of the 32 767 steps a 16-bit sample has); below that the drawn
 * height falls away with the real level, so room tone at -54 dBFS (0.002 FS)
 * still draws at a twentieth of the lane and reads as what it is.
 *
 * 20x is chosen from where speech actually sits rather than from the format's
 * limits. A healthy spoken voice peaks around -20 to -6 dBFS (`meter.ts`), so
 * even a phone capturing a good 15 dB below that — worse than the #358 report
 * describes — lands above -27 dBFS and is fitted to the full target. Going
 * further buys nothing for speech and costs the distinction between "quiet
 * voice" and "no voice", which is the one thing the drawn waveform must not
 * lose while #359 is undecided. Amplifying for display costs no fidelity at
 * either end: 16-bit quantisation noise sits near -96 dBFS, ~70 dB below the
 * point where the cap takes over, and the bars are drawn from bucket extrema
 * rather than from the sample ladder.
 */
export const MAX_DISPLAY_GAIN = 20;

/**
 * The loudest excursion in `peaks`, either side of the centreline, in [0, 1].
 *
 * Both arrays are searched because speech is asymmetric: fitting to `max`
 * alone would under-scale a take whose loudest moment is negative and could
 * then push `min` past the bottom of the canvas. Non-finite buckets are
 * skipped — `computePeaks` cannot produce one, but a NaN reaching the
 * comparison would make the whole gain NaN and every bar would silently
 * vanish, which is far harder to diagnose in the field than a wrong height.
 */
function loudestPeak(peaks: Peaks): number {
  let loudest = 0;
  const buckets = Math.min(peaks.min.length, peaks.max.length);
  for (let i = 0; i < buckets; i++) {
    const lo = peaks.min[i]!;
    const hi = peaks.max[i]!;
    if (Number.isFinite(lo)) {
      const a = lo < 0 ? -lo : lo;
      if (a > loudest) loudest = a;
    }
    if (Number.isFinite(hi)) {
      const a = hi < 0 ? -hi : hi;
      if (a > loudest) loudest = a;
    }
  }
  return loudest;
}

/**
 * The factor a drawer multiplies `peaks` by so the take fills the lane.
 *
 * One factor for the whole take, a pure function of the peaks, so it is stable
 * for as long as those peaks are on screen: panning, zooming and a repaint all
 * recompute the same number, and the waveform never breathes under the
 * translator's finger.
 *
 * Three cases, in order:
 *
 *   - **No peaks, or digital silence.** 1. There is no loudest point to fit to,
 *     and returning the cap would be a divide by zero wearing a number.
 *   - **Already at or above the target.** 1. The gain never ATTENUATES; a take
 *     that fills the lane is left exactly as it was recorded.
 *   - **Below the target.** `DISPLAY_TARGET_PEAK / peak`, capped at
 *     `MAX_DISPLAY_GAIN`.
 *
 * Guarantees `value * gain` stays inside [-1, 1] for every bucket, which is why
 * the draw site needs no clamp of its own: above the target the gain is 1 and
 * the peaks were already in range; below it the fitted peak is exactly
 * `DISPLAY_TARGET_PEAK`; and under the cap the loudest peak is smaller than the
 * crossover, so `peak * MAX_DISPLAY_GAIN` is smaller than the target still.
 */
export function displayGain(peaks: Peaks | null): number {
  if (!peaks) return 1;

  const peak = loudestPeak(peaks);
  // `> 0` also rejects NaN and -0, so the division below never sees them.
  if (!(peak > 0)) return 1;

  const fit = DISPLAY_TARGET_PEAK / peak;
  if (fit <= 1) return 1;
  return fit > MAX_DISPLAY_GAIN ? MAX_DISPLAY_GAIN : fit;
}
