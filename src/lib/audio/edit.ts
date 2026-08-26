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
