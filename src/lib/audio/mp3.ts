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
 *
 * NOTE ON THE MAIN BUNDLE: this module — and so `Mp3Encoder` — must stay
 * reachable only from the worker (`hooks/mp3.worker.ts`), never from
 * main-thread code (ADR 0009 §1). A caller that only needs to REASON about a
 * clip's expected size, never to encode it, imports `./mp3-size` instead —
 * that module holds no lamejs import at all, so it cannot reintroduce this by
 * accident. `DEFAULT_BITRATE_KBPS` lives there; this module imports it rather
 * than keeping a second copy.
 */

import { Mp3Encoder } from "@breezystack/lamejs";

import { CANONICAL_CHANNELS, CANONICAL_SAMPLE_RATE } from "./format";
import { DEFAULT_BITRATE_KBPS } from "./mp3-size";

/** MP3 encodes in granules of 1152 samples; feeding whole granules avoids padding. */
const SAMPLES_PER_FRAME = 1152;

export interface EncodeMp3Options {
  readonly sampleRate?: number;
  readonly bitrateKbps?: number;
  /** Called with a value in [0, 1] as encoding proceeds. */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * One continuing MP3 encode, fed PCM in pieces (#1003 part b).
 *
 * lamejs keeps its state across `encodeBuffer` calls and buffers a partial
 * frame internally until the next call completes it, so how the PCM is cut
 * into writes does not show in the output: the MP3 is byte-identical to one
 * `encodeMp3(whole)` (`tests/mp3-stream.test.ts`, cuts on and off frame
 * boundaries, empty and one-sample writes among them). Each write is still
 * fed in 1152-sample slices, as `encodeMp3` always was, only so `onProgress`
 * hears it as it goes — which is what keeps the worker's heartbeat alive
 * through a long segment. What it holds between writes is lamejs's own
 * state and the MP3 bytes produced so far.
 */
export interface Mp3StreamEncoder {
  /**
   * Encode `samples` after everything written before. `onProgress` hears how
   * far through THIS write the encode has got, in (0, 1]. The samples are
   * read during the call and not kept.
   */
  write(samples: Int16Array, onProgress?: (fraction: number) => void): void;
  /** Flush and return the whole MP3. Once; nothing may be written after. */
  finish(): Uint8Array<ArrayBuffer>;
}

export function createMp3StreamEncoder(
  options: Omit<EncodeMp3Options, "onProgress"> = {}
): Mp3StreamEncoder {
  const sampleRate = options.sampleRate ?? CANONICAL_SAMPLE_RATE;
  const bitrateKbps = options.bitrateKbps ?? DEFAULT_BITRATE_KBPS;
  const encoder = new Mp3Encoder(CANONICAL_CHANNELS, sampleRate, bitrateKbps);

  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;

  const push = (buf: Uint8Array | Int8Array): void => {
    if (buf.length === 0) return;
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    // Copy: lamejs reuses its internal output buffer between calls, so
    // retaining a view would alias data that the next call overwrites.
    const copy = new Uint8Array(bytes);
    chunks.push(copy);
    total += copy.length;
  };
  const refuseFinished = (): void => {
    if (finished) throw new Error("This MP3 stream has already finished");
  };

  return {
    write(samples, onProgress) {
      refuseFinished();
      for (let i = 0; i < samples.length; i += SAMPLES_PER_FRAME) {
        push(encoder.encodeBuffer(samples.subarray(i, i + SAMPLES_PER_FRAME)));
        onProgress?.(Math.min(1, (i + SAMPLES_PER_FRAME) / samples.length));
      }
    },
    finish() {
      refuseFinished();
      finished = true;
      push(encoder.flush());
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      chunks.length = 0;
      return out;
    },
  };
}

/**
 * Encode a whole buffer: one write and a finish on a fresh stream — the same
 * lamejs calls this function has always made, so a whole encode's bytes are
 * what they were before streaming existed.
 */
export function encodeMp3(
  samples: Int16Array,
  options: EncodeMp3Options = {}
): Uint8Array<ArrayBuffer> {
  const stream = createMp3StreamEncoder(options);
  stream.write(samples, options.onProgress);
  const out = stream.finish();
  options.onProgress?.(1);
  return out;
}
