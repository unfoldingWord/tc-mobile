import { describe, expect, it } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import {
  MP3_DECODER_DELAY,
  MP3_ENCODER_DELAY,
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
  fitMp3Decode,
  mp3GranuleCount,
} from "@/lib/audio/mp3-align";
import { noTrimDecode, ramp } from "./support";

/**
 * Recovering the recording from an MP3 decode (PR #136 round 2, Frank P1).
 *
 * There is no MP3 decoder in Node, so the decoder is MODELLED: `noTrimDecode`
 * builds what a decoder that returns every granule hands back — 1105 samples
 * of priming, the recording, granule padding — with the granule count taken
 * from the real encode of the same audio. The model's two facts (head offset
 * 1105, length = granules × 1152) were measured in Chromium with impulses at
 * known positions for five input lengths; the PR body quotes the numbers.
 *
 * Every fixture is a RAMP, never a constant: a fit that trimmed the wrong end
 * of a constant buffer would pass. That is exactly how round 1's fit passed.
 */

describe("mp3GranuleCount", () => {
  it.each([
    [100, 2],
    [1151, 2],
    [1152, 2],
    [1153, 3],
    [2000, 3],
    [44_100, 40],
    [87_317, 77],
    [132_300, 116],
  ])("counts the frames lamejs emits for %i samples (%i)", (n, frames) => {
    // The expected counts were read off the encoder's output by walking its
    // headers in a separate probe, and match Chromium's decode lengths ÷ 1152
    // (88,704 for 87,317; 133,632 for 132,300; 3,456 for 1,153 and 2,000).
    expect(mp3GranuleCount(encodeMp3(ramp(n)))).toBe(frames);
  });

  it("is not a formula of the input length", () => {
    // 1152 and 1153 input samples differ by one and by a whole granule. Any
    // fit that derived the emitted length arithmetically would be off here.
    expect(mp3GranuleCount(encodeMp3(ramp(1152)))).toBe(2);
    expect(mp3GranuleCount(encodeMp3(ramp(1153)))).toBe(3);
  });

  it("stops at the first byte that is not an MPEG-1 Layer III header", () => {
    const mp3 = encodeMp3(ramp(5000));
    const frames = mp3GranuleCount(mp3);
    const broken = new Uint8Array(mp3);
    // Corrupt the second frame's sync word: the count stops after the first.
    const secondFrame = Math.floor((144 * 64_000) / 44_100);
    broken[secondFrame] = 0x00;
    expect(mp3GranuleCount(broken)).toBe(1);
    expect(frames).toBeGreaterThan(1);
    expect(mp3GranuleCount(new Uint8Array(0))).toBe(0);
    expect(mp3GranuleCount(new Uint8Array([1, 2, 3, 4, 5]))).toBe(0);
  });
});

describe("fitMp3Decode", () => {
  const N = 4000;
  const pcm = ramp(N);
  const mp3 = encodeMp3(pcm);
  const emitted = mp3GranuleCount(mp3) * MP3_GRANULE;

  it("recovers the recording from a decoder that trims nothing", () => {
    // The Chromium case: [1105 priming][recording][tail padding].
    const decoded = noTrimDecode(pcm, mp3);
    expect(decoded.length).toBe(emitted);
    const fitted = fitMp3Decode(decoded, mp3, N);
    expect(fitted.length).toBe(N);
    expect(Array.from(fitted)).toEqual(Array.from(pcm));
  });

  it("recovers the recording from a decoder that trimmed only its own delay", () => {
    // [576 priming][recording][tail]: 529 fewer samples than the full decode.
    const decoded = new Int16Array(emitted - MP3_DECODER_DELAY);
    decoded.set(pcm, MP3_ENCODER_DELAY);
    const fitted = fitMp3Decode(decoded, mp3, N);
    expect(Array.from(fitted)).toEqual(Array.from(pcm));
  });

  it("returns a sample-exact decode unchanged", () => {
    // A tag-honouring decoder given a tagged stream: nothing to skip or trim.
    const fitted = fitMp3Decode(new Int16Array(pcm), mp3, N);
    expect(Array.from(fitted)).toEqual(Array.from(pcm));
  });

  it("never drops recorded audio from the FRONT — round 2's defect", () => {
    // The round-1 fit kept [0, N) of the full decode: silence, then the
    // recording minus its last 1105 samples. The first recorded sample must be
    // the first fitted sample, and the last recorded sample the last.
    const fitted = fitMp3Decode(noTrimDecode(pcm, mp3), mp3, N);
    expect(fitted[0]).toBe(pcm[0]);
    expect(fitted[N - 1]).toBe(pcm[N - 1]);
    expect(fitted[N - 1]).not.toBe(0);
  });

  it("pads a decode that came back short, at the tail", () => {
    const decoded = pcm.subarray(0, N - 300);
    const fitted = fitMp3Decode(decoded, mp3, N);
    expect(fitted.length).toBe(N);
    expect(Array.from(fitted.subarray(0, N - 300))).toEqual(
      Array.from(decoded)
    );
    expect(Array.from(fitted.subarray(N - 300))).toEqual(
      new Array<number>(300).fill(0)
    );
  });

  it("bounds an unrecognised overshoot by the tail padding and the priming", () => {
    // A decoder that trimmed some other amount: the excess it left is split
    // as MPEG lays it out — whatever is not tail padding is head — and the
    // head skip is never more than the priming. Here it trimmed 100 samples
    // of priming and nothing else, so the recording starts at 1005.
    const decoded = new Int16Array(emitted - 100);
    decoded.set(pcm, MP3_TOTAL_DELAY - 100);
    const fitted = fitMp3Decode(decoded, mp3, N);
    expect(Array.from(fitted)).toEqual(Array.from(pcm));
  });

  it("survives a decode shorter than the priming", () => {
    const fitted = fitMp3Decode(new Int16Array(10), mp3, N);
    expect(fitted.length).toBe(N);
  });

  it("exposes the delays MPEG-1 Layer III fixes", () => {
    expect(MP3_GRANULE).toBe(1152);
    expect(MP3_ENCODER_DELAY).toBe(576);
    expect(MP3_DECODER_DELAY).toBe(529);
    expect(MP3_TOTAL_DELAY).toBe(1105);
  });
});
