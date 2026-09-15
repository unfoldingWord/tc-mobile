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
 * A clip-fraction window: which slice of a clip is drawn and where the fixed
 * line sits across it — the `view` the canvas `Waveform` renders through. The
 * fractions are of the whole clip and may fall outside `[0,1]`: that overhang
 * is the blank the audio pans over (the B4 pan window) or grows into (the
 * live-capture scope, #120). View geometry, so it lives here beside
 * `WaveformViewport` (the sample-space model) rather than in the clip/PCM
 * domain types — one owner shared by the pan path, `captureWindow`, and the
 * component's `view` prop, so the three cannot drift apart.
 */
export interface WaveformWindow {
  /** Clip fraction at the viewport's left edge (may be < 0). */
  readonly startFraction: number;
  /** Clip fraction at the viewport's right edge (may be > 1). */
  readonly endFraction: number;
  /** Where the fixed line is drawn, as a fraction of viewport width. */
  readonly centerFraction: number;
}

/**
 * The visible sample window for a given pan, zoom, and centerline position.
 *
 * `zoom` is "how many times the clip is wider than the viewport": 1 fits the
 * whole clip, 4 shows a quarter of it (the 100% / 25% toggle). `centerFraction`
 * is where the fixed centerline sits across the viewport width (0 = left edge,
 * 1 = right edge). The UI owns that value; this function honours whatever it is
 * given (the recorder passes `CENTER_FRACTION`).
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

/**
 * Where the pan must sit, at `zoom`, for `selection` to stay on screen (#91).
 *
 * The zoom toggle used to change only the zoom, leaving the pan untouched. The
 * window then shrank around a pan that had nothing to do with the span being
 * edited, and the selection walked off the viewport — the first external tester
 * reported it as the control "extending the selection off screen" and could not
 * tell whether the button acted on the view or on the selection. Re-centring the
 * pan is what makes the answer "on the view, and the selection stays put".
 *
 * Three cases:
 *
 * 1. **No selection** — nothing to keep in view; the pan is returned clamped and
 *    otherwise untouched, so a plain zoom still behaves as it always has.
 * 2. **Wider than the window** — it cannot all fit, so the START edge is pinned
 *    to the left of the viewport. The start is where a translator reaches first,
 *    and the end is one pan away; showing neither edge is the failure mode.
 * 3. **Otherwise** — the span fits, so every pan in `[panAtEndEdge,
 *    panAtStartEdge]` shows all of it, and the current pan is clamped into that
 *    interval. That single clamp covers both of the cases the UI cares about: a
 *    span already on screen is inside the interval and comes back **unchanged**
 *    (moving a pan that did not need to move is its own lie about what the
 *    control did), and a span off one edge travels the MINIMUM distance that
 *    brings it in, landing against the edge it came in over rather than jerking
 *    to the centre.
 *
 * `selection` is the RAW picked span (`SegmentEditor.selection` is unclamped —
 * only its own `canCut` reader clamps), so both edges are clamped to
 * `[0, length]` here before anything is computed. The result is always within
 * `[0, length]`: the pan is also the record insertion offset, and there is no
 * such thing as inserting before the start or after the end.
 *
 * Clamping the admissible interval to the clip cannot invert it — clamping is
 * monotone and the raw interval is non-empty whenever the span fits — so the
 * final `min`/`max` always names a pan that really does show the span. At
 * `zoom` 1 the window spans the whole clip, so the span ALWAYS fits and nothing
 * can be left off screen on the way back out.
 */
export function panForZoom(
  length: number,
  pan: number,
  zoom: number,
  centerFraction: number,
  selection: SampleRange | null
): number {
  // The same clamp `viewportWindow` applies to `centerlineSample`, for the same
  // reason: this value is the record insertion offset as well as the pan.
  const clampPan = (p: number) => Math.max(0, Math.min(p, length));
  // Nothing picked: a plain zoom, and the pan is only clamped (a `panState` set
  // before a cut can be stale past the new end — the same reason the recorder
  // clamps it before drawing).
  if (selection === null) return clampPan(pan);

  const lo = clampPan(Math.min(selection.start, selection.end));
  const hi = clampPan(Math.max(selection.start, selection.end));
  const visible = length / zoom;

  // The pan that puts the span's START on the left edge of the viewport
  // (`start = pan - centerFraction * visible`), and the one that puts its END on
  // the right edge (`end = pan + (1 - centerFraction) * visible`).
  const panAtStartEdge = lo + centerFraction * visible;
  const panAtEndEdge = hi - (1 - centerFraction) * visible;

  // ONE clamp, on every path. The intermediates above are deliberately left
  // raw: with `lo`/`hi` already inside the clip, clamping each of them would add
  // branches no input can reach — which mutation testing shows to be untestable
  // rather than safe. There is no empty-segment guard either, for the same
  // reason: at `length` 0 every term above is already 0 and this returns 0,
  // matching `viewportWindow`, which likewise carries no divide-by-zero guard.
  return clampPan(
    hi - lo >= visible
      ? panAtStartEdge
      : Math.max(panAtEndEdge, Math.min(pan, panAtStartEdge))
  );
}

/**
 * The view window for the live capture scope: the ring's clip-fractions [0,1]
 * mapped onto screen [0, headFraction], so the newest column sits toward the
 * head and history runs left, with the head's right left blank.
 *
 * Live capture is a THIRD view mode, distinct from the B4 pan window: there the
 * audio pans under a fixed line; here it grows from the head and streams
 * right-to-left (#120). Solving `(1 - start)/span = headFraction` with
 * `start = 0` gives `endFraction = 1 / headFraction`. This is the pure geometry
 * ONLY. The browser lane owns how the columns are actually drawn through it —
 * the exact bar placement, and whether it reuses the `view` draw path or a
 * dedicated one — because that path maps a column at `i / capacity`, so the
 * newest bar butts up just short of the head rather than landing dead on it:
 * fine for a scope, but a claim to pin against a real drawer, not here (#120,
 * George R1).
 *
 * `headFraction` is where the record head sits across the width. **Which value
 * ships is a deferred UX call (the requirements owner, #120):** the B4
 * `CENTER_FRACTION` (0.5, history fills the left half) or the right edge (1, a
 * full-width scope). This
 * function serves either — at 1 the span is 1 and the scope spans the whole
 * width. A non-positive or non-finite head (0, negative, NaN) has no room to
 * its left and would divide by zero, so it clamps up to `EPSILON` — the same
 * `!(x > 0)` guard `meter.ts` uses, which also rejects NaN.
 *
 * `LiveScope` draws through this in a dedicated pull-model loop — NOT as
 * `Waveform`'s `view`/`peaks` prop, which the existing canvas cannot use for
 * the live ring (#120).
 */
export function captureWindow(headFraction: number): WaveformWindow {
  // Clamp into [EPSILON, 1]. `Number.isFinite(x) && x > 0` rejects NaN,
  // ±Infinity, 0 and negatives (all → EPSILON); the `Math.max(EPSILON, …)` also
  // catches a positive underflow like `Number.MIN_VALUE`, whose reciprocal is
  // Infinity and would leave `endFraction` non-finite (Frank R2).
  const head =
    Number.isFinite(headFraction) && headFraction > 0
      ? Math.max(Number.EPSILON, Math.min(1, headFraction))
      : Number.EPSILON;
  return { startFraction: 0, endFraction: 1 / head, centerFraction: head };
}

/**
 * Map a playback position — a fraction `[0,1]` of the WHOLE clip — to its x as a
 * fraction of the current viewport width, given the window's clip-fraction edges
 * (`startFraction`/`endFraction`, the same `view` the bars are drawn through).
 *
 * The recorder's playhead rides the identical transform the bars use
 * (`(clipFraction - startFraction) / span`), so it lands over the sample it
 * marks. The result is deliberately UNCLAMPED: a value < 0 or > 1 means the
 * playhead is off-screen in the blank head/tail, and the draw code skips it
 * rather than pinning it to an edge. The window span is never zero (zoom ≥ 1,
 * length ≥ 1), matching `viewportWindow`, so no divide-by-zero guard.
 */
export function playheadViewportX(
  playheadClipFraction: number,
  startFraction: number,
  endFraction: number
): number {
  return (playheadClipFraction - startFraction) / (endFraction - startFraction);
}
