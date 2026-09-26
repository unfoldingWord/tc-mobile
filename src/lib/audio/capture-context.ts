/**
 * The existing clip either side of a take in flight — the pure half of the
 * composed live view (#640).
 *
 * While a take records, `LiveScope` draws the capture ring growing into the
 * head. Before #640 that was ALL the stage showed, so a second take (an
 * append) or a mid-clip insert hid the audio the segment already held until
 * the take committed. The requirements owner's call (2026-09-25, #640): the
 * existing audio stays visible — to the left of the head for an append, on
 * both sides for an insert; a blank left half is right only for a first take
 * or a playhead at the very start.
 *
 * This module turns the working buffer and the take's insertion offset into
 * that context, and folds it to whatever column rate the live scope turns out
 * to run at. DOM-free by the onion rule, so the geometry is a Node test.
 *
 * **The scale is the live scope's, not `Waveform`'s.** A capture column is one
 * animation frame (`capture-peaks.ts`), so the scope's time scale is the
 * device's frame rate, which is not a constant — 60 Hz on one phone, 90 or 120
 * on another. The context has to be drawn at the SAME seconds-per-column as the
 * ring beside it or the two would disagree about how long a second is. So it is
 * held here at a fine, fixed bucket size and folded per paint to the measured
 * rate ({@link estimateColumnRate}), rather than precomputed at an assumed one.
 *
 * **Absolute level, like the ring.** No display fit (#358): the scope is drawn
 * absolute so a too-quiet mic looks too quiet (#359), and the clip beside it is
 * drawn on the same scale so the two halves are comparable. The stored clip's
 * fitted look returns when the take commits and `Waveform` takes the stage
 * back, the same scale change an append has always had at that edge.
 */

import { CANONICAL_SAMPLE_RATE, INT16_MAX } from "./format";

/**
 * One side of the context: fine min/max buckets walking AWAY from the
 * insertion offset. Index 0 is the bucket touching the offset on both sides —
 * for `before`, the audio just left of it; for `after`, the audio just right
 * of it — so a drawer places them outward from the take without reversing
 * anything. `count` is how many buckets are real (the arrays may be longer).
 */
export interface ContextSide {
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly count: number;
}

/** The clip either side of a take's insertion offset. */
export interface CaptureContext {
  /** The audio before the offset, nearest-first (see {@link ContextSide}). */
  readonly before: ContextSide;
  /** The audio from the offset on, nearest-first. */
  readonly after: ContextSide;
  /** Samples per fine bucket — the unit {@link foldContextSide} folds from. */
  readonly samplesPerBucket: number;
}

/**
 * Fine bucket size, in samples. 147 is 300 buckets a second at 44.1 kHz:
 * finer than any frame rate a phone paints at (≤ 240 Hz), so a fold never has
 * to split a bucket, and coarse enough that building the context is one pass
 * over a few seconds of audio at the Record tap.
 */
export const CONTEXT_BUCKET_SAMPLES = 147;

/**
 * How much audio each side keeps, in samples. The scope's left half is
 * `SCOPE_CAPACITY` columns (`use-recorder.ts`), about 6 s at a 30 Hz frame
 * rate; 8 s covers that with room, and bounds the Record-tap cost on a
 * long take instead of walking the whole segment.
 */
const CONTEXT_MAX_SAMPLES = 8 * CANONICAL_SAMPLE_RATE;

function side(
  working: Int16Array,
  from: number,
  direction: 1 | -1,
  bucketSamples: number,
  maxSamples: number
): ContextSide {
  // How many samples lie that way from the offset, capped.
  const available = direction === 1 ? working.length - from : from;
  const span = Math.max(0, Math.min(available, maxSamples));
  const count = Math.ceil(span / bucketSamples);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    // Bucket b covers [near, far) measured outward from the offset; the last
    // bucket may be short where the clip (or the cap) ends.
    const near = b * bucketSamples;
    const far = Math.min(span, near + bucketSamples);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = near; k < far; k++) {
      const v = working[direction === 1 ? from + k : from - 1 - k]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Same normalisation, and the same clamp on Int16's asymmetric floor, as
    // `computePeaks`.
    min[b] = Math.max(-1, lo / INT16_MAX);
    max[b] = hi / INT16_MAX;
  }
  return { min, max, count };
}

/**
 * Build the context for a take about to record into `working` at `offset`.
 *
 * `null` when there is nothing to show: an empty segment (a first take). An
 * offset at the very start gives an empty `before`, one at the very end an
 * empty `after` — which is exactly the blank-left / blank-right the
 * requirements owner named as correct. `offset` is clamped into the buffer,
 * so a stale offset cannot index past it.
 */
export function buildCaptureContext(
  working: Int16Array,
  offset: number,
  bucketSamples: number = CONTEXT_BUCKET_SAMPLES,
  maxSamples: number = CONTEXT_MAX_SAMPLES
): CaptureContext | null {
  if (working.length === 0) return null;
  const size = Math.max(1, Math.floor(bucketSamples));
  const at = Number.isFinite(offset)
    ? Math.max(0, Math.min(working.length, Math.round(offset)))
    : 0;
  return {
    before: side(working, at, -1, size, maxSamples),
    after: side(working, at, 1, size, maxSamples),
    samplesPerBucket: size,
  };
}

/**
 * Fold one side's fine buckets into display columns of `bucketsPerColumn`
 * buckets each, nearest-first, into the caller's `outMin`/`outMax` (reused
 * across frames — no per-frame allocation, #102). Returns how many columns are
 * real: at most `maxColumns`, `outMin.length`, and what the side holds.
 *
 * Column `j` covers buckets `[floor(j * b), floor((j + 1) * b))`, widened to at
 * least one bucket, so a fractional `bucketsPerColumn` keeps its long-run rate
 * without dropping or double-counting a bucket. A non-positive or non-finite
 * rate folds nothing.
 */
export function foldContextSide(
  s: ContextSide,
  bucketsPerColumn: number,
  maxColumns: number,
  outMin: Float32Array,
  outMax: Float32Array
): number {
  if (!(bucketsPerColumn > 0) || !Number.isFinite(bucketsPerColumn)) return 0;
  const limit = Math.min(maxColumns, outMin.length, outMax.length);
  let j = 0;
  for (; j < limit; j++) {
    const start = Math.floor(j * bucketsPerColumn);
    if (start >= s.count) break;
    const end = Math.min(
      s.count,
      Math.max(start + 1, Math.floor((j + 1) * bucketsPerColumn))
    );
    let lo = Infinity;
    let hi = -Infinity;
    for (let b = start; b < end; b++) {
      if (s.min[b]! < lo) lo = s.min[b]!;
      if (s.max[b]! > hi) hi = s.max[b]!;
    }
    outMin[j] = lo;
    outMax[j] = hi;
  }
  return j;
}

/** The frame rate a scope is assumed to run at until it has measured its own. */
export const NOMINAL_COLUMN_RATE = 60;

/**
 * The live scope's column rate, in columns per second, from what it has
 * actually pushed: `columns` over `elapsedMs`.
 *
 * Falls back to {@link NOMINAL_COLUMN_RATE} until there is enough to measure
 * (under a quarter second, or fewer than ten columns) — the first frames of a
 * take are the least regular — and clamps the result into [15, 240] so a
 * stalled or throttled frame clock cannot stretch the context off the stage.
 */
export function estimateColumnRate(columns: number, elapsedMs: number): number {
  if (!(elapsedMs >= 250) || !(columns >= 10)) return NOMINAL_COLUMN_RATE;
  const rate = columns / (elapsedMs / 1000);
  return Math.max(15, Math.min(240, rate));
}

/**
 * How many display columns fit to the RIGHT of the head, for a scope of
 * `buckets` columns drawn through a window of `span` (`captureWindow`'s
 * `endFraction - startFraction`). The ring's columns sit at index `0..buckets-1`
 * left of the head; column `buckets + j` lands at the head and beyond, and the
 * stage ends at index `buckets * span`. Zero for a head at the right edge.
 */
export function columnsRightOfHead(buckets: number, span: number): number {
  if (!(buckets > 0) || !(span > 1) || !Number.isFinite(span)) return 0;
  return Math.max(0, Math.ceil(buckets * span) - buckets);
}
