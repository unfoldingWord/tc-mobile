/**
 * Sample-accurate editing operations.
 *
 * These are the "waveform editing (v1)" primitives from the inception notes:
 * an edit window that can cut, an edit marker that can paste, and insert.
 *
 * All functions are pure and return new buffers. None of them mutate their
 * inputs, so undo is just keeping the previous buffer, and every one of them
 * is testable in plain Node with no audio hardware.
 */

import type { SampleRange } from "@/types/audio";

/** Clamp a range to the buffer and normalise start/end order. */
export function clampRange(range: SampleRange, length: number): SampleRange {
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  return {
    start: Math.max(0, Math.min(lo, length)),
    end: Math.max(0, Math.min(hi, length)),
  };
}

/**
 * Would this range actually take any audio? The one "is anything selected?"
 * predicate, shared by everything that acts on a span.
 *
 * Selection edges are floats — pointer geometry, and a keyboard nudge of
 * `visibleSamples / 400` — while every consumer TRUNCATES its indices: `slice`
 * for a cut, `subarray` for an audition. So comparing the two floats asks the
 * wrong question, and asking it let the controls disagree with each other and
 * with the audio: on a span living inside one sample, Play went inert while Cut
 * stayed live and applied an empty cut, which advances the undo log and
 * REPLACES the chapter-wide clipboard with an empty buffer (Frank R3). `!(a > b)`
 * rather than `<=` so a non-finite edge — which `start === end` let through,
 * `NaN === NaN` being false — is rejected too.
 *
 * Takes an already-NORMALISED range: every call site clamps with `clampRange`
 * first, which is also what orders a reversed span.
 */
export function spansWholeSample(range: SampleRange): boolean {
  return Math.trunc(range.end) > Math.trunc(range.start);
}

/** Copy the samples inside `range`. Used for both copy and the cut clipboard. */
export function sliceRange(
  samples: Int16Array,
  range: SampleRange
): Int16Array {
  const { start, end } = clampRange(range, samples.length);
  return samples.slice(start, end);
}

/**
 * Remove `range` from `samples`.
 *
 * Returns both the shortened buffer and the removed audio, so a cut can feed
 * the clipboard for a later paste without a second pass.
 */
export function cut(
  samples: Int16Array,
  range: SampleRange
): { readonly remaining: Int16Array; readonly removed: Int16Array } {
  const { start, end } = clampRange(range, samples.length);
  const removed = samples.slice(start, end);
  const remaining = new Int16Array(samples.length - removed.length);
  remaining.set(samples.subarray(0, start), 0);
  remaining.set(samples.subarray(end), start);
  return { remaining, removed };
}

/**
 * Insert `insertion` at `atFrame`. This is both "insert" and "paste" — paste
 * is insert with the clipboard as the insertion.
 */
export function insertAt(
  samples: Int16Array,
  insertion: Int16Array,
  atFrame: number
): Int16Array {
  const at = Math.max(0, Math.min(Math.round(atFrame), samples.length));
  const out = new Int16Array(samples.length + insertion.length);
  out.set(samples.subarray(0, at), 0);
  out.set(insertion, at);
  out.set(samples.subarray(at), at + insertion.length);
  return out;
}

/** Replace `range` with `replacement` — the re-record-this-bit operation. */
export function replaceRange(
  samples: Int16Array,
  range: SampleRange,
  replacement: Int16Array
): Int16Array {
  const { remaining } = cut(samples, range);
  const { start } = clampRange(range, samples.length);
  return insertAt(remaining, replacement, start);
}

/**
 * Combine a segment's existing audio with a newly recorded fragment at an
 * offset — the record-at-centerline splice: insert mid-clip, append at the end.
 *
 * With nothing recorded (`recorded` empty) there is nothing to splice, so
 * `existing` is returned as-is rather than allocating a full-length copy of a
 * multi-megabyte segment. That is the B5 edit-only save, where `existing` is
 * already the whole flattened, edited buffer and the "recording" is empty.
 * Callers persist the result immediately, so returning the input by reference
 * is safe (the store copies through its own buffer).
 */
export function mergeTake(
  existing: Int16Array,
  recorded: Int16Array,
  offset: number
): Int16Array {
  return recorded.length === 0
    ? existing
    : insertAt(existing, recorded, offset);
}

/**
 * Join buffers end to end. This is what "export recording to MP3 —
 * concatenation of sections" reduces to once every clip is at the canonical
 * sample rate.
 */
export function concat(buffers: readonly Int16Array[]): Int16Array {
  let total = 0;
  for (const b of buffers) total += b.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

/**
 * Generate `frames` of silence — used to pad between concatenated sections so
 * an exported chapter does not run its stories together.
 */
export function silence(frames: number): Int16Array {
  return new Int16Array(Math.max(0, Math.round(frames)));
}

/**
 * Fit `samples` to exactly `frames`: trim a longer buffer to a view of its first
 * `frames`, pad a shorter one with silence, return the same buffer when the
 * length already matches.
 *
 * Exists for MP3 decodes (B8). A decoded finished segment is not sample-exact —
 * LAME pads the head and tail of the stream (~1.1k samples), and whether the
 * decoder trims that back out depends on whether it honours the LAME info tag
 * (Chromium did not, in the B8 browser run: 133,632 frames back for 132,300).
 * The clip's `frameCount` is the length the translator recorded, and every
 * consumer of a decode — export, playback, the recorder's edit buffer — fits to
 * it here, so the phone's decoder cannot move a segment's duration, and an
 * edit → Finished → edit cycle cannot grow the audio by a padding each time
 * (round-1 Frank F1 / George G3).
 */
export function fitToFrames(samples: Int16Array, frames: number): Int16Array {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new RangeError(`Cannot fit audio to ${frames} frames`);
  }
  if (samples.length === frames) return samples;
  if (samples.length > frames) return samples.subarray(0, frames);
  const out = new Int16Array(frames);
  out.set(samples);
  return out;
}
