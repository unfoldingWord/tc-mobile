/**
 * The phone check's encode probe (#1009): time one encode of synthetic speech
 * through whatever `AudioCodec` it is handed.
 *
 * In the app that codec is the REAL worker codec — `hooks/phone-check-probes.ts`
 * reaches it through `withEncoder`, the same lane Finished transcodes and Share
 * use (ADR 0009). Here it is injected, so the timing and the arithmetic are
 * testable in Node against the real synchronous encoder.
 */
import type { AudioCodec } from "@/types/audio";

import type { EncodeResult } from "./report";

export async function runEncodeProbe(
  codec: Pick<AudioCodec, "encodeMp3">,
  samples: Int16Array,
  sampleRate: number,
  now: () => number
): Promise<EncodeResult> {
  // Read before the encode: the worker path TRANSFERS the buffer, so the
  // array is detached (length 0) once `encodeMp3` has it.
  const audioSeconds = samples.length / sampleRate;
  const started = now();
  const mp3 = await codec.encodeMp3(samples);
  const wallMs = now() - started;
  return { audioSeconds, wallMs, mp3Bytes: mp3.byteLength };
}
