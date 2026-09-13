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
 * Convert 16-bit PCM back to normalised floats in [-1, 1].
 *
 * The floor is clamped for the same reason `computePeaks` clamps it: Int16 is
 * asymmetric, so -32768 over INT16_MAX is -1.0000305. `floatToInt16` stores
 * -32768 for any input at or below -1, so a clipped take round-trips through
 * here on every play — this feeds `copyToChannel` in hooks/audio-io.ts, where
 * out-of-range sample handling is implementation-defined.
 */
export function int16ToFloat(input: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = Math.max(-1, input[i]! / INT16_MAX);
  }
  return out;
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
