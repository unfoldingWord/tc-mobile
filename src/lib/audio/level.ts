/**
 * Signal level of a whole buffer: peak, RMS, and how much of it sits on the
 * rails.
 *
 * The arithmetic behind the stored-playback level probe (`hooks/audio-probe.ts`,
 * #555, #612, #269). Pure and DOM-free so the numbers a device reading reports
 * are pinned in Node; the probe only decides when to measure and where the
 * reading goes.
 *
 * Distinct from `meter.ts`'s `rmsLevel`, which is a per-frame VU reading
 * clamped to [0, 1] for display. This one reports in the input's own units and
 * in dBFS against a stated full scale, so an Int16 buffer and a decoder's
 * Float32 channel can be read on one scale.
 */

export interface SignalLevel {
  readonly frames: number;
  /** Largest absolute sample, in the input's units. */
  readonly peak: number;
  /** Root-mean-square, in the input's units. 0 for an empty buffer. */
  readonly rms: number;
  /** `20·log10(peak / fullScale)`; -Infinity for silence. */
  readonly peakDbfs: number;
  /** `20·log10(rms / fullScale)`; -Infinity for silence. */
  readonly rmsDbfs: number;
  /** Samples whose magnitude is at or beyond `fullScale`. */
  readonly clipped: number;
}

/**
 * Measure `samples` against `fullScale` (`INT16_MAX` for canonical PCM, 1 for a
 * Web Audio channel).
 *
 * Reads the view it is given, index by index — a `subarray` is measured as its
 * own samples, never its backing store's.
 */
export function measureLevel(
  samples: ArrayLike<number>,
  fullScale: number
): SignalLevel {
  const frames = samples.length;
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (let i = 0; i < frames; i++) {
    const s = samples[i]!;
    const magnitude = Math.abs(s);
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= fullScale) clipped++;
    sumSquares += s * s;
  }
  const rms = frames === 0 ? 0 : Math.sqrt(sumSquares / frames);
  return {
    frames,
    peak,
    rms,
    peakDbfs: 20 * Math.log10(peak / fullScale),
    rmsDbfs: 20 * Math.log10(rms / fullScale),
    clipped,
  };
}
