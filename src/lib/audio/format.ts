/**
 * Canonical audio format and sample conversions.
 *
 * Everything inside the app is mono 16-bit PCM at CANONICAL_SAMPLE_RATE.
 * Device capture is normalised to this on ingest (see `@/hooks/use-recorder`)
 * so that no other module has to know whether the phone produced webm/opus or
 * mp4/aac.
 */

/**
 * 44.1 kHz: natively supported by the MP3 encoder (no resample on export) and
 * comfortably above what speech needs. Mono, because this records one human
 * voice and stereo would double storage for nothing.
 */
export const CANONICAL_SAMPLE_RATE = 44_100;
export const CANONICAL_CHANNELS = 1;

export const INT16_MAX = 32_767;
const INT16_MIN = -32_768;

/** Convert normalised float samples in [-1, 1] to 16-bit PCM, with clipping. */
export function floatToInt16(input: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i]!;
    // Scale by the positive maximum, then clamp. Scaling by 32768 and
    // clamping to 32767 would make full-scale positive samples wrap.
    const scaled = Math.round(s * INT16_MAX);
    out[i] =
      scaled > INT16_MAX ? INT16_MAX : scaled < INT16_MIN ? INT16_MIN : scaled;
  }
  return out;
}

/**
 * Convert a window of 16-bit PCM into a caller-owned Float32Array, returning
 * how many samples were written.
 *
 * Fills `output` from `input[start]` onward, stopping at whichever runs out
 * first, and touches nothing beyond what it wrote. The return value is the whole
 * contract for where the real samples end: on a short tail the caller must pass
 * a `subarray` of exactly that count onward, because whatever sat in the rest of
 * the window is left alone rather than cleared.
 *
 * WINDOWED on purpose (#175). The predecessor allocated one Float32 for a whole
 * clip, which on a ten-minute segment is 105.8 MB handed to a `copyToChannel`
 * that then holds its own copy. Playback now reuses one one-second window for
 * the whole clip, so the peak is the window, not the recording.
 *
 * `start` must be a NON-NEGATIVE INTEGER, and a violation throws rather than
 * clamping (Frank round-2 P2). A negative or fractional start leaves `count`
 * positive while every `input[start + i]` misses a real index, so the window
 * would fill with `undefined / INT16_MAX` — NaN, handed to a `copyToChannel`
 * whose out-of-range behaviour is implementation-defined. No caller does this
 * today; the throw is here so a future one is told, not silently given noise.
 *
 * The floor is clamped for the same reason `computePeaks` clamps it: Int16 is
 * asymmetric, so -32768 over INT16_MAX is -1.0000305. `floatToInt16` stores
 * -32768 for any input at or below -1, so a clipped take round-trips through
 * here on every play — this feeds `copyToChannel` in hooks/audio-io.ts, where
 * out-of-range sample handling is implementation-defined.
 */
export function int16ToFloatInto(
  input: Int16Array,
  output: Float32Array,
  start: number
): number {
  if (!Number.isInteger(start) || start < 0) {
    throw new RangeError(
      `int16ToFloatInto: start must be a non-negative integer, got ${start}`
    );
  }
  const count = Math.min(output.length, Math.max(0, input.length - start));
  for (let i = 0; i < count; i++) {
    output[i] = Math.max(-1, input[start + i]! / INT16_MAX);
  }
  return count;
}

export function framesToMs(
  frames: number,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): number {
  return (frames / sampleRate) * 1000;
}

export function msToFrames(
  ms: number,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): number {
  return Math.round((ms / 1000) * sampleRate);
}
