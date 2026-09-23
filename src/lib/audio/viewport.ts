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

/** The recorder's two surfaces. Kept as a literal union rather than imported:
 *  `lib/` never reaches upward, and a third mode would fail to compile at the
 *  call site, so the two cannot drift apart silently. */
type RecorderMode = "record" | "edit";

export interface EffectivePanInputs {
  readonly mode: RecorderMode;
  /** The B5 selection frame is open. */
  readonly selectionActive: boolean;
  /** Where the zoom moved the VIEW to keep that selection on screen (#91). */
  readonly zoomPan: number | null;
  /** The real pan — also the record insertion offset. `null` is the append rest. */
  readonly panState: number | null;
  /** The working buffer's length. */
  readonly length: number;
}

/**
 * Which pan the recorder draws through — and, in record mode, splices at.
 *
 * **This is the round-1 P1's guarantee, made readable.** `panState` is not only
 * a view value: `null` is the append rest, and the sample under the centerline
 * is what `onRecordButton` locks in as a take's insertion offset. The zoom's
 * view fit (`zoomPan`) therefore must never become it, or a zoom taken with a
 * selection open would move where the next recording splices — silently, since
 * the centerline does not travel.
 *
 * So the view pan is consulted **only** in edit mode with a selection open, and
 * both terms are independent guards rather than one restated twice: the mode
 * term holds even if a future path leaves a selection open on the way back to
 * record, and the selection term holds even if the mode is wrong. In record mode
 * `zoomPan` is not read at all, whatever it holds.
 *
 * Lifted out of the component so that separation can be tested: it is a pure
 * function of five values, and inside `recorder.tsx` nothing could reach it. It
 * pins the READER half only — that the record path ignores the view pan. The
 * WRITER half (that the zoom writes `zoomPan` and not `panState`) is still
 * structural and untested: a node-only suite with no renderer cannot observe
 * which setter a handler called. See the round-3 triage on #346.
 *
 * The fallback chain is deliberately nullish, not falsy: a pan of exactly 0 is
 * the start of the clip and must survive, where `||` would replace it with the
 * end. Only the UPPER bound is clamped, matching what this replaced — a cut can
 * shorten the buffer past a pan set before it, while no writer produces a
 * negative (the drag clamps at 0, and so does `panForZoom`).
 */
export function effectivePan(i: EffectivePanInputs): number {
  const viewPan = i.mode === "edit" && i.selectionActive ? i.zoomPan : null;
  return Math.min(viewPan ?? i.panState ?? i.length, i.length);
}

/**
 * Where an absolute pan sits after `range` is cut from the buffer.
 *
 * The B4 centerline marks a fixed sample; a B5 cut that removes audio BEFORE it
 * shifts that sample left, or the line would silently come to mark a later point
 * in the speech and a record would splice there (George R5). Subtract only the
 * removed samples that lay before the pan: a cut entirely after the line leaves
 * it, and a cut straddling it lands the line at the cut's start.
 *
 * A paste needs no companion — but the reason is now CONDITIONAL, and the
 * condition is not local to this file (George stand-in P3). It holds because
 * paste inserts at the centerline (`at === pan`), pushing only the audio to the
 * line's right — and the centerline is the pan only while `effectivePan` is
 * returning `panState`, i.e. while no selection is open. The recorder's paste
 * marker renders on exactly that condition, so today `at === pan` is always
 * true. A paste reachable WITH a selection open would paste at the view pan
 * instead, shifting samples under a `panState` this function would never be told
 * about; such a path must pass `panState`, not the drawn centerline, and would
 * need a companion here.
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
 * Both selection edges are clamped to `[0, length]` before anything is
 * computed. That is **defensive, not load-bearing for today's caller**:
 * `SegmentEditor`'s `openSelection` and `setSelection` already clamp each
 * endpoint to the working buffer, so the recorder cannot hand this an out-of-
 * range span (an earlier draft of this comment claimed the opposite — George R1
 * P3). It stays because the clamp is what makes the function total, and because
 * the span's REAL extent is what decides the wider-than-the-window branch: a
 * caller that measured raw handles would pin the viewport into blank space.
 *
 * The result is always within `[0, length]`: the pan is also the record
 * insertion offset, and there is no such thing as inserting before the start or
 * after the end.
 *
 * Note that `zoom` 1 means the viewport SPANS the clip's length — not that the
 * whole clip is on screen. With the pan at the end (the append rest) the window
 * is `[0.5L, 1.5L]`. Keeping a selection in view is all this promises, and it is
 * why the zoom control's label names the magnification rather than the extent.
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
 * How much of the visible window the edit toggle seeds a span across (#554).
 *
 * The centred seed this replaces spelled it as two halves of 0.15 around the
 * centerline, so the NOMINAL width is the same 0.3 — but the DELIVERED width
 * is not, and the difference lands on the commonest path. At the append rest
 * (`centerlineSample === length`, the state every fresh open of the sheet
 * starts in) the centred seed ran past the end of the buffer and
 * `openSelection`'s per-endpoint clamp truncated it, so only 0.15 of the
 * visible window was actually selected. This seed slides back off the end
 * instead of overrunning, so the same first tap delivers the full 0.3. Away
 * from the tail, where a full span of audio lies to the right of the
 * centerline, the delivered width was 0.3 and still is. The wider default is a
 * deliberate, accepted behaviour change: the DRI's decision is recorded at
 * https://github.com/unfoldingWord/tc-mobile/pull/560#issuecomment-5767057659.
 *
 * Module-private: the seed has exactly one reader.
 */
const SEED_SPAN_FRACTION = 0.3;

/**
 * The span the selection frame opens with (#554).
 *
 * The seed used to be centred on the centerline, so the playhead sat in the
 * MIDDLE of the span it had just created. The requirements owner's report: the
 * line marks where the translator is, and a span they are about to cut or
 * audition runs from there FORWARD — which is also the record/paste mental
 * model (the line is where the next thing begins) and makes the first handle
 * drag, extending the right edge, the common case.
 *
 * So the left edge is the playhead, and the span slides left only as far as
 * the end of the buffer forces (tail rule C, the dev lead's pick:
 * https://github.com/unfoldingWord/tc-mobile/pull/560#issuecomment-5794543851).
 * That last clause is not an edge case: the append rest puts
 * `centerlineSample === length` on every fresh open. Anchoring there and
 * letting the right edge run past the end would leave `openSelection`'s
 * per-endpoint clamp holding `{length, length}`, which `spansWholeSample` reads
 * as nothing selected: Cut and Play would open dead. Sliding keeps the width,
 * so the two handles never land on top of each other and the frame is
 * grabbable wherever it opens. The cost, stated plainly: within the last
 * span-width of the buffer the playhead is inside the span rather than on its
 * left edge, because there is not a full span of audio to its right.
 *
 * No clamps, and the `min` is the only branch, because `visibleSamples` is
 * `length / zoom` at `zoom >= 1`: the span is at most `0.3 * length`, so
 * `length - span` is never negative and `start` is never below 0, while
 * `start <= length - span` puts `end` at or inside `length`. A `Math.max(0,…)`
 * would be a branch no input can reach — what `panForZoom`'s own note calls
 * untestable rather than safe. At `length` 0 every term is 0 and this returns
 * `{0, 0}`, matching `viewportWindow`'s lack of a divide-by-zero guard.
 */
export function seedSelection(
  length: number,
  centerlineSample: number,
  visibleSamples: number
): SampleRange {
  const span = SEED_SPAN_FRACTION * visibleSamples;
  const start = Math.min(centerlineSample, length - span);
  return { start, end: start + span };
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
 * The strip the waveform is drawn on while a buffer sounds (#415/#417).
 *
 * Playback does not move a line across a still waveform; it moves the WAVEFORM
 * under a line that never leaves the centre (#415, the requirements owner:
 * "there is ONE playhead: the red line, always at the horizontal center").
 * Sliding a pan/zoom window one sample at a time would mean a new `view` — and
 * so a full canvas repaint plus a React render — every frame, which is #102's
 * finding at 60 Hz. So the clip is drawn ONCE, on a strip wider than the stage,
 * and the frame loop moves that strip with a single transform
 * ({@link playbackStripOffset}).
 *
 * The strip is the clip plus exactly ONE viewport of blank, split at the
 * centerline: `centerFraction` of a viewport ahead of the first sample, the rest
 * past the last. That is the blank #415 describes at both ends ("left of the
 * centerline there is no audio yet... at the end... the same grayed-out
 * horizontal line running to the right edge"), and it is the least padding that
 * lets both extremes of the position — 0 and `length` — sit under the line with
 * no gap at the stage edge.
 */
export interface PlaybackStrip {
  /** Clip fraction at the strip's left edge (always < 0 — the blank head). */
  readonly startFraction: number;
  /** Clip fraction at the strip's right edge (always > 1 — the blank tail). */
  readonly endFraction: number;
  /**
   * The strip's width as a multiple of the STAGE width: `(length + visible) /
   * visible`, i.e. `zoom + 1`. The component sets `width: widthFactor * 100%`,
   * so the strip needs no pixel measurement and survives a rotation.
   */
  readonly widthFactor: number;
}

/**
 * The strip to draw for a playback at this zoom. See {@link PlaybackStrip}.
 *
 * `visibleSamples` is what the STAGE spans at the current zoom (`length /
 * zoom`) — the same quantity {@link viewportWindow} computes, passed in rather
 * than recomputed so the scrolling view and the static one cannot drift to
 * different scales. Bar width works out identical to the static window's at the
 * same zoom, which is why starting playback does not rescale the waveform.
 *
 * `length > 0` is the precondition, as it is for `viewportWindow`: there is no
 * playback without audio, and the recorder never mounts the strip without it.
 */
export function playbackStrip(
  length: number,
  visibleSamples: number,
  centerFraction: number
): PlaybackStrip {
  const start = -centerFraction * visibleSamples;
  const end = length + (1 - centerFraction) * visibleSamples;
  return {
    startFraction: start / length,
    endFraction: end / length,
    widthFactor: (length + visibleSamples) / visibleSamples,
  };
}

/**
 * Where to put the strip so that `position` sits under the centerline, as a
 * fraction of the STRIP's own width (what a percentage `translateX` resolves
 * against). Runs from 0 at the clip's first sample to `-length / (length +
 * visibleSamples)` at its last.
 *
 * **`centerFraction` is deliberately absent, and that is not an omission.** The
 * strip already carries the line's position in its blank head (`-c * visible`
 * of it), so aligning the strip's left edge with the stage's left edge is
 * exactly what puts sample 0 under the line. What is left to do per frame is
 * only "how far has the clip travelled", which is the position over the strip's
 * span. The two must be built from the same `centerFraction` for that to hold —
 * they are, at the one call site — and `tests/audio-viewport.test.ts` asserts
 * the composition rather than either half.
 *
 * The clamp is the REQUIREMENT, not a defensive guard (#416: "The playhead must
 * not scroll past the end of the recorded waveform. The end sample is the
 * clamp... Symmetrically, it cannot scroll before the first sample."). A
 * sounding position cannot exceed the buffer today — `PlaybackHandle.elapsed`
 * clamps to the clip duration — but the same offset places a FROZEN position on
 * pause and a dragged one on lift (#317), and those have no such promise.
 */
export function playbackStripOffset(
  position: number,
  length: number,
  visibleSamples: number
): number {
  const clamped = Math.max(0, Math.min(position, length));
  return -clamped / (length + visibleSamples);
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
