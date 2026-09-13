/**
 * MP3 encoding.
 *
 * Browsers can decode MP3 but none of them can encode it, so the spec's
 * "export recording to MP3" requires shipping an encoder. LAME (via
 * `@breezystack/lamejs`, a maintained fork of the unmaintained `lamejs`) is
 * pure JavaScript, needs no WASM fetch, and therefore works offline on first
 * run — which matters when the device may never have had a good connection.
 *
 * NOTE ON LICENSING: lamejs is LGPL-3.0 while this repo is MIT. Bundling it
 * is the usual LGPL-in-a-JS-bundle grey area. **Settled 2026-08-23: keep
 * lamejs** — ADR 0003, docs/decisions/0003-mp3-encoder.md. What remains is the
 * notice and attribution work (#36), not a product call. Do not re-open it.
 *
 * NOTE ON THREADING: encoding a long chapter is CPU-bound and will jank the
 * UI if called on the main thread. `onProgress` exists so a caller can drive
 * a progress indicator, but the intended home for this function is a Web
 * Worker. See docs/decisions/0003-mp3-encoder.md.
 */

import { Mp3Encoder } from "@breezystack/lamejs";

import { CANONICAL_CHANNELS, CANONICAL_SAMPLE_RATE } from "./format";

/** MP3 encodes in granules of 1152 samples; feeding whole granules avoids padding. */
const SAMPLES_PER_FRAME = 1152;

/**
 * 64 kbps mono is transparent enough for speech and keeps an hour of audio
 * near 28 MB, which matters when the delivery mechanism may be a phone-to-
 * phone transfer rather than a network.
 */
const DEFAULT_BITRATE_KBPS = 64;

export interface EncodeMp3Options {
  readonly sampleRate?: number;
  readonly bitrateKbps?: number;
  /** Called with a value in [0, 1] as encoding proceeds. */
  readonly onProgress?: (fraction: number) => void;
}

export function encodeMp3(
  samples: Int16Array,
  options: EncodeMp3Options = {}
): Uint8Array<ArrayBuffer> {
  const sampleRate = options.sampleRate ?? CANONICAL_SAMPLE_RATE;
  const bitrateKbps = options.bitrateKbps ?? DEFAULT_BITRATE_KBPS;
  const encoder = new Mp3Encoder(CANONICAL_CHANNELS, sampleRate, bitrateKbps);

  const chunks: Uint8Array[] = [];
  let total = 0;

  const push = (buf: Uint8Array | Int8Array): void => {
    if (buf.length === 0) return;
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    // Copy: lamejs reuses its internal output buffer between calls, so
    // retaining a view would alias data that the next call overwrites.
    const copy = new Uint8Array(bytes);
    chunks.push(copy);
    total += copy.length;
  };

  for (let i = 0; i < samples.length; i += SAMPLES_PER_FRAME) {
    push(encoder.encodeBuffer(samples.subarray(i, i + SAMPLES_PER_FRAME)));
    options.onProgress?.(Math.min(1, (i + SAMPLES_PER_FRAME) / samples.length));
  }
  push(encoder.flush());
  options.onProgress?.(1);

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
