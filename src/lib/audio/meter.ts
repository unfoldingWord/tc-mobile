/**
 * VU meter core — the pure math behind the recorder's level indicator.
 *
 * DOM-free by design (the onion rule): the browser boundary that owns the live
 * audio tap is `hooks/audio-io.ts`. That hook reads a time-domain frame from an
 * `AnalyserNode` and hands the raw `Float32Array` here; this module never sees
 * Web Audio, only numbers. That is what keeps the meter unit-testable in Node.
 *
 * A frame is one animation-rate slice of the capture signal, samples in
 * roughly [-1, 1] (the range `AnalyserNode.getFloatTimeDomainData` promises).
 *
 * `rmsLevel` is the one raw measure: root-mean-square, i.e. signal energy. This
 * is the classic "volume unit" — it tracks *perceived loudness* and is stable
 * frame to frame, so a bar driven by it sits still under a steady voice instead
 * of flickering. It is the honest answer to "is my voice being captured at a
 * healthy level", which is the meter's whole job in a text-free UI.
 *
 * The display pipeline is `rmsLevel` -> `toDisplayLevel` (dB-compress to a 0..1
 * scale) -> `meterZone` (colour band): one dB mapping, one set of thresholds,
 * defined once below.
 *
 * Known limitation, recorded honestly rather than scaffolded for: the red zone
 * is RMS-driven like the rest. Clipping is a *peak* phenomenon, so a dedicated
 * near-clip warning would want the largest single sample as its input. That is
 * a deliberate follow-up, not code left in the tree — no peak measure ships
 * until something consumes it.
 */

export type MeterZone = "green" | "yellow" | "red";

/**
 * Amplitudes at or below this map to an empty meter.
 *
 * Speech is quiet: a healthy spoken voice peaks somewhere around -20 to -6
 * dBFS, and room tone / near-silence sits well below that. A linear amplitude
 * bar would leave a normal voice barely off the bottom, so the display scale is
 * in decibels with a floor. -55 dBFS puts genuine near-silence at empty while
 * keeping even a soft-but-real voice clearly lit; anything below reads as no
 * signal. Chosen inside the -50..-60 dBFS band a speech VU wants.
 */
export const METER_FLOOR_DBFS = -55;

/**
 * Zone thresholds on the 0..1 *display* level (not raw amplitude).
 *
 *   green  : [0, METER_GREEN_MAX)        healthy — the target range
 *   yellow : [METER_GREEN_MAX, METER_YELLOW_MAX)  hot — loud, still safe
 *   red    : [METER_YELLOW_MAX, 1]       near clip — back off
 *
 * Boundaries belong to the higher zone (`>=` turns the corner) so exactly-on
 * values never read as the calmer colour. With the -55 dBFS floor, 0.75 display
 * is about -13.75 dBFS and 0.90 is about -5.5 dBFS, so red begins roughly 5 dB
 * before full scale — a warning with headroom left, not a clip that already
 * happened.
 */
export const METER_GREEN_MAX = 0.75;
export const METER_YELLOW_MAX = 0.9;

/** RMS (energy) of the frame, clamped to [0, 1]. 0 for an empty frame. */
export function rmsLevel(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i]!;
    sumSquares += s * s;
  }
  const rms = Math.sqrt(sumSquares / frame.length);
  return rms > 1 ? 1 : rms;
}

/**
 * Compress a raw amplitude in [0, 1] to a 0..1 display level on a dB scale.
 *
 * `20*log10(amplitude)` is dBFS; that is mapped linearly from `METER_FLOOR_DBFS`
 * (-> 0) to 0 dBFS (-> 1) and clamped. Non-positive, NaN, and sub-floor inputs
 * are the empty meter; at-or-above full scale is a full meter.
 */
export function toDisplayLevel(rawLevel: number): number {
  // `> 0` also rejects NaN, -0, and negatives, so log10 never sees them.
  if (!(rawLevel > 0)) return 0;
  const dbfs = 20 * Math.log10(rawLevel);
  if (dbfs <= METER_FLOOR_DBFS) return 0;
  if (dbfs >= 0) return 1;
  // floor is negative, so (dbfs - floor) / -floor rises 0 -> 1 across the span.
  return (dbfs - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS;
}

/** Classify a 0..1 display level into a colour zone (boundaries turn upward). */
export function meterZone(displayLevel: number): MeterZone {
  if (displayLevel >= METER_YELLOW_MAX) return "red";
  if (displayLevel >= METER_GREEN_MAX) return "yellow";
  return "green";
}
