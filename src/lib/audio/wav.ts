/**
 * Minimal RIFF/WAVE writer for mono 16-bit PCM.
 *
 * Not the primary export format — the spec asks for MP3 — but useful as a
 * lossless escape hatch when debugging the audio core, and cheap enough
 * (44 bytes of header) to be worth having.
 */

const HEADER_BYTES = 44;

export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // chunk size excludes "RIFF" + size
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    view.setInt16(HEADER_BYTES + i * 2, samples[i]!, true);
  }

  return new Uint8Array(buffer);
}
