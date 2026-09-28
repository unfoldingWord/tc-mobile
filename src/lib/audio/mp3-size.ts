/**
 * MP3 size arithmetic that does not need the encoder.
 *
 * Split out of `mp3.ts` (#1167 review, Frank P2): `mp3.ts` statically imports
 * `Mp3Encoder` from `@breezystack/lamejs` — the LGPL-3.0 encoder ADR 0003
 * settled on keeping, on the understanding in ADR 0009 §1 that only the Web
 * Worker (`hooks/mp3.worker.ts`) pulls it in, never the main thread. The
 * transcode sweep's retry margin (#1015) only needs to REASON about a clip's
 * expected MP3 size before it is encoded — arithmetic, not encoding — but it
 * runs on the main thread (`hooks/finish-transcode.ts`, imported from
 * `App.tsx`). Importing that arithmetic from `mp3.ts` would make the main
 * bundle's tree-shaking of `Mp3Encoder` a property of how Rollup happens to
 * analyse an unrelated function in the same file, rather than a property of
 * what the main thread imports. This module holds nothing lamejs, so a
 * main-thread caller reaching it can never reach the encoder through it,
 * regardless of what the bundler does with any other export of `mp3.ts`.
 *
 * `mp3.ts` imports `DEFAULT_BITRATE_KBPS` from here too, so ADR 0009's 64 kbps
 * stays the one number it always was — not a second copy, just a different
 * file owning it.
 */

/**
 * 64 kbps mono is transparent enough for speech and keeps an hour of audio
 * near 28 MB, which matters when the delivery mechanism may be a phone-to-
 * phone transfer rather than a network.
 */
export const DEFAULT_BITRATE_KBPS = 64;

/**
 * The MP3 byte size a clip of `durationMs` is expected to land at, at
 * `bitrateKbps` (ADR 0009's `DEFAULT_BITRATE_KBPS` unless a caller has a
 * reason to differ). A CBR estimate, not a promise: lamejs pads to whole
 * 1152-sample frames and the real output can differ by a few bytes, which is
 * why a caller comparing against this treats it as an estimate rather than an
 * exact bound.
 */
export function expectedMp3ByteLength(
  durationMs: number,
  bitrateKbps: number = DEFAULT_BITRATE_KBPS
): number {
  return Math.ceil((durationMs * bitrateKbps) / 8);
}
