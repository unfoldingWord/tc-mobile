/**
 * Recorder viewport geometry — pure sample math, no DOM.
 *
 * The B4 recorder draws the waveform under a FIXED centerline: the line does
 * not travel, the audio pans beneath it. That turns "which part of the clip is
 * on screen" into a function of three things — how far the clip is panned
 * (which sample sits under the centerline), the zoom, and where the centerline
 * is across the viewport — and none of them need a canvas to compute. So the
 * windowing is here, DOM-free and testable in plain Node, and the component is
 * left with only the drawing.
 *
 * The window this returns is deliberately *unclamped* at its edges: when the
 * clip is panned to its end the window runs past `length`, and that overhang is
 * the blank space an append grows into (mockup 3). The caller clamps to
 * `[0, length]` when it reaches for samples; the raw window is what tells it
 * where the blank head and tail are. `centerlineSample` is the one value that
 * is clamped, because it is also the record insertion offset and there is no
 * such thing as inserting before the start or after the end.
 */

import type { SampleRange } from "@/types/audio";

export interface WaveformViewport {
  /** First sample visible. May be < 0 — blank space to the left of the audio. */
  readonly start: number;
  /** One past the last visible sample. May be > length — blank to the right. */
  readonly end: number;
  /** Samples the viewport spans at this zoom (`length / zoom`). */
  readonly visibleSamples: number;
  /**
   * The sample under the centerline — the pan, clamped to `[0, length]`. This
   * is what a record-at-centerline uses as its insertion offset.
   */
  readonly centerlineSample: number;
}

/**
 * The visible sample window for a given pan, zoom, and centerline position.
 *
 * `zoom` is "how many times the clip is wider than the viewport": 1 fits the
 * whole clip, 4 shows a quarter of it (the 100% / 25% toggle). `centerFraction`
 * is where the fixed centerline sits across the viewport width (0 = left edge,
 * 1 = right edge); B4 puts it right of centre, so the recorded audio sits to
 * its left with room to the right to grow into.
 */
export function viewportWindow(
  length: number,
  pan: number,
  zoom: number,
  centerFraction: number
): WaveformViewport {
  const visibleSamples = length / zoom;
  const centerlineSample = Math.max(0, Math.min(pan, length));
  const start = centerlineSample - centerFraction * visibleSamples;
  const end = centerlineSample + (1 - centerFraction) * visibleSamples;
  return { start, end, visibleSamples, centerlineSample };
}

/**
 * Map a pointer x within the waveform stage to a sample position.
 *
 * The inverse of `sampleToViewportX`. `x` is in CSS pixels from the left edge
 * of the stage, `width` the stage's `clientWidth`. B5's selection handles read
 * a pointer position back into sample space with this — the same scale the pan
 * drag already uses (`delta = -(dx / width) * visibleSamples`), so a handle and
 * a pan move the waveform by the same amount per pixel.
 *
 * Deliberately unclamped, matching `viewportWindow`: the result can be < 0 or
 * > length in the blank head/tail, and the caller clamps to `[0, length]` when
 * it turns the sample into a selection edge.
 */
export function viewportXToSample(
  x: number,
  width: number,
  win: WaveformViewport
): number {
  return win.start + (x / width) * win.visibleSamples;
}

/**
 * Map a sample position to its x within the stage, in CSS pixels.
 *
 * The inverse of `viewportXToSample`. B5 positions the selection rectangle and
 * its edge handles with this. Equivalent to the canvas' own fraction form
 * (`x = ((s/length - startFraction) / span) * w`) but expressed in the sample
 * units the viewport already works in, so the overlay and the pan share one
 * coordinate model.
 */
export function sampleToViewportX(
  sample: number,
  width: number,
  win: WaveformViewport
): number {
  return ((sample - win.start) / win.visibleSamples) * width;
}

/**
 * Where an absolute pan sits after `range` is cut from the buffer.
 *
 * The B4 centerline marks a fixed sample; a B5 cut that removes audio BEFORE it
 * shifts that sample left, or the line would silently come to mark a later point
 * in the speech and a record would splice there (George R5). Subtract only the
 * removed samples that lay before the pan: a cut entirely after the line leaves
 * it, and a cut straddling it lands the line at the cut's start. A paste needs no
 * companion because it always inserts AT the centerline (`at === pan`), which
 * pushes only the audio to the line's right.
 */
export function panAfterCut(pan: number, range: SampleRange): number {
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const removedBeforePan = Math.min(hi, pan) - Math.min(lo, pan);
  return pan - removedBeforePan;
}
