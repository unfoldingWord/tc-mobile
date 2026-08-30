/**
 * Live-capture peak accumulator — the pure math behind the recorder's
 * waveform-that-grows-as-you-speak (#120).
 *
 * DOM-free by the onion rule, exactly like `meter.ts`: the browser boundary
 * that owns the live audio tap is `hooks/audio-io.ts`. That hook reads a
 * time-domain frame from an `AnalyserNode` and hands the raw `Float32Array`
 * here; this module never sees Web Audio, only numbers. That is what keeps the
 * live waveform unit-testable in Node.
 *
 * Where `meter.ts` reduces a frame to one RMS scalar (loudness), this reduces a
 * frame to one min/max **column** (shape) and keeps a fixed-width ring of the
 * most recent columns, so a canvas can draw a scope that scrolls right-to-left
 * under the record head. The full, sample-accurate waveform is a separate
 * concern — `computePeaks` builds that from the stored PCM once `stop()` has a
 * buffer. This is the *live* approximation shown only while capturing.
 *
 * Known limitation, recorded honestly rather than scaffolded for (cf. meter.ts):
 * one column per frame collapses a whole animation-rate slice (at fftSize 1024,
 * ~23 ms) into a single min/max bar, and `getFloatTimeDomainData` only exposes
 * the most-recent `fftSize` samples — so audio that falls between two frame
 * reads is not represented in the live scope. That is acceptable for a visual
 * "you are being heard" cue and is not a substitute for the post-stop
 * `computePeaks` pass, which sees every sample.
 */

import type { Peaks } from "@/types/audio";

/** One waveform column: the frame's extremes, normalised to [-1, 1]. */
export interface CaptureColumn {
  readonly min: number;
  readonly max: number;
}

/**
 * Reduce one animation-rate time-domain frame to a single min/max column.
 *
 * The frame is the same `Float32Array` the VU meter reads, samples in roughly
 * [-1, 1] (the range `AnalyserNode.getFloatTimeDomainData` promises). Both
 * extremes are kept — not a single absolute amplitude — because a waveform
 * drawn from absolute values loses the asymmetry that makes speech legible,
 * the same reason `computePeaks` keeps min and max (peaks.ts).
 *
 * A frame with no finite sample is a silent column, `{ min: 0, max: 0 }` —
 * never the `±Infinity` sentinel of an unbounded reduce, mirroring
 * `computePeaks`' empty-bucket handling. That covers both an empty frame and an
 * all-NaN one (NaN fails every comparison, so the sentinels survive the loop).
 * Finite values are clamped into [-1, 1]: the analyser can momentarily hand
 * back a sample a hair outside the range, and `Peaks` promises [-1, 1] to
 * whatever draws it. A lone NaN among finite samples is simply ignored, leaving
 * the real extremes — so `min <= max` always holds.
 */
export function reduceFrame(frame: Float32Array): CaptureColumn {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  // No finite sample moved the sentinels (empty frame, or all-NaN). Return the
  // silent column rather than letting the clamp map Infinity → 1 and -Infinity
  // → -1, which would be an inverted `min > max` column the canvas draws
  // upside-down. This is the guard `computePeaks` uses for the same shape.
  if (lo === Infinity) return { min: 0, max: 0 };

  return {
    min: lo < -1 ? -1 : lo > 1 ? 1 : lo,
    max: hi > 1 ? 1 : hi < -1 ? -1 : hi,
  };
}

/**
 * A fixed-capacity ring of the most-recent capture columns.
 *
 * `push` folds a frame in; `toPeaks` renders the ring to a `Peaks` the canvas
 * draws, ordered oldest-left to newest-right with the newest column at the last
 * index (the record head). While fewer than `capacity` columns have arrived the
 * front is zero-valued and `count` is short of `capacity` — the real columns
 * keep fixed spacing beside the head rather than stretching to fill. A `{0,0}`
 * slot is silence to a canvas, not blank, so the drawer skips the first
 * `capacity - count` slots via `count` (see `createCapturePeaks`).
 */
export interface CapturePeaks {
  /** Fold one time-domain frame in as the newest column, evicting the oldest. */
  push(frame: Float32Array): void;
  /**
   * The current ring as a `Peaks` of length `capacity`, newest at the last
   * index, front zero-padded until full.
   *
   * The returned arrays are one internal pair **reused on every call** — the
   * next `toPeaks()` overwrites them in place (a `push` alone does not; it only
   * writes the ring). Draw from them synchronously and never retain a returned
   * `Peaks` across a later `toPeaks()`, exactly as `audio-io.ts` reuses its
   * analyser `frame`. This is deliberate: allocating two
   * `Float32Array(capacity)` per animation frame is the per-tick reallocation
   * #102 calls out, so the live path must not.
   */
  toPeaks(): Peaks;
  /** Drop all accumulated columns — a new take starts from an empty scope. */
  reset(): void;
  /** Columns the ring holds (`length / zoom` has no meaning here). */
  readonly capacity: number;
  /** Live columns pushed so far, saturating at `capacity`. */
  readonly count: number;
}

/**
 * Create a live-capture peak ring holding the most-recent `capacity` columns.
 *
 * `capacity` is floored to at least 1 (a ring of zero columns has nothing to
 * draw and would divide by zero downstream), mirroring `computePeaks`' bucket
 * floor. The visible time span is `capacity / framesPerSecond`; picking
 * `capacity` and the sampling cadence is the browser lane's call (#120), not
 * this module's — it only promises the ring behaves for whatever size it is
 * given.
 *
 * No production caller yet — this is the pure slice of #120; the browser lane
 * owns the rendering integration, and it is NOT the "drop `toPeaks()` onto the
 * existing `Waveform`" an earlier draft of this comment implied (George R1).
 * That lane must:
 *   - extend the existing `LevelTap` to expose the time-domain frame — its
 *     `read()` reduces to RMS and discards the frame — rather than open a
 *     second `AudioContext`/analyser, which iOS caps (audio-io.ts, AGENTS.md);
 *   - skip the zero-padded prefix using `count`: a `{0,0}` slot is SILENCE to
 *     the canvas (`Math.max(1.5, 0)` still ticks a bar), not blank, so a drawer
 *     that paints every bucket renders the unfilled head as amber silence;
 *   - draw pull-model, not `setState(toPeaks())` per frame — that re-renders the
 *     recorder sheet at frame rate and reassigns the canvas backing store, the
 *     D-LEVEL-PULL / #102 trap `VuMeter` exists to avoid;
 *   - gate on `recording`, not `paused` — a paused mic still emits frames
 *     (`VuMeter` keys `active={recording}`, R-B6).
 * That contract is tracked on #120.
 *
 * @pivotpending #120 wires this into the recorder. knip does not flag it (the
 * capture tests import it), so this tag emits an "Unused tag" hint rather than
 * suppressing a failure — it stays as the honest marker the no-sprawl rule asks
 * for (Frank R1), naming the batch that consumes it.
 */
export function createCapturePeaks(capacity: number): CapturePeaks {
  // Floor to at least 1. A non-finite capacity must short-circuit BEFORE the
  // floor: `Math.floor(Infinity)` is Infinity and `new Float32Array(Infinity)`
  // THROWS RangeError (Frank R1), while `Math.floor(NaN)` gives a zero-length
  // ring — neither is the "at least 1" this promises. Non-positive floors to 1
  // too. The browser lane passes a real integer; this is the honest floor.
  const size = Number.isFinite(capacity)
    ? Math.max(1, Math.floor(capacity))
    : 1;

  // The ring proper, written modulo `size`, plus the reused output buffers so
  // `toPeaks` allocates nothing per frame.
  const ringMin = new Float32Array(size);
  const ringMax = new Float32Array(size);
  const outMin = new Float32Array(size);
  const outMax = new Float32Array(size);

  // `head` is where the NEXT column will be written; the newest already-written
  // column is one step behind it. `filled` saturates at `size`.
  let head = 0;
  let filled = 0;

  return {
    capacity: size,
    get count() {
      return filled;
    },

    push(frame: Float32Array) {
      const col = reduceFrame(frame);
      ringMin[head] = col.min;
      ringMax[head] = col.max;
      head = (head + 1) % size;
      if (filled < size) filled += 1;
    },

    toPeaks(): Peaks {
      // Walk back from the newest column, placing it at the last output index
      // and older columns leftward, so the head sits on the right. The unfilled
      // front stays zero-valued; `count` (= `filled`) is what tells the drawer
      // those slots are "not yet", since to a canvas `{0,0}` is silence, not
      // blank. `outMin`/`outMax` are overwritten every call, so no stale ring
      // data leaks past `filled`.
      for (let k = 0; k < size; k++) {
        const outIndex = size - 1 - k;
        if (k < filled) {
          const ringIndex = (head - 1 - k + 2 * size) % size;
          outMin[outIndex] = ringMin[ringIndex]!;
          outMax[outIndex] = ringMax[ringIndex]!;
        } else {
          outMin[outIndex] = 0;
          outMax[outIndex] = 0;
        }
      }
      // samplesPerBucket is meaningless for a live scope (a column is a frame,
      // not a fixed sample span); 0 says "not sample-addressable", matching how
      // `computePeaks` reports 0 for an empty buffer.
      return { min: outMin, max: outMax, samplesPerBucket: 0 };
    },

    reset() {
      // Only the counters need clearing: `toPeaks` zero-pads everything past
      // `filled`, so stale ring values are never read after a reset.
      head = 0;
      filled = 0;
    },
  };
}
