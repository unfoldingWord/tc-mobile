import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { exportBookZip } from "@/lib/export/book";
import * as chapterExport from "@/lib/export/chapter";
import {
  exportChapterMp3,
  gatherChapterPcm,
  type StepReporter,
} from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  resolveBookChapters,
} from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import type { BookId, ChapterId, ClipId } from "@/types/domain";
import { clearAllStores, testCodec } from "./support";

/**
 * #986: the export path reports a truthful step count as it goes — one step
 * per segment gathered for Share Chapter, one per chapter archived for Share
 * Book. Each case records every `onStep(done, total)` call in order, so "once
 * per finished item", "never past total" and "a failure stops it" are all
 * assertions on the exact sequence.
 */

type Spec = { n: number; v: number } | null;

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

const nameChapter = (n: number): string => `Chapter ${n}.mp3`;

beforeEach(clearAllStores);

async function addRecordedChapter(bookId: BookId, specs: Spec[]) {
  const chapter = await addChapter(bookId);
  for (const spec of specs) {
    const seg = await addSegment(chapter.id);
    if (spec)
      await saveTake(
        seg.id,
        newClipId(),
        samples(spec.n, spec.v),
        CANONICAL_SAMPLE_RATE
      );
  }
  return chapter.id;
}

async function chapterWith(specs: Spec[]): Promise<ChapterId> {
  const book = await createBook("b");
  return addRecordedChapter(book.id, specs);
}

async function bookWith(chapters: Spec[][]): Promise<BookId> {
  const book = await createBook("b");
  for (const specs of chapters) await addRecordedChapter(book.id, specs);
  return book.id;
}

function recorder() {
  const calls: Array<[number, number]> = [];
  const onStep = (done: number, total: number): void => {
    calls.push([done, total]);
  };
  return { calls, onStep };
}

describe("gatherChapterPcm — segment steps (#986)", () => {
  it("reports 0 of N first, then one step per segment, ending at N of N", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
      { n: 100, v: 3 },
    ]);
    const { calls, onStep } = recorder();

    await gatherChapterPcm(chapterId, testCodec(), undefined, onStep);

    expect(calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("counts only segments that have audio to gather in total", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      null,
      { n: 100, v: 3 },
    ]);
    const { calls, onStep } = recorder();

    await gatherChapterPcm(chapterId, testCodec(), undefined, onStep);

    expect(calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("a segment whose clip vanished mid-gather is a finished step (counted missing), not a stall", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
    ]);
    const real = clips.getClip.bind(clips);
    let call = 0;
    const spy = vi
      .spyOn(clips, "getClip")
      .mockImplementation((id) =>
        ++call === 1 ? Promise.resolve(undefined) : real(id)
      );
    const { calls, onStep } = recorder();

    const gathered = await gatherChapterPcm(
      chapterId,
      testCodec(),
      undefined,
      onStep
    );
    spy.mockRestore();

    expect(gathered?.missing).toBe(1);
    expect(calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("a failure mid-way stops the count where it was", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
      { n: 100, v: 3 },
    ]);
    const real = clips.getClip.bind(clips);
    let call = 0;
    const spy = vi
      .spyOn(clips, "getClip")
      .mockImplementation((id) =>
        ++call === 2 ? Promise.reject(new Error("read failed")) : real(id)
      );
    const { calls, onStep } = recorder();

    await expect(
      gatherChapterPcm(chapterId, testCodec(), undefined, onStep)
    ).rejects.toThrow("read failed");
    spy.mockRestore();

    expect(calls).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });

  it("a cancel between segments reports no step past the point it stopped", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
      { n: 100, v: 3 },
    ]);
    const { calls, onStep } = recorder();
    // Cancel as soon as the first segment has been reported done.
    const shouldContinue = () => !calls.some(([done]) => done >= 1);

    const result = await gatherChapterPcm(
      chapterId,
      testCodec(),
      shouldContinue,
      onStep
    );

    expect(result).toBeNull();
    expect(calls).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });

  it("a cancel that lands while a segment is being read reports no step for it", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
      { n: 100, v: 3 },
    ]);
    const real = clips.getClip.bind(clips);
    let cancelled = false;
    // The cancel arrives DURING the first read: the check at the top of the
    // loop has already passed, so only a re-check after the await can see it.
    const spy = vi.spyOn(clips, "getClip").mockImplementation((id) => {
      cancelled = true;
      return real(id);
    });
    const { calls, onStep } = recorder();

    const result = await gatherChapterPcm(
      chapterId,
      testCodec(),
      () => !cancelled,
      onStep
    );
    spy.mockRestore();

    expect(result).toBeNull();
    expect(calls).toEqual([[0, 3]]);
  });

  it("reports nothing for a chapter with nothing to gather", async () => {
    const chapterId = await chapterWith([null, null]);
    const { calls, onStep } = recorder();
    await gatherChapterPcm(chapterId, testCodec(), undefined, onStep);
    expect(calls).toEqual([]);
  });
});

describe("exportChapterMp3 — threads the segment steps (#986)", () => {
  it("passes onStep to the gather; the encode runs after the last step", async () => {
    const chapterId = await chapterWith([
      { n: 100, v: 1 },
      { n: 100, v: 2 },
    ]);
    const codec = testCodec();
    const order: string[] = [];
    codec.encodeMp3.mockImplementation(async () => {
      order.push("encode");
      return new Uint8Array(1);
    });

    const result = await exportChapterMp3(chapterId, codec, undefined, (d, t) =>
      order.push(`${d}/${t}`)
    );

    expect(result).not.toBeNull();
    expect(order).toEqual(["0/2", "1/2", "2/2", "encode"]);
  });
});

describe("exportBookZip — chapter steps (#986)", () => {
  it("reports 0 of N first, then one step per chapter archived, ending at N of N", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [{ n: 100, v: 2 }],
      [{ n: 100, v: 3 }],
    ]);
    const { calls, onStep } = recorder();

    await exportBookZip(bookId, nameChapter, testCodec(), undefined, onStep);

    expect(calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("a step lands only AFTER that chapter's export has finished", async () => {
    const bookId = await bookWith([[{ n: 100, v: 1 }], [{ n: 100, v: 2 }]]);
    const codec = testCodec();
    const order: string[] = [];
    // Each encode settles a macrotask after it starts, so a step fired once an
    // export has STARTED but before it is awaited lands ahead of "encoded" and
    // breaks the sequence below.
    codec.encodeMp3.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push("encoded");
      return new Uint8Array(1);
    });

    await exportBookZip(bookId, nameChapter, codec, undefined, (d, t) =>
      order.push(`${d}/${t}`)
    );

    expect(order).toEqual(["0/2", "encoded", "1/2", "encoded", "2/2"]);
  });

  it("a chapter with no audio is a finished step (counted missing), not a stall", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [null],
      [{ n: 100, v: 3 }],
    ]);
    const { calls, onStep } = recorder();

    const result = await exportBookZip(
      bookId,
      nameChapter,
      testCodec(),
      undefined,
      onStep
    );

    expect(result?.missing).toBe(1);
    expect(calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("a dangling chapter id is not in total — it never enters the walk", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [{ n: 100, v: 2 }],
      [{ n: 100, v: 3 }],
    ]);
    const second = (await resolveBookChapters(bookId)).chapters[1];
    const db = await getDb();
    await db.delete("chapters", second!.id);
    const { calls, onStep } = recorder();

    await exportBookZip(bookId, nameChapter, testCodec(), undefined, onStep);

    expect(calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("a failure mid-way stops the count where it was", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [{ n: 100, v: 2 }],
      [{ n: 100, v: 3 }],
    ]);
    const codec = testCodec();
    let encodes = 0;
    codec.encodeMp3.mockImplementation(async () => {
      if (++encodes === 2) throw new Error("encode failed");
      return new Uint8Array(1);
    });
    const { calls, onStep } = recorder();

    await expect(
      exportBookZip(bookId, nameChapter, codec, undefined, onStep)
    ).rejects.toThrow("encode failed");

    expect(calls).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });

  it("a cancel between chapters reports no step past the point it stopped", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [{ n: 100, v: 2 }],
      [{ n: 100, v: 3 }],
    ]);
    const { calls, onStep } = recorder();
    const shouldContinue = () => !calls.some(([done]) => done >= 1);

    const result = await exportBookZip(
      bookId,
      nameChapter,
      testCodec(),
      shouldContinue,
      onStep
    );

    expect(result).toBeNull();
    expect(calls).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });

  it("a cancel that lands during a chapter's encode reports no step for it", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [{ n: 100, v: 2 }],
      [{ n: 100, v: 3 }],
    ]);
    const codec = testCodec();
    let cancelled = false;
    // The first chapter's encode completes, but the cancel arrived while it
    // ran: every check before the encode has already passed.
    codec.encodeMp3.mockImplementation(async () => {
      cancelled = true;
      return new Uint8Array(1);
    });
    const { calls, onStep } = recorder();

    const result = await exportBookZip(
      bookId,
      nameChapter,
      codec,
      () => !cancelled,
      onStep
    );

    expect(result).toBeNull();
    expect(calls).toEqual([[0, 3]]);
  });

  it("reports chapters only — segment steps are not forwarded into each chapter", async () => {
    const bookId = await bookWith([
      [
        { n: 100, v: 1 },
        { n: 100, v: 2 },
      ],
    ]);
    const spy = vi.spyOn(chapterExport, "exportChapterMp3");
    const { calls, onStep } = recorder();

    await exportBookZip(bookId, nameChapter, testCodec(), undefined, onStep);
    const forwarded = spy.mock.calls.map((args) => args[3]);
    spy.mockRestore();

    expect(forwarded).toEqual([undefined]);
    expect(calls).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("reports nothing for a book with no chapters", async () => {
    const bookId = await bookWith([]);
    const { calls, onStep } = recorder();
    await exportBookZip(bookId, nameChapter, testCodec(), undefined, onStep);
    expect(calls).toEqual([]);
  });
});

describe("the export names its counted items by key (#1044)", () => {
  /** A chapter of recorded (`true`) and unrecorded segments, and its clip ids. */
  async function keyedChapter(recorded: boolean[]) {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    const clipIds: ClipId[] = [];
    for (const [i, has] of recorded.entries()) {
      const seg = await addSegment(chapter.id);
      if (!has) continue;
      const clipId = newClipId();
      await saveTake(
        seg.id,
        clipId,
        samples(100, i + 1),
        CANONICAL_SAMPLE_RATE
      );
      clipIds.push(clipId);
    }
    return { chapterId: chapter.id, clipIds };
  }

  function keyRecorder() {
    const keys: Array<readonly string[] | undefined> = [];
    const onStep: StepReporter = (_d, _t, _s, _i, k) => {
      keys.push(k);
    };
    return { keys, onStep };
  }

  it("Share Chapter: a segment with no resolvable audio is not among the keys", async () => {
    const { chapterId, clipIds } = await keyedChapter([true, false, true]);
    const { keys, onStep } = keyRecorder();

    await gatherChapterPcm(chapterId, testCodec(), undefined, onStep);

    expect(keys).toHaveLength(3);
    for (const k of keys) expect(k).toEqual(clipIds);
  });

  it("Share Chapter: a clip pass 1 finds no metadata for is not among the keys", async () => {
    const { chapterId, clipIds } = await keyedChapter([true, true, true]);
    const real = clips.getClipMeta.bind(clips);
    const spy = vi
      .spyOn(clips, "getClipMeta")
      .mockImplementation((id) =>
        id === clipIds[1] ? Promise.resolve(undefined) : real(id)
      );
    const { keys, onStep } = keyRecorder();

    await gatherChapterPcm(chapterId, testCodec(), undefined, onStep);
    spy.mockRestore();

    expect(keys).toHaveLength(3);
    for (const k of keys) expect(k).toEqual([clipIds[0], clipIds[2]]);
  });

  it("Share Book: a dangling chapter id is not among the keys", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 1 }],
      [{ n: 100, v: 2 }],
      [{ n: 100, v: 3 }],
    ]);
    const chapters = (await resolveBookChapters(bookId)).chapters;
    const db = await getDb();
    await db.delete("chapters", chapters[1]!.id);
    const { keys, onStep } = keyRecorder();

    await exportBookZip(bookId, nameChapter, testCodec(), undefined, onStep);

    expect(keys).toHaveLength(3);
    for (const k of keys) expect(k).toEqual([chapters[0]!.id, chapters[2]!.id]);
  });
});
