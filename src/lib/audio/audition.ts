/**
 * What edit-mode Play sounds — the audition decision (#284).
 *
 * The first external tester tried to play a highlighted part of a segment
 * before deleting it and found no way to, then settled for memorising the shape
 * of the waveform. A translator who cannot read has no other fallback, so edit
 * mode grew a Play; this is the half of it that decides WHICH samples that Play
 * sounds. It is pure and DOM-free, so the decision is provable in plain Node —
 * the recorder owns only how to sound the range it is handed.
 */

import { clampRange } from "./edit";
import type { SampleRange } from "@/types/audio";

/**
 * Where the audition came from. The recorder speaks this as the control's
 * label, so a screen-reader user is told what the tap will play before it
 * plays: the picked span, the audio from the centerline on, or the segment.
 */
type AuditionSource = "selection" | "line" | "whole";

export interface AuditionPlan {
  /** The half-open range of the working buffer to sound. Never empty. */
  readonly range: SampleRange;
  readonly source: AuditionSource;
}

/**
 * Decide what edit-mode Play sounds, or `null` when there is nothing to hear.
 *
 * With a span picked, the audition is **exactly** the samples a cut would
 * remove: the same `clampRange` normalisation `useSegmentEditor.cut` runs, so
 * the preview and the scissors cannot disagree about what is selected. A
 * reversed span (a handle dragged past its partner — the editor deliberately
 * leaves those unordered so the handle stays under the finger) normalises here,
 * and a span from which no whole sample would be taken — collapsed, clamped
 * shut, shorter than a sample, or carrying a non-finite edge — is `null` rather
 * than a claim on the audio floor for zero samples.
 *
 * With nothing picked, the audition runs from the centerline — the line the
 * translator can see, and the sample a record would splice at — to the end of
 * the working buffer. The sheet opens append-ready with that line resting at
 * the END of the audio (F7), where "from the line" is silence and a Play that
 * sounds nothing reads as a broken control; a range that would cover the whole
 * buffer anyway is therefore reported as `"whole"`, so the label matches what
 * is actually heard. A non-finite centerline (NaN survives `viewportWindow`'s
 * clamp) takes that same whole-buffer branch.
 *
 * `null` is the recorder's cue to disable the control — state-in-place, not a
 * message.
 */
export function auditionPlan(
  workingLength: number,
  selection: SampleRange | null,
  centerlineSample: number
): AuditionPlan | null {
  if (!(workingLength > 0)) return null;

  if (selection !== null) {
    const range = clampRange(selection, workingLength);
    // Empty is decided the way the audio is actually taken, not by comparing the
    // two floats: both `subarray` (the audition) and `slice` (`sliceRange`, the
    // cut) TRUNCATE their indices, so a span living inside one sample removes
    // nothing and sounds nothing. A plain `start === end` also let `NaN` through
    // — `NaN === NaN` is false — and a `subarray(NaN, NaN)` is empty, so either
    // hole leaves a live control that visibly does nothing when tapped (Frank R1
    // F1, George R1 P3-1). `!(a > b)` rejects the non-finite case with the same
    // shape used below.
    if (!(Math.trunc(range.end) > Math.trunc(range.start))) return null;
    return { range, source: "selection" };
  }

  // Both bounds are `>` tests rather than a `Number.isFinite` special case: NaN
  // (which survives a clamp, so `viewportWindow`'s own clamping does not rule it
  // out) fails each of them and falls to the whole-buffer branch by the same
  // rule a resting line does. That is the `!(x > 0)` shape `meter.ts` and
  // `captureWindow` already use; an explicit finite guard beside it was dead
  // code — the mutation run for this file could not kill it.
  const from = Math.max(0, Math.min(centerlineSample, workingLength));
  return from > 0 && from < workingLength
    ? { range: { start: from, end: workingLength }, source: "line" }
    : { range: { start: 0, end: workingLength }, source: "whole" };
}
