import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
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
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import type { ChapterId } from "@/types/domain";

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

const GAP = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);

beforeEach(async () => {
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

/**
 * A chapter of segments, each either recorded with `{ n, v }` frames all equal
 * to `v`, or `null` for a never-recorded segment. The constant value per segment
 * is what lets the concatenation order and the gap be asserted on the samples.
 */
async function chapterWith(
  specs: Array<{ n: number; v: number } | null>
): Promise<ChapterId> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  for (const spec of specs) {
    const seg = await addSegment(chapter.id);
    if (spec) {
      await saveTake(
        seg.id,
        newClipId(),
        samples(spec.n, spec.v),
        CANONICAL_SAMPLE_RATE
      );
    }
  }
  return chapter.id;
}

describe("gatherChapterPcm", () => {
  it("concatenates segments in order with a gap between", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 100 },
      { n: 200, v: 200 },
    ]);
    const {
      samples: pcm,
      segments,
      missing,
    } = await gatherChapterPcm(chapterId);

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
    const chapterId = await chapterWith([
      { n: 100, v: 100 },
      null,
      { n: 100, v: 200 },
    ]);
    const {
      samples: pcm,
      segments,
      missing,
    } = await gatherChapterPcm(chapterId);

    expect(segments).toBe(2);
    expect(missing).toBe(1);
    // Two recorded segments joined by one gap — the missing one adds nothing.
    expect(pcm.length).toBe(100 + GAP + 100);
    expect(pcm[100 + GAP]).toBe(200);
  });

  it("adds no leading or trailing gap around a single segment", async () => {
    const chapterId = await chapterWith([{ n: 100, v: 100 }]);
    const { samples: pcm, segments } = await gatherChapterPcm(chapterId);

    expect(segments).toBe(1);
    expect(pcm.length).toBe(100);
    expect(pcm[0]).toBe(100);
    expect(pcm[99]).toBe(100);
  });

  it("yields no samples for a chapter with nothing recorded", async () => {
    const chapterId = await chapterWith([null, null]);
    const {
      samples: pcm,
      segments,
      missing,
    } = await gatherChapterPcm(chapterId);

    expect(segments).toBe(0);
    expect(missing).toBe(2);
    expect(pcm.length).toBe(0);
  });
});

describe("exportChapterMp3", () => {
  it("encodes a recorded chapter to MP3 bytes", async () => {
    const chapterId = await chapterWith([
      { n: CANONICAL_SAMPLE_RATE, v: 1000 },
      { n: CANONICAL_SAMPLE_RATE, v: -1000 },
    ]);
    const result = await exportChapterMp3(chapterId);

    expect(result).not.toBeNull();
    expect(result!.segments).toBe(2);
    expect(result!.missing).toBe(0);
    expect(result!.mp3.length).toBeGreaterThan(0);
  });

  it("returns null when the chapter has nothing recorded", async () => {
    const chapterId = await chapterWith([null]);
    expect(await exportChapterMp3(chapterId)).toBeNull();
  });
});
