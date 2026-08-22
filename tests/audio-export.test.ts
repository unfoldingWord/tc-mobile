import { describe, expect, it } from "vitest";

import { concat, silence } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { encodeWav } from "@/lib/audio/wav";

/** A 440 Hz tone — real signal, so the encoder has something to compress. */
const tone = (seconds: number): Int16Array => {
  const n = Math.round(CANONICAL_SAMPLE_RATE * seconds);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / CANONICAL_SAMPLE_RATE) * 20000
    );
  }
  return out;
};

describe("encodeWav", () => {
  it("writes a valid RIFF/WAVE header", () => {
    const samples = tone(0.1);
    const wav = encodeWav(samples, CANONICAL_SAMPLE_RATE);
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...wav.subarray(o, o + n));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(ascii(36, 4)).toBe("data");
    expect(wav.length).toBe(44 + samples.length * 2);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(CANONICAL_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });
});

describe("encodeMp3", () => {
  it("produces a stream that starts with an MPEG frame sync or ID3 tag", () => {
    const mp3 = encodeMp3(tone(0.5));
    expect(mp3.length).toBeGreaterThan(0);

    const isId3 = mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33;
    const isFrameSync = mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0;
    expect(isId3 || isFrameSync).toBe(true);
  });

  it("lands near the requested bitrate", () => {
    const seconds = 2;
    const mp3 = encodeMp3(tone(seconds), { bitrateKbps: 64 });
    const expectedBytes = (64_000 / 8) * seconds;
    // Generous bounds: LAME adds headers and the tail frame is padded.
    expect(mp3.length).toBeGreaterThan(expectedBytes * 0.5);
    expect(mp3.length).toBeLessThan(expectedBytes * 1.5);
  });

  it("reports progress ending at 1", () => {
    const seen: number[] = [];
    encodeMp3(tone(0.2), { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
  });

  it("encodes a concatenated multi-section export", () => {
    // This is the actual export path: sections joined with a gap between them.
    const gap = silence(CANONICAL_SAMPLE_RATE * 0.25);
    const joined = concat([tone(0.3), gap, tone(0.3), gap, tone(0.3)]);
    const mp3 = encodeMp3(joined);
    expect(mp3.length).toBeGreaterThan(0);
  });

  it("does not alias lamejs's internal output buffer across chunks", () => {
    // Regression guard: lamejs reuses its output buffer between calls, so a
    // retained view would show later data. Encoding twice must be stable.
    const samples = tone(0.5);
    const a = encodeMp3(samples);
    const b = encodeMp3(samples);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
