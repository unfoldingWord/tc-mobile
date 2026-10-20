/**
 * WAV header writer for a mono 16-bit PCM clip (#1477).
 *
 * A segment still being worked on is held as Int16 PCM. The project export
 * writes it as a standard WAV: this header, then the clip's Int16 bytes as they
 * are, with no copy and no re-encode. Only the header is built here; the caller
 * owns the sample bytes.
 *
 * Little-endian assumption: an `Int16Array` stores samples in platform byte
 * order, and WAV samples are little-endian, so writing the clip's bytes
 * unchanged is correct only on a little-endian platform. Every target here is
 * little-endian, but that is an assumption, so `wavHeader` checks it at runtime
 * (once) and throws rather than emit byte-swapped audio.
 *
 * Out of scope: stereo, other bit depths, reading WAV.
 */

export const WAV_HEADER_BYTES = 44;

const BYTES_PER_SAMPLE = 2;
const UINT32_MAX = 0xffff_ffff;

/**
 * The most frames one WAV can hold: header plus data stays within 4 GiB - 44
 * bytes of data, so the RIFF size field (36 + data bytes) and the data size
 * field both fit in an unsigned 32 bits.
 */
export const MAX_WAV_FRAMES = Math.floor(
  (2 ** 32 - WAV_HEADER_BYTES) / BYTES_PER_SAMPLE
);

let littleEndianChecked = false;

function assertLittleEndianOnce(): void {
  if (littleEndianChecked) return;
  const probe = new Uint8Array(new Int16Array([1]).buffer);
  if (probe[0] !== 1) {
    throw new Error(
      "WAV export needs a little-endian platform: Int16Array bytes would be byte-swapped"
    );
  }
  littleEndianChecked = true;
}

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++)
    view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * The 44-byte RIFF/WAVE header for `frameCount` mono 16-bit PCM frames at
 * `sampleRate`. Throws on a frame count that is not a positive integer, one
 * above `MAX_WAV_FRAMES`, or a sample rate that is not a positive integer whose
 * byte rate fits 32 bits.
 */
export function wavHeader(
  frameCount: number,
  sampleRate: number
): Uint8Array<ArrayBuffer> {
  assertLittleEndianOnce();
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError(
      `WAV needs a positive whole number of frames, got ${frameCount}`
    );
  }
  if (frameCount > MAX_WAV_FRAMES) {
    throw new RangeError(
      `WAV clip of ${frameCount} frames is larger than 4 GiB and cannot be written`
    );
  }
  const byteRate = sampleRate * BYTES_PER_SAMPLE;
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    byteRate > UINT32_MAX
  ) {
    throw new RangeError(`WAV sample rate is not usable: ${sampleRate}`);
  }
  const dataBytes = frameCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true); // blockAlign = channels x bytes
  view.setUint16(34, 16, true);
  ascii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}
