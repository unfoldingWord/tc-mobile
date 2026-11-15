import { describe, expect, it } from "vitest";

import { INT16_MAX } from "@/lib/audio/format";
import {
  LOUDNESS_TARGET,
  LoudnessMeter,
  NORMALIZE_STAGES,
  normalizePcm,
} from "@/lib/audio/loudness";
import { speechLikePcm } from "@/lib/phone-check/speech";

/**
 * #1873: the speech compressor in the Finished chain, behind its switch.
 *
 * Order: high-pass, compressor, loudness, limiter. The compressor comes after
 * the high-pass so rumble does not drive its gain reduction, and before the
 * loudness measurement because it has no makeup gain: the static gain must be
 * measured on the compressed take, or the take would land under the target.
 * The limiter stays last, as the ceiling's guarantee.
 *
 * One compressor per take AND per pass: it has no reset, and pass 2 must start
 * from rest exactly as pass 1 did, or the take's start is turned down by the
 * previous pass's (or the previous take's) release tail.
 */

const RATE = 44_100;

function measure(samples: Int16Array) {
  const meter = new LoudnessMeter(RATE, samples.length);
  const x = Float32Array.from(samples, (v) => Math.max(-1, v / INT16_MAX));
  meter.push(x, x.length);
  return meter.finish();
}

/** Synthetic speech raised by `db` (loud enough to be compressed). */
function speech(seconds: number, db: number): Int16Array {
  const g = 10 ** (db / 20);
  return Int16Array.from(speechLikePcm(seconds, RATE), (v) =>
    Math.max(-INT16_MAX, Math.min(INT16_MAX, Math.round(v * g)))
  );
}

/** A 1 kHz tone at `db` dBFS peak. */
function tone(seconds: number, db: number): Int16Array {
  const a = 10 ** (db / 20) * INT16_MAX;
  const n = Math.round(seconds * RATE);
  return Int16Array.from({ length: n }, (_, i) =>
    Math.round(a * Math.sin((2 * Math.PI * 1000 * i) / RATE))
  );
}

const ids = (stages: readonly { id: string }[]) => stages.map((s) => s.id);

describe("normalizePcm with the compressor (#1873)", () => {
  it("records the compressor between the high-pass and the loudness stage", () => {
    const record = normalizePcm(speech(4, 0), RATE, undefined, {
      compress: true,
    });
    expect(ids(record.stages)).toEqual([
      "hpf",
      "compressor",
      "loudness",
      "limiter",
    ]);
    expect(record.stages.find((s) => s.id === "compressor")?.version).toBe(1);
  });

  it("still lands on the target, under the ceiling, measured after compression", () => {
    const plain = speech(6, 0);
    const squeezed = Int16Array.from(plain);
    const off = normalizePcm(plain, RATE);
    const on = normalizePcm(squeezed, RATE, undefined, { compress: true });
    const after = measure(squeezed);
    expect(after.integratedLufs!).toBeCloseTo(LOUDNESS_TARGET.lufs, 0);
    expect(after.truePeakDbtp!).toBeLessThanOrEqual(
      LOUDNESS_TARGET.ceilingDbtp + 0.1
    );
    // Measured on the compressed take: it only turns down, so it reads
    // quieter, and the static gain makes up the difference.
    expect(on.measuredLufs!).toBeLessThan(off.measuredLufs! - 0.5);
    expect(on.appliedGainDb).toBeGreaterThan(off.appliedGainDb + 0.5);
  });

  it("off (or not asked) runs exactly the chain it ran before", () => {
    const a = speech(3, 0);
    const b = Int16Array.from(a);
    const plain = normalizePcm(a, RATE);
    const off = normalizePcm(b, RATE, undefined, { compress: false });
    expect(plain.stages).toEqual(NORMALIZE_STAGES);
    expect(off).toEqual(plain);
    expect(b.findIndex((v, i) => v !== a[i])).toBe(-1);
  });

  it("builds a fresh compressor for each pass and each take", () => {
    // A steady -10 dBFS tone settles 10 dB down. A compressor at rest lets
    // the first crest through nearly whole (a quarter period against the
    // 10 ms attack: about 0.25 dB), so the output's first crest stands about
    // 9.75 dB over the settled crests. A pass-2 compressor that kept pass 1's
    // state (or a previous take's) would start already 10 dB down.
    const firstOverSettled = (samples: Int16Array) => {
      let first = 0;
      for (let i = 0; i < 44; i++)
        first = Math.max(first, Math.abs(samples[i]!));
      let settled = 0;
      for (let i = samples.length - 441; i < samples.length; i++)
        settled = Math.max(settled, Math.abs(samples[i]!));
      return 20 * Math.log10(first / settled);
    };
    // Another take through the chain first, so state kept across calls shows.
    normalizePcm(tone(2, -6), RATE, undefined, { compress: true });
    const take = tone(2, -10);
    normalizePcm(take, RATE, undefined, { compress: true });
    expect(firstOverSettled(take)).toBeGreaterThan(8);
  });
});
