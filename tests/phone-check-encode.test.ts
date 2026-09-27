import { describe, expect, it } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { runEncodeProbe } from "@/lib/phone-check/encode-probe";
import { ENCODE_PROBE_SECONDS, speechLikePcm } from "@/lib/phone-check/speech";

import { testCodec } from "./support";

/**
 * #1009 — the encode probe's fixture and its timing.
 *
 * The browser half (`runWorkerEncodeProbe`, through `withEncoder` and the
 * worker) is not exercised here: Node has no worker for it. What is pinned is
 * that the fixture is five minutes of non-silent, non-constant PCM, and that
 * the probe reports the codec's real output and a wall time read from the
 * clock around the encode.
 */

describe("speechLikePcm", () => {
  it("is five minutes at the canonical rate by default", () => {
    expect(ENCODE_PROBE_SECONDS).toBe(300);
    // One second is enough to check the rate; the length is length arithmetic.
    expect(speechLikePcm(1)).toHaveLength(CANONICAL_SAMPLE_RATE);
  });

  it("is neither silence nor a constant, and has pauses", () => {
    const pcm = speechLikePcm(4);
    let peak = 0;
    let zeros = 0;
    const distinct = new Set<number>();
    for (const s of pcm) {
      peak = Math.max(peak, Math.abs(s));
      if (s === 0) zeros += 1;
      if (distinct.size < 1000) distinct.add(s);
    }
    expect(peak).toBeGreaterThan(5000);
    expect(distinct.size).toBeGreaterThanOrEqual(1000);
    // The 0.4 s pause at 3.1–3.5 s is silence; most of the rest is not.
    expect(zeros).toBeGreaterThan(0.35 * CANONICAL_SAMPLE_RATE);
    expect(zeros).toBeLessThan(0.5 * pcm.length);
  });

  it("is deterministic, so two phones encode the same samples", () => {
    expect(speechLikePcm(0.5)).toEqual(speechLikePcm(0.5));
  });
});

describe("runEncodeProbe", () => {
  it("encodes through the codec it is given and times only the encode", async () => {
    const codec = testCodec();
    const samples = speechLikePcm(2);
    const ticks = [1000, 1250];
    const result = await runEncodeProbe(
      codec,
      samples,
      CANONICAL_SAMPLE_RATE,
      () => {
        const t = ticks.shift();
        if (t === undefined) throw new Error("clock read more than twice");
        return t;
      }
    );
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);
    expect(codec.encodeMp3).toHaveBeenCalledWith(samples);
    expect(result.audioSeconds).toBe(2);
    expect(result.wallMs).toBe(250);
    const mp3 = await codec.encodeMp3.mock.results[0]?.value;
    expect(result.mp3Bytes).toBe((mp3 as Uint8Array).byteLength);
    expect(result.mp3Bytes).toBeGreaterThan(0);
  });

  it("reads the audio length before the encode, which detaches the buffer in the worker path", async () => {
    const samples = speechLikePcm(1);
    const result = await runEncodeProbe(
      {
        encodeMp3: async (s) => {
          // What `postMessage(request, [request.buffer])` does to the caller's array.
          structuredClone(s.buffer, { transfer: [s.buffer] });
          return new Uint8Array(10);
        },
      },
      samples,
      CANONICAL_SAMPLE_RATE,
      () => 0
    );
    expect(samples.length).toBe(0);
    expect(result.audioSeconds).toBe(1);
  });
});
