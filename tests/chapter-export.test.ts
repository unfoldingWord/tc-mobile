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
import { clearAllStores, testCodec } from "./support";

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
    } = await gatherChapterPcm(chapterId, testCodec());

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
    } = await gatherChapterPcm(chapterId, testCodec());

    expect(segments).toBe(2);
    expect(missing).toBe(1);
    // Two recorded segments joined by one gap — the missing one adds nothing.
    expect(pcm.length).toBe(100 + GAP + 100);
    expect(pcm[100 + GAP]).toBe(200);
  });

  it("adds no leading or trailing gap around a single segment", async () => {
    const { chapterId } = await chapterWith([{ n: 100, v: 100 }]);
    const { samples: pcm, segments } = await gatherChapterPcm(
      chapterId,
      testCodec()
    );

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
    } = await gatherChapterPcm(chapterId, testCodec());

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
    } = await gatherChapterPcm(chapterId, testCodec());

    expect(segments).toBe(1); // only the first segment survived the read
    expect(missing).toBe(1); // the erased one — silently 0 before the fix
    expect(pcm.length).toBe(100); // one segment, no gap
    spy.mockRestore();
  });

  /**
   * B8/D3: a finished segment's clip is MP3. The gather must decode it through
   * the injected codec and put the result in the slot its ORIGINAL frame count
   * reserved — an MP3 decode is not sample-exact (encoder padding, and whether
   * the decoder trims it), so a long decode is trimmed and a short one padded.
   */
  describe("with a finished (MP3) segment", () => {
    it("decodes the MP3 through the codec into its original-length slot", async () => {
      const { chapterId, segmentIds } = await chapterWith([
        { n: 100, v: 100 },
        { n: 200, v: 200 },
      ]);
      const mp3 = await transcoded(segmentIds[1]!, samples(200, 200));
      // A decoder that comes back sample-exact.
      const codec = testCodec(async () => samples(200, 200));

      const {
        samples: pcm,
        segments,
        missing,
      } = await gatherChapterPcm(chapterId, codec);

      expect(codec.decodeMp3).toHaveBeenCalledTimes(1);
      // Fed the stored MP3 bytes, not something re-read or re-encoded.
      expect(Array.from(codec.decodeMp3.mock.calls[0]![0])).toEqual(
        Array.from(mp3)
      );
      expect(segments).toBe(2);
      expect(missing).toBe(0);
      expect(pcm.length).toBe(100 + GAP + 200);
      expect(pcm[100 + GAP]).toBe(200);
      expect(pcm[pcm.length - 1]).toBe(200);
    });

    it("trims a decode that runs LONGER than the recorded length", async () => {
      // A decoder that does not strip the encoder padding hands back ~1.1k
      // extra samples. The slot is the recorded length; the tail is dropped, and
      // the segment after it starts exactly where the metadata says.
      const { chapterId, segmentIds } = await chapterWith([
        { n: 200, v: 200 },
        { n: 100, v: 100 },
      ]);
      await transcoded(segmentIds[0]!, samples(200, 200));
      const codec = testCodec(async () => samples(200 + 1152, 200));

      const { samples: pcm, segments } = await gatherChapterPcm(
        chapterId,
        codec
      );

      expect(segments).toBe(2);
      expect(pcm.length).toBe(200 + GAP + 100); // not 200 + 1152 + …
      expect(pcm[199]).toBe(200);
      expect(pcm[200]).toBe(0); // the gap starts on time
      expect(pcm[200 + GAP]).toBe(100);
    });

    it("trims a long decode on the LAST segment, where there is no room to spill", async () => {
      // With a segment after it, an over-long decode that spilled into the gap
      // would be overwritten by the gap and go unnoticed. Last in the chapter,
      // the buffer ends where the recorded length ends: a decode written
      // unfitted would run off the end of it.
      const { chapterId, segmentIds } = await chapterWith([
        { n: 100, v: 100 },
        { n: 200, v: 200 },
      ]);
      await transcoded(segmentIds[1]!, samples(200, 200));
      const codec = testCodec(async () => samples(200 + 1152, 200));

      const { samples: pcm, segments } = await gatherChapterPcm(
        chapterId,
        codec
      );

      expect(segments).toBe(2);
      expect(pcm.length).toBe(100 + GAP + 200);
      expect(pcm[pcm.length - 1]).toBe(200);
    });

    it("pads a decode that comes back SHORTER with silence to the recorded length", async () => {
      const { chapterId, segmentIds } = await chapterWith([
        { n: 200, v: 200 },
        { n: 100, v: 100 },
      ]);
      await transcoded(segmentIds[0]!, samples(200, 200));
      const codec = testCodec(async () => samples(150, 200));

      const { samples: pcm, segments } = await gatherChapterPcm(
        chapterId,
        codec
      );

      expect(segments).toBe(2);
      expect(pcm.length).toBe(200 + GAP + 100);
      expect(pcm[149]).toBe(200);
      expect(pcm[150]).toBe(0); // padded, not garbage and not the next segment
      expect(pcm[199]).toBe(0);
      expect(pcm[200 + GAP]).toBe(100);
    });

    it("counts a decode that yields nothing as missing", async () => {
      // A decoder that produces no samples for a clip is the same to the share
      // as a clip that is not there: skipped and admitted to, never a silent
      // hole the count does not mention.
      const { chapterId, segmentIds } = await chapterWith([
        { n: 100, v: 100 },
        { n: 200, v: 200 },
      ]);
      await transcoded(segmentIds[1]!, samples(200, 200));
      const codec = testCodec(async () => new Int16Array(0));

      const {
        samples: pcm,
        segments,
        missing,
      } = await gatherChapterPcm(chapterId, codec);

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
