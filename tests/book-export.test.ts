import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { exportBookZip } from "@/lib/export/book";
import * as chapterExport from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  resolveBookChapters,
  saveTake,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import type { BookId } from "@/types/domain";
import { clearAllStores, testCodec } from "./support";

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A per-chapter zip-entry name, so a test can assert what landed where. */
const nameChapter = (n: number): string => `Chapter ${n}.mp3`;

/**
 * The archive as one buffer, the way `new File(chunks)` sees it. The export
 * hands back fflate's stream chunks (B8: the archive is never concatenated in
 * app code); a test reads it back by joining them, exactly once, here.
 */
function archive(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

beforeEach(clearAllStores);

/**
 * A book of chapters, each a list of segment specs: `{ n, v }` records `n`
 * frames all equal to `v`, `null` is a never-recorded segment. A chapter given
 * `[]` has no segments at all. The constant value per segment is what lets the
 * per-chapter MP3 be matched back to the chapter it came from.
 */
async function bookWith(
  chapters: Array<Array<{ n: number; v: number } | null>>
): Promise<BookId> {
  const book = await createBook("b");
  for (const specs of chapters) {
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
  }
  return book.id;
}

describe("resolveBookChapters", () => {
  it("returns a book's chapters in declared order, missing 0", async () => {
    const bookId = await bookWith([[], [], []]);
    const { chapters, missing } = await resolveBookChapters(bookId);
    expect(chapters.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(missing).toBe(0);
  });

  it("drops a dangling chapter id from the list but counts it missing", async () => {
    const bookId = await bookWith([[], [], []]);
    // Erase the middle chapter's record while its id stays in book.chapterIds —
    // the dangling case: dropped from the list, but not from the count.
    const second = (await resolveBookChapters(bookId)).chapters[1];
    expect(second).toBeDefined();
    const db = await getDb();
    await db.delete("chapters", second!.id);

    const { chapters, missing } = await resolveBookChapters(bookId);
    expect(chapters.map((c) => c.number)).toEqual([1, 3]);
    expect(missing).toBe(1);
  });

  it("returns empty for an unknown book", async () => {
    expect(await resolveBookChapters("nope" as BookId)).toEqual({
      chapters: [],
      missing: 0,
    });
  });
});

describe("exportBookZip", () => {
  it("archives each recorded chapter as its own MP3, named and ordered", async () => {
    const bookId = await bookWith([
      [{ n: CANONICAL_SAMPLE_RATE, v: 1000 }],
      [{ n: CANONICAL_SAMPLE_RATE, v: -1000 }],
    ]);
    const codec = testCodec();
    const result = await exportBookZip(bookId, nameChapter, codec);

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    expect(result!.missing).toBe(0);

    const entries = unzipSync(archive(result!.chunks));
    // One entry per chapter, named by nameChapter(number), in chapter order.
    expect(Object.keys(entries)).toEqual(["Chapter 1.mp3", "Chapter 2.mp3"]);

    // Each entry is exactly that chapter's own MP3 — proves the right chapter's
    // audio landed under the right name, not merely that two files exist.
    const { chapters } = await resolveBookChapters(bookId);
    for (const chapter of chapters) {
      const solo = await chapterExport.exportChapterMp3(chapter.id, codec);
      expect(entries[nameChapter(chapter.number)]).toEqual(solo!.mp3);
    }
  });

  it("passes each chapter's MP3 buffer into the archive rather than copying it", async () => {
    // The memory point of the streamed archive (B8, #34): a stored entry's data
    // chunk IS the encoded buffer. If fflate (or a future edit) copied it, the
    // archive would again hold every MP3 twice on a low-end phone.
    const bookId = await bookWith([[{ n: CANONICAL_SAMPLE_RATE, v: 1000 }]]);
    const codec = testCodec();
    const result = await exportBookZip(bookId, nameChapter, codec);
    const mp3 = await codec.encodeMp3.mock.results[0]!.value;

    expect(result!.chunks.some((c) => c.buffer === mp3.buffer)).toBe(true);
  });

  it("skips a chapter with no audio and counts it missing", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 100 }],
      [null], // a segment, never recorded → no resolvable audio
      [], // no segments at all
      [{ n: 100, v: 200 }],
    ]);
    const result = await exportBookZip(bookId, nameChapter, testCodec());

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    expect(result!.missing).toBe(2);
    // Only the two recorded chapters are in the zip; the empty ones are absent.
    expect(Object.keys(unzipSync(archive(result!.chunks)))).toEqual([
      "Chapter 1.mp3",
      "Chapter 4.mp3",
    ]);
  });

  it("counts a dangling chapter id in missing rather than sharing a book with a hole", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 100 }],
      [{ n: 100, v: 150 }],
      [{ n: 100, v: 200 }],
    ]);
    // Erase the middle chapter record; its id stays in book.chapterIds.
    const mid = (await resolveBookChapters(bookId)).chapters[1];
    const db = await getDb();
    await db.delete("chapters", mid!.id);

    const result = await exportBookZip(bookId, nameChapter, testCodec());

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    expect(result!.missing).toBe(1); // the dangling chapter — silently 0 before the fix
    expect(Object.keys(unzipSync(archive(result!.chunks)))).toEqual([
      "Chapter 1.mp3",
      "Chapter 3.mp3",
    ]);
  });

  it("keeps both chapters' audio when their numbers collide, under distinct names", async () => {
    // addChapter permits an explicit duplicate number, so nameChapter can map two
    // chapters to the same path. Both recordings must survive under distinct
    // entries — two entries at one path is an ambiguous archive.
    const book = await createBook("b");
    const c1 = await addChapter(book.id, 1);
    const c2 = await addChapter(book.id, 1); // same number, on purpose
    const s1 = await addSegment(c1.id);
    await saveTake(
      s1.id,
      newClipId(),
      samples(CANONICAL_SAMPLE_RATE, 1000),
      CANONICAL_SAMPLE_RATE
    );
    const s2 = await addSegment(c2.id);
    await saveTake(
      s2.id,
      newClipId(),
      samples(CANONICAL_SAMPLE_RATE * 2, 800), // a different length → different bytes
      CANONICAL_SAMPLE_RATE
    );

    const result = await exportBookZip(book.id, nameChapter, testCodec());

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    const entries = unzipSync(archive(result!.chunks));
    // Two distinct entries — the collision was renamed, not overwritten.
    expect(Object.keys(entries)).toEqual([
      "Chapter 1.mp3",
      "Chapter 1 (2).mp3",
    ]);
    expect(entries["Chapter 1.mp3"]!.length).toBeGreaterThan(0);
    expect(entries["Chapter 1 (2).mp3"]!.length).toBeGreaterThan(0);
    expect(entries["Chapter 1.mp3"]).not.toEqual(entries["Chapter 1 (2).mp3"]);
  });

  it("rolls up missing segments from chapters that DID make it into the zip (#116)", async () => {
    // Three chapters, each with one recorded segment and one never-recorded
    // segment — every chapter has resolvable audio (so `missing` for whole
    // chapters stays 0), but each one is itself partial. Before the roll-up,
    // each chapter's own `result.missing` was read and discarded here, so a
    // book with this exact hole reported `missing === 0` and surfaced no
    // Notice at all, while Share Chapter of any one of these chapters would
    // say "1 segment could not be included."
    const bookId = await bookWith([
      [{ n: 100, v: 100 }, null],
      [{ n: 100, v: 150 }, null],
      [{ n: 100, v: 200 }, null],
    ]);
    const result = await exportBookZip(bookId, nameChapter, testCodec());

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(3);
    expect(result!.missing).toBe(0); // no whole chapter was left out
    expect(result!.partialSegments).toBe(3); // one gap per chapter, summed
  });

  it("sums BOTH gaps from a single partial chapter, not one per chapter (#400)", async () => {
    // George (#398 round 1 P3, #400): the earlier tests above happen to have
    // exactly one missing segment per partial chapter, so they cannot tell
    // "sum of missing segments" (the actual contract) apart from "count of
    // partial chapters" — a regression to the wrong grain would still pass
    // them. One chapter, two never-recorded segments: `partialSegments` must
    // read 2, not 1.
    const bookId = await bookWith([
      [{ n: 100, v: 100 }, null, null], // one chapter, TWO never-recorded segments
    ]);
    const result = await exportBookZip(bookId, nameChapter, testCodec());

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(1); // the chapter ships — it has resolvable audio
    expect(result!.missing).toBe(0); // no whole chapter was left out
    expect(result!.partialSegments).toBe(2); // both gaps, from the ONE chapter
  });

  it("counts a whole missing chapter toward `missing` and a partial one toward `partialSegments`, not both", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 100 }, null], // included, but partial: 1 segment missing
      [null], // no resolvable audio at all: a whole chapter left out
      [{ n: 100, v: 200 }], // included, fully present
    ]);
    const result = await exportBookZip(bookId, nameChapter, testCodec());

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2); // chapters 1 and 3 shipped
    expect(result!.missing).toBe(1); // chapter 2 had no audio at all
    expect(result!.partialSegments).toBe(1); // chapter 1's own gap only
  });

  it("returns null when no chapter has any audio", async () => {
    const bookId = await bookWith([[null], []]);
    expect(await exportBookZip(bookId, nameChapter, testCodec())).toBeNull();
  });

  it("returns null for a book with no chapters", async () => {
    const book = await createBook("empty");
    expect(await exportBookZip(book.id, nameChapter, testCodec())).toBeNull();
  });

  it("stops before touching any chapter when cancelled up front", async () => {
    // A share dismissed before the first chapter must not pay for a single
    // chapter's gather OR encode — the between-chapters guard, not chapter's own
    // shouldEncode. Spying on exportChapterMp3 (not the encoder) is what bites
    // the book-level short-circuit: the encoder stays uncalled even without it,
    // because chapter's internal guard would skip the encode anyway.
    const bookId = await bookWith([[{ n: 100, v: 100 }], [{ n: 100, v: 200 }]]);
    const chapterSpy = vi.spyOn(chapterExport, "exportChapterMp3");
    const codec = testCodec();

    const result = await exportBookZip(bookId, nameChapter, codec, () => false);

    expect(result).toBeNull();
    expect(chapterSpy).not.toHaveBeenCalled();
    expect(codec.encodeMp3).not.toHaveBeenCalled();
    chapterSpy.mockRestore();
  });

  it("stops before the NEXT chapter once cancelled mid-book", async () => {
    // The between-chapters guard specifically: a cancel that arrives AFTER
    // chapter 1 encodes must skip chapter 2 entirely — chapter 2's own
    // shouldEncode would skip only its encode, still paying for its gather. Flip
    // the seam false the moment chapter 1 finishes, then assert exportChapterMp3
    // was never entered for chapter 2 (George R-B7-book R2). Dropping the in-loop
    // guard would call it twice, so the call count is what bites the regression.
    const bookId = await bookWith([[{ n: 100, v: 100 }], [{ n: 100, v: 200 }]]);
    const real = chapterExport.exportChapterMp3;
    let firstDone = false;
    const chapterSpy = vi
      .spyOn(chapterExport, "exportChapterMp3")
      .mockImplementation(async (id, codec, cont) => {
        const r = await real(id, codec, cont);
        firstDone = true; // chapter 1 fully gathered + encoded
        return r;
      });
    const codec = testCodec();
    const shouldContinue = () => !firstDone;

    const result = await exportBookZip(
      bookId,
      nameChapter,
      codec,
      shouldContinue
    );

    expect(result).toBeNull(); // cancelled → whole book abandoned
    expect(chapterSpy).toHaveBeenCalledTimes(1); // chapter 2 never entered
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1); // only chapter 1 encoded
    chapterSpy.mockRestore();
  });
});
