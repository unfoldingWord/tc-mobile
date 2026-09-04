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

/**
 * How a clip's bytes are stored in `clipData` (B8, D3).
 *
 *   pcm  canonical mono 16-bit PCM — the format every clip is recorded and
 *        edited in. ~5.3 MB/minute.
 *   mp3  the same audio transcoded at 64 kbps once the translator marked the
 *        segment Finished, the PCM dropped in the same transaction. ~0.5 MB/min.
 *
 * Editing a finished segment decodes the MP3 back to PCM at the browser
 * boundary (Q5 default: allowed, lossy); `generation` counts how many lossy
 * passes the audio has been through so that call stays reversible on evidence.
 */
type ClipEncoding = "pcm" | "mp3";

/** Stored audio, addressed by `ClipId`. Samples live separately from metadata. */
export interface ClipMeta {
  readonly id: ClipId;
  readonly sampleRate: number;
  /** Frames of the ORIGINAL PCM. Unchanged by a transcode: it is the duration. */
  readonly frameCount: number;
  readonly durationMs: number;
  readonly createdAt: number;
  /** What `clipData` holds under this id. */
  readonly encoding: ClipEncoding;
  /**
   * Lossy encode passes this audio has survived. 0 for PCM straight off the
   * microphone; 1 once transcoded on Finished; 2 if that MP3 was decoded, edited
   * and transcoded again, and so on. A replacement take inherits the prior
   * clip's count (an edit starts from decoded audio); an erase resets it.
   */
  readonly generation: number;
  /** Bytes held in `clipData` — PCM frames × 2, or the MP3's length. */
  readonly byteLength: number;
  /**
   * Row-resolution waveform peaks, kept ONLY on an `mp3` clip: the Segments list
   * draws its bars from these so listing a chapter never has to decode audio.
   * `null` on PCM, where peaks are computed from the samples on load.
   */
  readonly peaks: Peaks | null;
}

/**
 * A clip's metadata together with its stored bytes, discriminated on how they
 * are encoded so a consumer cannot read PCM samples off an MP3 clip by accident.
 * Decoding an `mp3` clip needs the browser (`decodeAudioData`) and lives in
 * `hooks/`; `lib/` code that needs samples takes a decoder (`AudioCodec`).
 */
export type Clip =
  | {
      readonly encoding: "pcm";
      readonly meta: ClipMeta;
      readonly samples: Int16Array;
    }
  | {
      readonly encoding: "mp3";
      readonly meta: ClipMeta;
      readonly mp3: Uint8Array<ArrayBuffer>;
    };

/**
 * The MP3 codec as `lib/` sees it: two async functions injected from `hooks/`.
 *
 * Encoding is pure JS (lamejs) but CPU-bound, so the browser runs it in a Web
 * Worker (B8, #34); decoding has no JS implementation here and uses the
 * browser's `decodeAudioData`. Neither belongs in `lib/`, and taking them as
 * parameters is what keeps the export and transcode paths unit-testable in Node
 * — tests pass the synchronous encoder wrapped in a promise and a fake decoder.
 */
export interface AudioCodec {
  /**
   * Canonical PCM → MP3 bytes. May reject with an `AbortError` when cancelled, or
   * with an `EncoderStalledError` when the worker goes silent past its deadline
   * (#166) — the browser codec's typed signals that the encode did not produce
   * bytes, distinct from an encoder that threw.
   */
  readonly encodeMp3: (samples: Int16Array) => Promise<Uint8Array<ArrayBuffer>>;
  /** MP3 bytes → canonical PCM. */
  readonly decodeMp3: (mp3: Uint8Array<ArrayBuffer>) => Promise<Int16Array>;
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
