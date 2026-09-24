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
 * A take that has never been committed is not fitted while it is still being
 * made. The VU meter, the live capture scope and this drawer all keep a first
 * take at absolute level until it is stopped: absolute level has to keep
 * reading as absolute level while there is still something the translator could
 * do about it, or a genuinely too-quiet microphone becomes invisible (#359).
 * Audio that IS committed stays fitted throughout, including while a punch-in
 * records over it — see `firstTakeInFlight` below for why the distinction is
 * exactly there and not one step wider.
 *
 * Since #283, `LiveScope` (always absolute, not this module) is what draws a
 * punch-in's live recording in the happy path — the whole take-in-flight
 * window mounts it, first take or append. This module's own reasoning below
 * about a punch-in's canvas staying fitted describes the paths that still
 * reach `Waveform` with committed audio present: idle, a failed mic tap
 * mid-take, and an append's own Pause+Play review (drawn fitted, deliberately,
 * per `recorder-stage.ts` and `recorder.tsx`'s stage ternary) — not the live
 * recording itself.
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
 * draws at a twentieth of the lane. On the 200 px recorder canvas that is ~8 px
 * against a fitted take's ~180 and reads as what it is; on a 26 px Segments row
 * it is ~1 px, which the draw site's 1.5 px minimum bar height makes
 * indistinguishable from silence. The row was never a level meter — that is the
 * VU meter's job and the recorder canvas's — but do not read this constant as a
 * promise the row can keep (George R1 P3).
 *
 * 20x is chosen from where speech actually sits rather than from the format's
 * limits. A healthy spoken voice peaks around -20 to -6 dBFS (`meter.ts`), so a
 * phone capturing up to 7 dB below the quiet end of that band still lands at or
 * above -27 dBFS and is fitted to the full target — the #358 report's take, at
 * about a tenth of full scale (-20 dBFS), is fitted with room to spare. Going
 * further buys nothing for speech and costs the distinction between "quiet
 * voice" and "no voice", which is the one thing the drawn waveform must not
 * lose while #359 is undecided; a phone quieter than -27 dBFS is a capture
 * problem, and the Moto G measurement #358 and #359 both ask for is what should
 * settle whether one exists before this number moves. Amplifying for display
 * costs no fidelity at either end: 16-bit quantisation noise sits near -96
 * dBFS, ~70 dB below the point where the cap takes over, and the bars are drawn
 * from bucket extrema rather than from the sample ladder.
 */
export const MAX_DISPLAY_GAIN = 20;

/**
 * Whether the canvas is showing a take that has nothing committed behind it and
 * is still being made — the one state the display fit is suppressed in.
 *
 * Both halves matter, and the second is the one a reader will be tempted to
 * drop:
 *
 *   - `takeActive` alone is too wide. A punch-in has a take active, but what it
 *     draws is the segment's ALREADY COMMITTED audio: the new recording is not
 *     spliced into the working buffer until close, so the canvas is the stored
 *     clip the translator is aiming at. Un-fitting that is #358's own complaint
 *     at the worst possible moment (George R2 P2).
 *   - `!hasCommittedAudio` alone is too wide the other way: an idle segment
 *     with no audio draws the dotted never-recorded rule, and a committed take
 *     at idle must of course be fitted.
 *
 * The first parameter is named `takeActive`, not `capturing` (renamed in
 * #373), because the caller MUST pass the WHOLE take-in-flight window, not
 * literal mic capture: **true while a take is live** — recording, paused,
 * `processing` (#59) — **OR while the close sheet is still saving it**
 * (`isClosing`), the stop→decode→save wait during which `state` has already
 * flipped to `"idle"`. The definition is `recorder.tsx`'s own expression:
 * `const takeActive = state !== "idle" || isClosing`. A caller that narrows
 * this to a bare recording/capture predicate — `recording || paused` was the
 * shape that did it — lets this go false the instant Back is tapped on a
 * paused first-take preview, while the very same preview stays on stage:
 * exactly the jump this flag exists to prevent (George R3 #2, the round-3
 * re-run: a distinct finding from R3's `fitFrom` fix). #373 is the same drift
 * caught again at the parameter's name, deferred from George's round-5 review
 * of #366 rather than found at a call site.
 *
 * Lives here rather than inline in the recorder because it is the whole of the
 * decision, and nothing in `tests/` can mount a canvas to check it there.
 */
export function isFirstTakeInFlight(
  takeActive: boolean,
  hasCommittedAudio: boolean
): boolean {
  return takeActive && !hasCommittedAudio;
}

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
 * One factor for the whole take, a pure function of its inputs, so it is stable
 * for as long as those peaks are on screen: panning, zooming and a repaint all
 * recompute the same number, and the waveform never breathes under the
 * translator's finger.
 *
 * `firstTakeInFlight` is narrow on purpose: a take being made — the WHOLE
 * take-in-flight window (recording, paused, `processing`, the `isClosing`
 * close wait, not just `recording || paused`; George R3 #2) — on a segment
 * that has **no committed audio yet**. It forces 1, and it is not a nicety. A
 * paused first take whose Play decode has landed unmounts the live scope and
 * mounts this drawer on the decoded preview instead (`recorder.tsx`'s
 * `previewShown`), and Resume swaps it straight back. Without this the same
 * in-flight take would jump from a thin absolute line to a full-height fitted
 * one at Pause+Play and collapse again on Resume — the quiet-microphone-looks-
 * healthy failure this module is careful not to cause, arriving through the
 * one path that is not the live scope (George R1 P2). Narrowing the caller's
 * predicate to `recording || paused` reintroduces the same jump the moment
 * Back is tapped while that preview is still on stage (George R3 #2).
 *
 * It is deliberately NOT "a take is in flight". A punch-in draws the segment's
 * ALREADY COMMITTED audio while capturing — `working` does not grow until the
 * new recording is spliced at close — so treating that canvas as in-flight
 * would collapse the stored speech to a tenth of the lane at the exact moment
 * the translator is aiming at the centreline with it, and pop it back at Back.
 * That is #358's own complaint, reintroduced on the insert path (George R2 P2).
 * Committed audio stays fitted through Record, Pause and Resume.
 *
 * Four cases, in order:
 *
 *   - **An uncommitted first take is still in flight.** 1.
 *   - **No peaks, or digital silence.** 1. There is no loudest point to fit to,
 *     and returning the cap would be a divide by zero wearing a number.
 *   - **Already at or above the target.** 1. The gain never ATTENUATES; a take
 *     that fills the lane is left exactly as it was recorded.
 *   - **Below the target.** `DISPLAY_TARGET_PEAK / peak`, capped at
 *     `MAX_DISPLAY_GAIN`.
 *
 * Guarantees `value * gain` stays inside [-1, 1] for every bucket **of
 * `peaks` itself** — above the target the gain is 1 and the peaks were
 * already in range; below it the fitted peak is exactly `DISPLAY_TARGET_PEAK`;
 * and under the cap the loudest peak is smaller than the crossover, so
 * `peak * MAX_DISPLAY_GAIN` is smaller than the target still.
 *
 * That guarantee does NOT extend to a *different* buffer drawn at this gain.
 * A caller that fits from one array (`fitFrom`, `waveform.tsx`) but paints
 * another — the punch-in Pause+Play preview, whose merged peaks can be louder
 * than the committed clip the gain was frozen to (George R3 P2) — can produce
 * `value * gain` outside [-1, 1] at the drawn buckets, even though this
 * function's own contract holds for `peaks` alone. That caller clamps with
 * `clampUnit` below; this function does not, because it cannot see the second
 * buffer.
 */
export function displayGain(
  peaks: Peaks | null,
  firstTakeInFlight: boolean
): number {
  if (firstTakeInFlight) return 1;
  if (!peaks) return 1;

  const peak = loudestPeak(peaks);
  // `> 0` also rejects NaN and -0, so the division below never sees them.
  if (!(peak > 0)) return 1;

  const fit = DISPLAY_TARGET_PEAK / peak;
  if (fit <= 1) return 1;
  return fit > MAX_DISPLAY_GAIN ? MAX_DISPLAY_GAIN : fit;
}

/**
 * Confines a single drawn excursion to the canvas, [-1, 1].
 *
 * `displayGain`'s own invariant covers `value * gain` only when `value` comes
 * from the same peaks the gain was fitted to. A drawer that fits from one
 * buffer and paints another — `waveform.tsx`'s `fitFrom`, so a frozen gain
 * survives the punch-in preview swap without re-jumping the committed clip's
 * scale (George R3 P2) — can hand this a louder excursion than the fit
 * anticipated, and without a clamp that bar would run past the canvas edge
 * rather than merely look tall. Also rejects NaN (neither comparison is true,
 * so it falls through to the final branch) by returning it unchanged rather
 * than silently coercing it to a boundary — a NaN reaching the draw call is a
 * bug to surface, not paper over.
 */
export function clampUnit(value: number): number {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}
