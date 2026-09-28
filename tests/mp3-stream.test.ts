import { Mp3Encoder } from "@breezystack/lamejs";
import { describe, expect, it } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { createMp3StreamEncoder, encodeMp3 } from "@/lib/audio/mp3";

/**
 * #1003(b): a long chapter is encoded as a STREAM — PCM handed to one
 * continuing lamejs session in pieces — so the page never holds the whole
 * chapter's PCM. The claim this file pins is that the pieces do not show:
 * however the PCM is cut, the MP3 is byte-for-byte the one a single
 * `encodeMp3(whole)` call produces.
 *
 * Why that can hold at all: lamejs keeps its state across `encodeBuffer`
 * calls and buffers a partial frame until the next call completes it. The
 * cuts below are chosen to land on and off frame boundaries so that claim is
 * tested rather than assumed.
 */

/** Not constant and not periodic on a frame boundary, so a slip shows. */
function speechLike(n: number): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(
      7000 * Math.sin(i / 17) + 2500 * Math.sin(i / 3.1) + ((i * 7919) % 401)
    );
  return out;
}

/**
 * An independent reference: the lamejs call sequence `encodeMp3` has always
 * made, written out here rather than imported, so a change to `encodeMp3`
 * itself cannot move both sides of the comparison at once.
 */
function referenceEncode(samples: Int16Array): Uint8Array {
  const encoder = new Mp3Encoder(1, CANONICAL_SAMPLE_RATE, 64);
  const parts: number[] = [];
  const take = (b: Uint8Array | Int8Array) =>
    parts.push(...new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  for (let i = 0; i < samples.length; i += 1152)
    take(encoder.encodeBuffer(samples.subarray(i, i + 1152)));
  take(encoder.flush());
  return Uint8Array.from(parts);
}

function streamed(samples: Int16Array, cuts: readonly number[]): Uint8Array {
  const stream = createMp3StreamEncoder();
  let at = 0;
  for (const cut of [...cuts, samples.length]) {
    stream.write(samples.slice(at, cut));
    at = cut;
  }
  return stream.finish();
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe("createMp3StreamEncoder (#1003 part b)", () => {
  const whole = speechLike(CANONICAL_SAMPLE_RATE * 3 + 777);

  it("the reference and encodeMp3 agree, so the comparison below has a fixed point", () => {
    expect(same(encodeMp3(whole.slice()), referenceEncode(whole))).toBe(true);
  });

  it.each([
    ["one piece", []],
    ["cuts on frame boundaries", [1152, 1152 * 40, 1152 * 41]],
    [
      "cuts off every boundary, empty and one-sample pieces among them",
      [0, 0, 1, 1151, 1153, 1153, 5000, 23_457, 100_001],
    ],
    ["a cut one short of the end", [whole.length - 1]],
  ])("is byte-identical to encodeMp3(whole): %s", (_, cuts) => {
    const out = streamed(whole, cuts);
    expect(out.length).toBeGreaterThan(0);
    expect(same(out, referenceEncode(whole))).toBe(true);
    expect(same(out, encodeMp3(whole.slice()))).toBe(true);
  });

  it("a stream with nothing written finishes as encodeMp3 of nothing does", () => {
    const stream = createMp3StreamEncoder();
    expect(same(stream.finish(), encodeMp3(new Int16Array(0)))).toBe(true);
  });

  it("reports each write's own progress, ending at 1", () => {
    const stream = createMp3StreamEncoder();
    const seen: number[] = [];
    stream.write(whole.subarray(0, 1152 * 4), (f) => seen.push(f));
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("refuses a write or a second finish after it has finished", () => {
    const stream = createMp3StreamEncoder();
    stream.finish();
    expect(() => stream.write(Int16Array.of(1))).toThrow(/finished/);
    expect(() => stream.finish()).toThrow(/finished/);
  });
});
