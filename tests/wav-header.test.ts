import { describe, expect, it } from "vitest";

import { MAX_WAV_FRAMES, WAV_HEADER_BYTES, wavHeader } from "@/lib/audio/wav";

/** The bytes a 3-frame, 44 100 Hz mono 16-bit header must be, written by hand. */
const HAND_FIXTURE_3_FRAMES_44100 = [
  0x52,
  0x49,
  0x46,
  0x46, // "RIFF"
  0x2a,
  0x00,
  0x00,
  0x00, // RIFF size = 36 + 6 = 42
  0x57,
  0x41,
  0x56,
  0x45, // "WAVE"
  0x66,
  0x6d,
  0x74,
  0x20, // "fmt "
  0x10,
  0x00,
  0x00,
  0x00, // fmt chunk size 16
  0x01,
  0x00, // PCM
  0x01,
  0x00, // 1 channel
  0x44,
  0xac,
  0x00,
  0x00, // 44100
  0x88,
  0x58,
  0x01,
  0x00, // byteRate 88200
  0x02,
  0x00, // blockAlign 2
  0x10,
  0x00, // 16 bits
  0x64,
  0x61,
  0x74,
  0x61, // "data"
  0x06,
  0x00,
  0x00,
  0x00, // data size 6 bytes
];

interface ParsedWav {
  format: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  samples: Int16Array;
}

/** A tiny strict RIFF reader: only what the writer is meant to produce. */
function parseWav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  expect(tag(0)).toBe("RIFF");
  expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
  expect(tag(8)).toBe("WAVE");
  expect(tag(12)).toBe("fmt ");
  expect(view.getUint32(16, true)).toBe(16);
  expect(tag(36)).toBe("data");
  const dataBytes = view.getUint32(40, true);
  expect(bytes.byteLength).toBe(44 + dataBytes);
  const samples = new Int16Array(dataBytes / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = view.getInt16(44 + i * 2, true);
  return {
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    samples,
  };
}

function wavFile(samples: Int16Array, rate: number): Uint8Array {
  const header = wavHeader(samples.length, rate);
  const out = new Uint8Array(header.length + samples.byteLength);
  out.set(header, 0);
  out.set(
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    header.length
  );
  return out;
}

describe("wavHeader", () => {
  it("is 44 bytes", () => {
    expect(WAV_HEADER_BYTES).toBe(44);
    expect(wavHeader(1, 44_100)).toHaveLength(44);
  });

  it("matches the hand-computed bytes for 3 frames at 44 100 Hz", () => {
    expect(Array.from(wavHeader(3, 44_100))).toEqual(
      HAND_FIXTURE_3_FRAMES_44100
    );
  });

  it("writes byteRate as sampleRate x 2 and blockAlign 2 at another rate", () => {
    const parsed = parseWav(wavFile(new Int16Array([1, 2]), 16_000));
    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.byteRate).toBe(32_000);
    expect(parsed.blockAlign).toBe(2);
  });

  it("writes the data size in bytes, not frames", () => {
    const view = new DataView(wavHeader(1000, 44_100).buffer);
    expect(view.getUint32(40, true)).toBe(2000);
    expect(view.getUint32(4, true)).toBe(2036);
  });

  it("round-trips frames and rate, including extreme sample values", () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345]);
    const parsed = parseWav(wavFile(samples, 44_100));
    expect(parsed.format).toBe(1);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.sampleRate).toBe(44_100);
    expect(Array.from(parsed.samples)).toEqual(Array.from(samples));
  });

  it("accepts the largest legal clip and writes sizes that fit 32 bits", () => {
    const view = new DataView(wavHeader(MAX_WAV_FRAMES, 44_100).buffer);
    expect(view.getUint32(40, true)).toBe(MAX_WAV_FRAMES * 2);
    expect(view.getUint32(4, true)).toBe(MAX_WAV_FRAMES * 2 + 36);
    expect(MAX_WAV_FRAMES * 2 + 44).toBeLessThanOrEqual(2 ** 32);
  });

  it("rejects a 0-frame clip", () => {
    expect(() => wavHeader(0, 44_100)).toThrow(/frame/i);
  });

  it("rejects a clip that would overflow the 32-bit RIFF fields", () => {
    expect(() => wavHeader(MAX_WAV_FRAMES + 1, 44_100)).toThrow(/4 GiB/);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a bad frame count %s",
    (frames) => {
      expect(() => wavHeader(frames, 44_100)).toThrow(/frame/i);
    }
  );

  it.each([0, -44_100, 22_050.5, Number.NaN, 2 ** 31])(
    "rejects a bad sample rate %s",
    (rate) => {
      expect(() => wavHeader(10, rate)).toThrow(/sample rate/i);
    }
  );

  it("returns a fresh buffer each call", () => {
    const a = wavHeader(2, 44_100);
    a[0] = 0;
    expect(wavHeader(2, 44_100)[0]).toBe(0x52);
  });
});
