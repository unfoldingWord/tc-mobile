import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  ENCODE_STEPS,
  SEGMENT_GAP_SECONDS,
  STREAMING_PCM_THRESHOLD_BYTES,
  exportChapterMp3,
  gatherChapterPcm,
  withEncodeSteps,
} from "@/lib/export/chapter";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import { saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { AudioCodec, Mp3Stream } from "@/types/audio";
import type { ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores, noTrimDecode, testCodec } from "./support";

/**
 * #1003 part (b): Share Chapter of a LONG chapter streams its PCM through one
 * continuing encoder session instead of building one chapter-sized buffer.
 *
 * DRI decision on the park (verbatim): "B: stream only long chapters
 * (Recommended)". So there are two paths, split by the chapter's PCM size
 * against `STREAMING_PCM_THRESHOLD_BYTES`: at or under it, today's path and
 * today's steps, unchanged; over it, the stream, with a coarser meter (each
 * segment's step includes its encode, and the encode stretch has no fraction
 * of its own — it goes from the last segment straight to total when the MP3
 * exists).
 *
 * Tests pass a small threshold through `exportChapterMp3`'s last parameter so
 * a "long" chapter is a few seconds of audio; the boundary case at the end
 * uses the real constant.
 */

const GAP = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);
/** Anything this small streams: every chapter below is longer. */
const TINY = 1;
/** Nothing streams: today's path. */
const NEVER = Number.POSITIVE_INFINITY;

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

function speechLike(n: number, seed: number): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(
      6000 * Math.sin((i + seed) / (13 + seed)) + ((i * 7919 + seed) % 501)
    );
  return out;
}

async function chapterOf(
  buffers: Int16Array[]
): Promise<{ chapterId: ChapterId; segmentIds: SegmentId[] }> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segmentIds: SegmentId[] = [];
  for (const buffer of buffers) {
    const seg = await addSegment(chapter.id);
    segmentIds.push(seg.id);
    await saveTake(seg.id, newClipId(), buffer, CANONICAL_SAMPLE_RATE);
  }
  return { chapterId: chapter.id, segmentIds };
}

/** Segment lengths that fall on no frame boundary, so every seam is ragged. */
const LENGTHS = [52_919, 30_001, 1_153, 44_100, 17, 61_235];
const long = () => LENGTHS.map((n, i) => speechLike(n, i + 1));

/**
 * A codec whose stream records exactly what reached it, in order, and whose
 * `finish` really encodes it — so a test can assert the PCM the encoder saw
 * as well as the bytes it produced.
 */
function recordingCodec() {
  const base = testCodec();
  const written: Int16Array[] = [];
  const cancel = vi.fn();
  const finish = vi.fn();
  const openMp3Stream = vi.fn(async (): Promise<Mp3Stream> => {
    const stream = await base.openMp3Stream();
    return {
      write: async (samples) => {
        written.push(samples.slice());
        await stream.write(samples);
      },
      finish: async () => {
        finish();
        return stream.finish();
      },
      cancel: () => {
        cancel();
        stream.cancel();
      },
    };
  });
  return { ...base, openMp3Stream, written, cancel, finish };
}

describe("the streaming path is byte-identical to today's (#1003 b)", () => {
  it("a long all-PCM chapter streams to the same MP3 as the single-buffer encode", async () => {
    const { chapterId } = await chapterOf(long());
    const whole = testCodec();
    const legacy = await exportChapterMp3(
      chapterId,
      whole,
      undefined,
      undefined,
      NEVER
    );
    const codec = recordingCodec();
    const streamedOut = await exportChapterMp3(
      chapterId,
      codec,
      undefined,
      undefined,
      TINY
    );
    expect(codec.openMp3Stream).toHaveBeenCalledTimes(1);
    expect(codec.encodeMp3).not.toHaveBeenCalled();
    expect(whole.encodeMp3).toHaveBeenCalledTimes(1);
    expect(streamedOut!.segments).toBe(LENGTHS.length);
    expect(streamedOut!.missing).toBe(0);
    expect(streamedOut!.mp3.length).toBeGreaterThan(0);
    expect(Buffer.from(streamedOut!.mp3).equals(Buffer.from(legacy!.mp3))).toBe(
      true
    );
  });

  it("the join seam: the encoder is fed the gathered chapter exactly — segment, gap, segment — with nothing lost or doubled at a join", async () => {
    const { chapterId } = await chapterOf(long());
    const gathered = (await gatherChapterPcm(chapterId, testCodec()))!.samples;
    const codec = recordingCodec();
    await exportChapterMp3(chapterId, codec, undefined, undefined, TINY);
    const fed = new Int16Array(
      codec.written.reduce((sum, w) => sum + w.length, 0)
    );
    let at = 0;
    for (const w of codec.written) {
      fed.set(w, at);
      at += w.length;
    }
    expect(fed.length).toBe(gathered.length);
    expect(Buffer.from(fed.buffer).equals(Buffer.from(gathered.buffer))).toBe(
      true
    );
    // Each write is one segment or one gap, never the whole chapter.
    expect(codec.written.map((w) => w.length)).toEqual(
      LENGTHS.flatMap((n, i) => (i === 0 ? [n] : [GAP, n]))
    );
  });

  it("a mixed chapter (one Finished segment decoded) streams to the same MP3 too", async () => {
    const buffers = long();
    const { chapterId, segmentIds } = await chapterOf(buffers);
    await setSegmentFinished(segmentIds[1]!, true);
    const audio = await resolveSegmentAudio(segmentIds[1]!);
    if (audio.kind !== "resolved") throw new Error("no clip");
    const mp3 = encodeMp3(buffers[1]!.slice());
    await commitTranscode(
      segmentIds[1]!,
      audio.clip.id,
      mp3,
      computePeaks(buffers[1]!, 4)
    );
    const decode = async () => noTrimDecode(buffers[1]!, mp3);
    const legacy = await exportChapterMp3(
      chapterId,
      testCodec(decode),
      undefined,
      undefined,
      NEVER
    );
    const codec = { ...recordingCodec(), decodeMp3: vi.fn(decode) };
    const out = await exportChapterMp3(
      chapterId,
      codec,
      undefined,
      undefined,
      TINY
    );
    expect(codec.decodeMp3).toHaveBeenCalledTimes(1);
    expect(Buffer.from(out!.mp3).equals(Buffer.from(legacy!.mp3))).toBe(true);
  });

  it("a clip gone since pass 1 is skipped and counted missing, as today, and the gap is not doubled", async () => {
    const { chapterId } = await chapterOf(long());
    const real = clips.getClip;
    let reads = 0;
    vi.spyOn(clips, "getClip").mockImplementation(async (id) =>
      ++reads === 3 ? undefined : real(id)
    );
    const legacy = await exportChapterMp3(
      chapterId,
      testCodec(),
      undefined,
      undefined,
      NEVER
    );
    reads = 0;
    const codec = recordingCodec();
    const out = await exportChapterMp3(
      chapterId,
      codec,
      undefined,
      undefined,
      TINY
    );
    expect(out!.missing).toBe(1);
    expect(out!.segments).toBe(LENGTHS.length - 1);
    expect(Buffer.from(out!.mp3).equals(Buffer.from(legacy!.mp3))).toBe(true);
  });
});

/**
 * The retained-PCM measurement. Every Int16Array ALLOCATED during an export
 * (a fresh length or a copy, not a view onto an existing buffer) is recorded
 * by size; the largest one is the floor on the PCM the export held at once.
 */
async function largestPcmAllocation(run: () => Promise<unknown>) {
  const Real = Int16Array;
  let largest = 0;
  const Spy = new Proxy(Real, {
    construct(target, args, newTarget) {
      const made = Reflect.construct(target, args, newTarget) as Int16Array;
      if (!(args[0] instanceof ArrayBuffer))
        largest = Math.max(largest, made.byteLength);
      return made;
    },
  });
  globalThis.Int16Array = Spy;
  try {
    await run();
  } finally {
    globalThis.Int16Array = Real;
  }
  return largest;
}

describe("retained PCM (#1003 b: measure, before and after)", () => {
  it("today's path allocates the whole chapter; the stream never more than one segment", async () => {
    const { chapterId } = await chapterOf(long());
    const chapterBytes =
      (LENGTHS.reduce((a, b) => a + b, 0) + (LENGTHS.length - 1) * GAP) * 2;
    const segmentBytes = Math.max(...LENGTHS) * 2;

    const before = await largestPcmAllocation(() =>
      exportChapterMp3(chapterId, testCodec(), undefined, undefined, NEVER)
    );
    const after = await largestPcmAllocation(() =>
      exportChapterMp3(chapterId, recordingCodec(), undefined, undefined, TINY)
    );
    // Before: the chapter-sized buffer is there, whole.
    expect(before).toBeGreaterThanOrEqual(chapterBytes);
    // After: nothing larger than the longest segment was ever allocated.
    expect(after).toBeLessThanOrEqual(segmentBytes);
    expect(after).toBeLessThan(chapterBytes / 2);
  });
});

describe("steps (#1049 reducer contract)", () => {
  /** A codec that emits one encode fraction, so today's path shows it. */
  function progressCodec() {
    const base = recordingCodec();
    return {
      ...base,
      encodeMp3: vi.fn(
        async (samples: Int16Array, onProgress?: (f: number) => void) => {
          onProgress?.(0.5);
          return encodeMp3(samples);
        }
      ),
    };
  }

  async function stepsOf(threshold: number, codec: AudioCodec) {
    const { chapterId } = await chapterOf([
      speechLike(3000, 1),
      speechLike(4000, 2),
    ]);
    const seen: Array<[number, number, number | undefined]> = [];
    const out = await withEncodeSteps(
      (done, total, _s, items) => seen.push([done, total, items]),
      () => true,
      (c, onStep) =>
        exportChapterMp3(chapterId, c, undefined, onStep, threshold)
    )(codec);
    return { seen, out };
  }

  it("at or under the threshold: today's steps exactly, and no stream is opened", async () => {
    const codec = progressCodec();
    const { seen, out } = await stepsOf(NEVER, codec);
    const total = 2 + ENCODE_STEPS;
    expect(seen).toEqual([
      [0, total, 2],
      [1, total, 2],
      [2, total, 2],
      [2 + ENCODE_STEPS / 2, total, 2],
      [total, total, 2],
    ]);
    expect(out).not.toBeNull();
    expect(codec.openMp3Stream).not.toHaveBeenCalled();
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("over it: the same total and items, each segment's step after its encode, then total when the MP3 exists (the coarse meter)", async () => {
    const codec = progressCodec();
    const { seen } = await stepsOf(TINY, codec);
    const total = 2 + ENCODE_STEPS;
    expect(seen).toEqual([
      [0, total, 2],
      [1, total, 2],
      [2, total, 2],
      [total, total, 2],
    ]);
    expect(codec.encodeMp3).not.toHaveBeenCalled();
    // Each segment's step came only once its PCM was in the encoder.
    expect(codec.written.length).toBe(3);
  });

  it("a finish that rejects never reaches total", async () => {
    const codec = recordingCodec();
    const failing = {
      ...codec,
      openMp3Stream: async (): Promise<Mp3Stream> => ({
        ...(await codec.openMp3Stream()),
        finish: () => Promise.reject(new Error("encoder died at the end")),
      }),
    };
    const seen: number[] = [];
    const { chapterId } = await chapterOf([speechLike(3000, 1)]);
    await expect(
      withEncodeSteps(
        (done) => seen.push(done),
        () => true,
        (c, onStep) => exportChapterMp3(chapterId, c, undefined, onStep, TINY)
      )(failing)
    ).rejects.toThrow("encoder died at the end");
    expect(seen).toEqual([0, 1]);
  });
});

describe("cancel and failure mid-stream", () => {
  it("a cancel after the first segment returns null, reports nothing more, and cancels the stream without finishing it", async () => {
    const { chapterId } = await chapterOf(long());
    const codec = recordingCodec();
    let live = true;
    const seen: number[] = [];
    const out = await exportChapterMp3(
      chapterId,
      codec,
      () => live,
      (done) => {
        seen.push(done);
        if (done === 1) live = false;
      },
      TINY
    );
    expect(out).toBeNull();
    expect(seen).toEqual([0, 1]);
    expect(codec.written).toHaveLength(1);
    expect(codec.finish).not.toHaveBeenCalled();
    expect(codec.cancel).toHaveBeenCalledTimes(1);
  });

  it("a cancel that lands DURING a segment's write reports no step for that segment", async () => {
    const { chapterId } = await chapterOf(long());
    const codec = recordingCodec();
    let live = true;
    let writes = 0;
    const cancelling = {
      ...codec,
      openMp3Stream: async (): Promise<Mp3Stream> => {
        const stream = await codec.openMp3Stream();
        return {
          ...stream,
          write: async (samples) => {
            await stream.write(samples);
            // Write 3 is segment 2 (after segment 1 and the gap).
            if (++writes === 3) live = false;
          },
        };
      },
    };
    const seen: number[] = [];
    const out = await exportChapterMp3(
      chapterId,
      cancelling,
      () => live,
      (done) => seen.push(done),
      TINY
    );
    expect(out).toBeNull();
    expect(seen).toEqual([0, 1]);
    expect(codec.cancel).toHaveBeenCalledTimes(1);
  });

  it("each segment's step is reported only after that segment's PCM is in the encoder", async () => {
    const { chapterId } = await chapterOf(long());
    const codec = recordingCodec();
    const order: string[] = [];
    const tracing = {
      ...codec,
      openMp3Stream: async (): Promise<Mp3Stream> => {
        const stream = await codec.openMp3Stream();
        return {
          ...stream,
          write: async (samples) => {
            await stream.write(samples);
            order.push(samples.length === GAP ? "gap" : "segment");
          },
        };
      },
    };
    await exportChapterMp3(
      chapterId,
      tracing,
      undefined,
      (done) => order.push(`step ${done}`),
      TINY
    );
    expect(order).toEqual([
      "step 0",
      "segment",
      "step 1",
      ...LENGTHS.slice(1).flatMap((_, i) => [
        "gap",
        "segment",
        `step ${i + 2}`,
      ]),
    ]);
  });

  it("a cancel before anything is gathered never opens a stream", async () => {
    const { chapterId } = await chapterOf(long());
    const codec = recordingCodec();
    const out = await exportChapterMp3(
      chapterId,
      codec,
      () => false,
      undefined,
      TINY
    );
    expect(out).toBeNull();
    expect(codec.openMp3Stream).not.toHaveBeenCalled();
  });

  it("an encoder error mid-stream rejects the export with that error, stops the count, and cancels the stream", async () => {
    const { chapterId } = await chapterOf(long());
    const codec = recordingCodec();
    const failure = new Error("worker died mid-chapter");
    const failing = {
      ...codec,
      openMp3Stream: async (): Promise<Mp3Stream> => {
        const stream = await codec.openMp3Stream();
        let writes = 0;
        return {
          ...stream,
          write: (samples) =>
            ++writes === 3 ? Promise.reject(failure) : stream.write(samples),
        };
      },
    };
    const seen: number[] = [];
    await expect(
      exportChapterMp3(
        chapterId,
        failing,
        undefined,
        (done) => seen.push(done),
        TINY
      )
    ).rejects.toBe(failure);
    // Segment 1 (write 1), then gap (write 2) + segment 2 (write 3) fails.
    expect(seen).toEqual([0, 1]);
    expect(codec.finish).not.toHaveBeenCalled();
    expect(codec.cancel).toHaveBeenCalledTimes(1);
  });

  it("a stream that fails to open rejects the export before any step", async () => {
    const { chapterId } = await chapterOf(long());
    const seen: number[] = [];
    await expect(
      exportChapterMp3(
        chapterId,
        {
          ...testCodec(),
          openMp3Stream: () => Promise.reject(new Error("no worker")),
        },
        undefined,
        (done) => seen.push(done),
        TINY
      )
    ).rejects.toThrow("no worker");
    expect(seen).toEqual([]);
  });
});

describe("the threshold (#1003 b; DRI pick B)", () => {
  /**
   * A codec that records which path it was asked for and does no encoding,
   * so a chapter at the real threshold (tens of MB of PCM) costs no encode.
   */
  function pathCodec() {
    const openMp3Stream = vi.fn(async (): Promise<Mp3Stream> => ({
      write: async () => {},
      finish: async () => new Uint8Array(1),
      cancel: () => {},
    }));
    const encodeMp3 = vi.fn(async () => new Uint8Array(1));
    return {
      openMp3Stream,
      encodeMp3,
      decodeMp3: () => Promise.reject(new Error("no MP3 expected")),
    };
  }

  const frames = STREAMING_PCM_THRESHOLD_BYTES / 2;

  it("is a whole number of 16-bit frames", () => {
    expect(Number.isInteger(frames)).toBe(true);
  });

  it("a chapter of exactly the threshold takes today's path", async () => {
    const { chapterId } = await chapterOf([new Int16Array(frames)]);
    const codec = pathCodec();
    await exportChapterMp3(chapterId, codec);
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);
    expect(codec.openMp3Stream).not.toHaveBeenCalled();
  });

  it("one frame over it streams", async () => {
    const { chapterId } = await chapterOf([new Int16Array(frames + 1)]);
    const codec = pathCodec();
    await exportChapterMp3(chapterId, codec);
    expect(codec.openMp3Stream).toHaveBeenCalledTimes(1);
    expect(codec.encodeMp3).not.toHaveBeenCalled();
  });

  it("counts the gaps: two segments whose frames alone are under it, but whose gap takes the chapter over, stream", async () => {
    const half = frames / 2;
    const { chapterId } = await chapterOf([
      new Int16Array(half),
      new Int16Array(half - GAP + 1),
    ]);
    const codec = pathCodec();
    await exportChapterMp3(chapterId, codec);
    expect(codec.openMp3Stream).toHaveBeenCalledTimes(1);
  });

  it("a codec with no stream support takes today's path even over it", async () => {
    const { chapterId } = await chapterOf([speechLike(3000, 1)]);
    const full = testCodec();
    const plain: AudioCodec = {
      encodeMp3: full.encodeMp3,
      decodeMp3: full.decodeMp3,
    };
    const out = await exportChapterMp3(
      chapterId,
      plain,
      undefined,
      undefined,
      TINY
    );
    expect(out!.mp3.length).toBeGreaterThan(0);
    expect(full.encodeMp3).toHaveBeenCalledTimes(1);
    expect(full.openMp3Stream).not.toHaveBeenCalled();
  });
});
