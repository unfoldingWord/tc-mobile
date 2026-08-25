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
