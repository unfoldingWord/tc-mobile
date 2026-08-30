/**
 * Audio types.
 *
 * Canonical internal format is mono 16-bit PCM at a fixed sample rate
 * (see `CANONICAL_SAMPLE_RATE` in `@/lib/audio/format`).
 *
 * Why PCM rather than the compressed blob MediaRecorder hands us:
 *
 *  1. The spec requires sample-accurate waveform editing — cut, paste,
 *     insert. Those are trivial on PCM and impractical on a compressed
 *     stream without a decode/re-encode round trip per operation.
 *  2. Export is "concatenation of sections". Concatenating PCM at one
 *     canonical rate is a buffer join; concatenating compressed audio of
 *     mixed codecs (webm/opus on Android, mp4/aac on iOS) is not.
 *  3. Normalising at ingest means exactly one place in the codebase has to
 *     care which codec the device produced.
 *
 * The cost is storage: ~5.3 MB per minute of mono 16-bit 44.1 kHz. See
 * docs/decisions/0002-audio-storage-format.md for the sizing argument.
 */

import type { ClipId } from "./domain";

/** Stored audio, addressed by `ClipId`. Samples live separately from metadata. */
export interface ClipMeta {
  readonly id: ClipId;
  readonly sampleRate: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly createdAt: number;
}

/** A clip's metadata together with its decoded samples. */
export interface Clip {
  readonly meta: ClipMeta;
  readonly samples: Int16Array;
}

/**
 * Min/max pairs per horizontal pixel bucket, used to draw the waveform
 * without walking every sample on each frame. Values are normalised to
 * [-1, 1].
 */
export interface Peaks {
  readonly min: Float32Array;
  readonly max: Float32Array;
  /** Samples represented by each bucket. */
  readonly samplesPerBucket: number;
}

/** A half-open sample range `[start, end)` used by the editing operations. */
export interface SampleRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Which slice of a clip the recorder draws, and where the fixed line sits
 * across it — the `view` the canvas `Waveform` renders through. The fractions
 * are of the whole clip and may fall outside `[0,1]`: that overhang is the
 * blank the audio pans over (the B4 pan window) or grows into (the live-capture
 * scope, #120). One shared shape so the pan window, the capture window
 * (`captureWindow`), and the component's `view` prop cannot drift apart.
 */
export interface WaveformWindow {
  /** Clip fraction at the viewport's left edge (may be < 0). */
  readonly startFraction: number;
  /** Clip fraction at the viewport's right edge (may be > 1). */
  readonly endFraction: number;
  /** Where the fixed line is drawn, as a fraction of viewport width. */
  readonly centerFraction: number;
}
