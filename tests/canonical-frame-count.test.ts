import { afterEach, describe, expect, it, vi } from "vitest";

import * as format from "@/lib/audio/format";

const rates = [
  8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000,
  192_000,
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("canonical frame count", () => {
  for (const rate of rates) {
    it.each([0, 1, rate - 1, rate, rate + 1, rate * 14_400])(
      `covers %i source frames at ${rate} Hz`,
      (length) => {
        const frames = format.canonicalFrameCount(length / rate, rate);
        expect(Number.isInteger(frames)).toBe(true);
        expect(frames).toBeGreaterThanOrEqual(1);
        // Integer duration comparison avoids reproducing floating-point rounding.
        const required = BigInt(length) * 44_100n;
        const supplied = BigInt(frames) * BigInt(rate);
        expect(supplied).toBeGreaterThanOrEqual(required);
        if (length > 0) {
          expect(BigInt(frames - 1) * BigInt(rate)).toBeLessThan(required);
        } else {
          expect(frames).toBe(1);
        }
      }
    );
  }

  it.each([
    { rate: 22_050, length: 13, frames: 27 },
    { rate: 44_100, length: 13, frames: 14 },
    { rate: 48_000, length: 3_040, frames: 2_794 },
    { rate: 96_000, length: 6_080, frames: 2_794 },
    { rate: 192_000, length: 12_160, frames: 2_794 },
  ])(
    "preserves the existing floating-point ceiling for $length / $rate",
    ({ rate, length, frames }) => {
      expect(format.canonicalFrameCount(length / rate, rate)).toBe(frames);
    }
  );
});

it("passes the helper's frame count to the offline renderer", async () => {
  vi.resetModules();
  const freshFormat = await import("@/lib/audio/format");
  const count = vi
    .spyOn(freshFormat, "canonicalFrameCount")
    .mockReturnValue(123);
  const decoded = {
    duration: 1 / 48_000,
    sampleRate: 48_000,
    numberOfChannels: 1,
  };
  const construct = vi.fn();
  vi.stubGlobal("window", {
    AudioContext: class {
      async decodeAudioData() {
        return decoded;
      }
    },
  });
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      destination = {};
      constructor(channels: number, frames: number, rate: number) {
        construct(channels, frames, rate);
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
      }
      async startRendering() {
        return { getChannelData: () => new Float32Array([0.5]) };
      }
    }
  );
  const { decodeToCanonical } = await import("@/hooks/audio-io");
  const result = await decodeToCanonical(new Blob([new Uint8Array([1])]));
  expect(count).toHaveBeenCalledExactlyOnceWith(
    decoded.duration,
    decoded.sampleRate
  );
  expect(construct).toHaveBeenCalledExactlyOnceWith(1, 123, 44_100);
  expect([...result]).toEqual([16_384]);
});
