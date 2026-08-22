/**
 * Waveform peak extraction.
 *
 * The UI draws one vertical bar per horizontal pixel. Walking every sample on
 * every animation frame would be wasteful on a low-end Android phone, so we
 * reduce the buffer to min/max pairs once and redraw from those.
 */

import type { Peaks } from "@/types/audio";

const INT16_MAX = 32_767;

/**
 * Reduce `samples` to `bucketCount` min/max pairs normalised to [-1, 1].
 *
 * Min *and* max are kept rather than a single amplitude because a waveform
 * drawn from absolute values loses the asymmetry that makes speech visually
 * legible — and legibility is the whole point of a waveform in a text-free UI.
 */
export function computePeaks(samples: Int16Array, bucketCount: number): Peaks {
  const buckets = Math.max(1, Math.floor(bucketCount));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);

  if (samples.length === 0) {
    return { min, max, samplesPerBucket: 0 };
  }

  const samplesPerBucket = samples.length / buckets;

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * samplesPerBucket);
    // Guarantee at least one sample per bucket when the buffer is shorter
    // than the requested bucket count, otherwise trailing buckets read an
    // empty span and render as a flat line through the middle.
    const end = Math.max(start + 1, Math.floor((b + 1) * samplesPerBucket));
    const stop = Math.min(end, samples.length);

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < stop; i++) {
      const v = samples[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }

    if (lo === Infinity) {
      min[b] = 0;
      max[b] = 0;
    } else {
      min[b] = lo / INT16_MAX;
      max[b] = hi / INT16_MAX;
    }
  }

  return { min, max, samplesPerBucket };
}
