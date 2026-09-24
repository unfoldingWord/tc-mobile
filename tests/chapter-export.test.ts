import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  SEGMENT_GAP_SECONDS,
  exportChapterMp3,
  gatherChapterPcm,
} from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  saveTake,
  setSegmentFinished,
} from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import { commitTranscode } from "@/lib/storage/transcode";
import type { ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores, noTrimDecode, ramp, testCodec } from "./support";

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

const GAP = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);

beforeEach(clearAllStores);

/**
 * A chapter of segments, each either recorded with `{ n, v }` frames all equal
 * to `v`, or `null` for a never-recorded segment. The constant value per segment
 * is what lets the concatenation order and the gap be asserted on the samples.
 */
async function chapterWith(
  specs: Array<{ n: number; v: number } | null>
): Promise<{ chapterId: ChapterId; segmentIds: SegmentId[] }> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segmentIds: SegmentId[] = [];
  for (const spec of specs) {
    const seg = await addSegment(chapter.id);
    segmentIds.push(seg.id);
    if (spec) {
      await saveTake(
        seg.id,
        newClipId(),
        samples(spec.n, spec.v),
        CANONICAL_SAMPLE_RATE
      );
    }
  }
  return { chapterId: chapter.id, segmentIds };
}

/** A chapter whose segments hold exactly these sample buffers, in order. */
async function chapterWithSamples(
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

/**
 * Finish a segment and land its transcode, as the B8 sweep does — so the chapter
 * holds an MP3 clip whose bytes are a real encode of `pcm`. Returns those bytes.
 */
async function transcoded(
  segmentId: SegmentId,
  pcm: Int16Array
): Promise<Uint8Array> {
  await setSegmentFinished(segmentId, true);
  const audio = await resolveSegmentAudio(segmentId);
  if (audio.kind !== "resolved") throw new Error("segment has no clip");
  const mp3 = encodeMp3(pcm);
  const outcome = await commitTranscode(
    segmentId,
    audio.clip.id,
    mp3,
    computePeaks(pcm, 4)
  );
  expect(outcome).toBe("committed");
  return mp3;
}

describe("gatherChapterPcm", () => {
  it("concatenates segments in order with a gap between", async () => {
    const { chapterId } = await chapterWith([
      { n: 100, v: 100 },
      { n: 200, v: 200 },
    ]);
    const {
      samples: pcm,
      segments,
      missing,
    } = (await gatherChapterPcm(chapterId, testCodec()))!;

    expect(segments).toBe(2);
    expect(missing).toBe(0);
    expect(pcm.length).toBe(100 + GAP + 200);
    // Order + gap placement: the first segment leads, the gap is silence, the
    // second segment starts only after the gap.
    expect(pcm[0]).toBe(100);
    expect(pcm[99]).toBe(100);
    expect(pcm[100 + Math.floor(GAP / 2)]).toBe(0);
    expect(pcm[100 + GAP]).toBe(200);
    expect(pcm[pcm.length - 1]).toBe(200);
  });

  it("skips never-recorded segments and counts them missing", async () => {
    const { chapterId } = await chapterWith([
      { n: 100, v: 100 },
      null,
      { n: 100, v: 200 },
    ]);
    const {
      samples: pcm,
      segments,
      missing,
    } = (await gatherChapterPcm(chapterId, testCodec()))!;

    expect(segments).toBe(2);
    expect(missing).toBe(1);
    // Two recorded segments joined by one gap — the missing one adds nothing.
    expect(pcm.length).toBe(100 + GAP + 100);
    expect(pcm[100 + GAP]).toBe(200);
  });

  it("adds no leading or trailing gap around a single segment", async () => {
    const { chapterId } = await chapterWith([{ n: 100, v: 100 }]);
    const { samples: pcm, segments } = (await gatherChapterPcm(
      chapterId,
      testCodec()
    ))!;

    expect(segments).toBe(1);
    expect(pcm.length).toBe(100);
    expect(pcm[0]).toBe(100);
    expect(pcm[99]).toBe(100);
  });

  it("yields no samples for a chapter with nothing recorded", async () => {
    const { chapterId } = await chapterWith([null, null]);
    const {
      samples: pcm,
      segments,
      missing,
    } = (await gatherChapterPcm(chapterId, testCodec()))!;

    expect(segments).toBe(0);
    expect(missing).toBe(2);
    expect(pcm.length).toBe(0);
  });

  it("counts a clip erased between resolution and load as missing", async () => {
    // `resolveChapterClipIds` resolves both clips (missing 0). The bug is the
    // window AFTER that walk: a clip erased before `gatherChapterPcm` reads it
    // returns nothing from `getClip` and is skipped — it must be counted, or a
    // chapter with a hole exports "as if whole" (Frank F3). Deleting clipData up
    // front cannot reproduce it: the metadata walk would then count it missing
    // itself, masking the loop's own count. So intercept the SECOND `getClip`
    // (the second segment) to miss, exactly as a mid-gather erase would.
    const { chapterId } = await chapterWith([
      { n: 100, v: 100 },
      { n: 100, v: 200 },
    ]);
    const real = clips.getClip.bind(clips);
    let call = 0;
    const spy = vi
      .spyOn(clips, "getClip")
      .mockImplementation((id) =>
        ++call === 2 ? Promise.resolve(undefined) : real(id)
      );

    const {
      samples: pcm,
      segments,
      missing,
    } = (await gatherChapterPcm(chapterId, testCodec()))!;

    expect(segments).toBe(1); // only the first segment survived the read
    expect(missing).toBe(1); // the erased one — silently 0 before the fix
    expect(pcm.length).toBe(100); // one segment, no gap
    spy.mockRestore();
  });

  it("counts a clip whose stored PCM length disagrees with its own metadata as missing, instead of throwing (S-10)", async () => {
    // Pass 1 sizes the output buffer from `getClipMeta().frameCount`; pass 2
    // copies `getClip()`'s bytes into the slot that size reserved. The two
    // reads are not one transaction, so nothing here stops them from
    // disagreeing about a clip's length. Reproduce that disagreement directly
    // by handing back a PCM clip one frame longer than its own metadata says —
    // on develop's code, `out.set(fitted, written)` then throws a RangeError
    // because the reserved slot is a frame too small.
    const { chapterId } = await chapterWith([
      { n: 100, v: 100 },
      { n: 100, v: 200 },
    ]);
    const real = clips.getClip.bind(clips);
    let call = 0;
    const spy = vi.spyOn(clips, "getClip").mockImplementation(async (id) => {
      call++;
      const clip = await real(id);
      if (call === 2 && clip && clip.encoding === "pcm") {
        const grown = new Int16Array(clip.samples.length + 1);
        grown.set(clip.samples);
        return { ...clip, samples: grown };
      }
      return clip;
    });

    const gathered = await gatherChapterPcm(chapterId, testCodec());

    expect(gathered).not.toBeNull();
    const { samples: pcm, segments, missing } = gathered!;
    expect(segments).toBe(1); // only the well-formed segment survived
    expect(missing).toBe(1); // the length-mismatched one is counted, not thrown
    expect(pcm.length).toBe(100); // one segment, no gap
    spy.mockRestore();
  });

  /**
   * B8/D3: a finished segment's clip is MP3. The gather decodes it through the
   * injected codec and puts the RECORDING — not the decode — in the slot its
   * original frame count reserved. The decoder is modelled as the one Chromium
   * has (`noTrimDecode`: priming, recording, padding), and every fixture is a
   * ramp so a fit that kept the wrong end is caught (round-2 Frank P1).
   */
  describe("with a finished (MP3) segment", () => {
    /** A chapter [PCM 100][MP3 200] with distinct ramps; the MP3's bytes. */
    async function pcmThenMp3() {
      const first = ramp(100, 100);
      const second = ramp(200, 5000);
      const { chapterId, segmentIds } = await chapterWithSamples([
        first,
        second,
      ]);
      const mp3 = await transcoded(segmentIds[1]!, second);
      return { chapterId, first, second, mp3 };
    }

    it("aligns the decode so the recording, not the priming, lands in the slot", async () => {
      const { chapterId, first, second, mp3 } = await pcmThenMp3();
      const codec = testCodec(async (bytes) => noTrimDecode(second, bytes));

      const gathered = await gatherChapterPcm(chapterId, codec);
      expect(gathered).not.toBeNull();
      const { samples: pcm, segments, missing } = gathered!;

      expect(codec.decodeMp3).toHaveBeenCalledTimes(1);
      // Fed the stored MP3 bytes, not something re-read or re-encoded.
      expect(Array.from(codec.decodeMp3.mock.calls[0]![0])).toEqual(
        Array.from(mp3)
      );
      expect(segments).toBe(2);
      expect(missing).toBe(0);
      expect(pcm.length).toBe(100 + GAP + 200);
      expect(Array.from(pcm.subarray(0, 100))).toEqual(Array.from(first));
      // The MP3 segment's slot holds exactly the recording: first sample to
      // last, no leading priming, no trailing padding, nothing spilled.
      expect(Array.from(pcm.subarray(100 + GAP))).toEqual(Array.from(second));
    });

    it("keeps the LAST recorded samples of a finished segment (round 2's defect)", async () => {
      // Round 1 kept the decode's first `frameCount` samples: the slot ended
      // 1105 samples early, with the recording's tail cut off.
      const { chapterId, second } = await pcmThenMp3();
      const codec = testCodec(async (bytes) => noTrimDecode(second, bytes));
      const { samples: pcm } = (await gatherChapterPcm(chapterId, codec))!;
      expect(pcm[pcm.length - 1]).toBe(second[second.length - 1]);
      expect(pcm[100 + GAP]).toBe(second[0]);
    });

    it("takes a sample-exact decode as it is", async () => {
      const { chapterId, second } = await pcmThenMp3();
      const codec = testCodec(async () => new Int16Array(second));
      const { samples: pcm } = (await gatherChapterPcm(chapterId, codec))!;
      expect(Array.from(pcm.subarray(100 + GAP))).toEqual(Array.from(second));
    });

    it("pads a decode that comes back SHORTER with silence to the recorded length", async () => {
      const { chapterId, second } = await pcmThenMp3();
      const codec = testCodec(async () => second.subarray(0, 150));
      const { samples: pcm, segments } = (await gatherChapterPcm(
        chapterId,
        codec
      ))!;

      expect(segments).toBe(2);
      expect(pcm.length).toBe(100 + GAP + 200);
      expect(Array.from(pcm.subarray(100 + GAP, 100 + GAP + 150))).toEqual(
        Array.from(second.subarray(0, 150))
      );
      expect(Array.from(pcm.subarray(100 + GAP + 150))).toEqual(
        new Array<number>(50).fill(0)
      );
    });

    it("counts a decode that yields nothing as missing", async () => {
      // A decoder that produces no samples for a clip is the same to the share
      // as a clip that is not there: skipped and admitted to, never a silent
      // hole the count does not mention.
      const { chapterId } = await pcmThenMp3();
      const codec = testCodec(async () => new Int16Array(0));

      const {
        samples: pcm,
        segments,
        missing,
      } = (await gatherChapterPcm(chapterId, codec))!;

      expect(segments).toBe(1);
      expect(missing).toBe(1);
      expect(pcm.length).toBe(100);
    });

    it("never calls the decoder for a chapter that is all PCM", async () => {
      const { chapterId } = await chapterWith([
        { n: 100, v: 100 },
        { n: 100, v: 200 },
      ]);
      const codec = testCodec();
      await gatherChapterPcm(chapterId, codec);
      expect(codec.decodeMp3).not.toHaveBeenCalled();
    });

    it("stops before the next decode once cancelled mid-gather", async () => {
      // Two finished segments. The gather holds the encoder lane through every
      // decode, so a share dismissed after the first decode must not pay for
      // the second (round-2 George P2). Flip the seam the moment decode 1 runs.
      const a = ramp(200, 100);
      const b = ramp(200, 5000);
      const { chapterId, segmentIds } = await chapterWithSamples([a, b]);
      await transcoded(segmentIds[0]!, a);
      await transcoded(segmentIds[1]!, b);
      let decodes = 0;
      const codec = testCodec(async (bytes) => {
        decodes++;
        return noTrimDecode(decodes === 1 ? a : b, bytes);
      });

      const result = await gatherChapterPcm(
        chapterId,
        codec,
        () => decodes < 1
      );

      expect(result).toBeNull();
      expect(codec.decodeMp3).toHaveBeenCalledTimes(1);
    });

    it("stops before the first clip read when cancelled up front", async () => {
      const { chapterId } = await pcmThenMp3();
      const codec = testCodec();
      const spy = vi.spyOn(clips, "getClip");
      expect(await gatherChapterPcm(chapterId, codec, () => false)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      expect(codec.decodeMp3).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe("exportChapterMp3", () => {
  it("encodes a recorded chapter to MP3 bytes through the codec", async () => {
    const { chapterId } = await chapterWith([
      { n: CANONICAL_SAMPLE_RATE, v: 1000 },
      { n: CANONICAL_SAMPLE_RATE, v: -1000 },
    ]);
    const codec = testCodec();
    const result = await exportChapterMp3(chapterId, codec);

    expect(result).not.toBeNull();
    expect(result!.segments).toBe(2);
    expect(result!.missing).toBe(0);
    expect(result!.mp3.length).toBeGreaterThan(0);
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("returns null when the chapter has nothing recorded", async () => {
    const { chapterId } = await chapterWith([null]);
    expect(await exportChapterMp3(chapterId, testCodec())).toBeNull();
  });

  it("skips the encode and returns null when shouldEncode() is false after the gather", async () => {
    // The gather awaits (cancellable); a caller cancelled during it returns
    // false to skip spinning up an encode for a share already dismissed.
    const { chapterId } = await chapterWith([{ n: 100, v: 100 }]);
    const codec = testCodec();

    const result = await exportChapterMp3(chapterId, codec, () => false);

    expect(result).toBeNull();
    expect(codec.encodeMp3).not.toHaveBeenCalled();
  });

  it("encodes when shouldEncode() is true", async () => {
    const { chapterId } = await chapterWith([{ n: 100, v: 100 }]);
    const result = await exportChapterMp3(chapterId, testCodec(), () => true);
    expect(result).not.toBeNull();
    expect(result!.mp3.length).toBeGreaterThan(0);
  });
});
