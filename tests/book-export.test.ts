import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import * as mp3 from "@/lib/audio/mp3";
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
import { closeDb, getDb } from "@/lib/storage/db";
import type { BookId } from "@/types/domain";

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A per-chapter zip-entry name, so a test can assert what landed where. */
const nameChapter = (n: number): string => `Chapter ${n}.mp3`;

beforeEach(async () => {
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

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
    const result = await exportBookZip(bookId, nameChapter);

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    expect(result!.missing).toBe(0);

    const entries = unzipSync(result!.zip);
    // One entry per chapter, named by nameChapter(number), in chapter order.
    expect(Object.keys(entries)).toEqual(["Chapter 1.mp3", "Chapter 2.mp3"]);

    // Each entry is exactly that chapter's own MP3 — proves the right chapter's
    // audio landed under the right name, not merely that two files exist.
    const { chapters } = await resolveBookChapters(bookId);
    for (const chapter of chapters) {
      const solo = await chapterExport.exportChapterMp3(chapter.id);
      expect(entries[nameChapter(chapter.number)]).toEqual(solo!.mp3);
    }
  });

  it("skips a chapter with no audio and counts it missing", async () => {
    const bookId = await bookWith([
      [{ n: 100, v: 100 }],
      [null], // a segment, never recorded → no resolvable audio
      [], // no segments at all
      [{ n: 100, v: 200 }],
    ]);
    const result = await exportBookZip(bookId, nameChapter);

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    expect(result!.missing).toBe(2);
    // Only the two recorded chapters are in the zip; the empty ones are absent.
    expect(Object.keys(unzipSync(result!.zip))).toEqual([
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

    const result = await exportBookZip(bookId, nameChapter);

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    expect(result!.missing).toBe(1); // the dangling chapter — silently 0 before the fix
    expect(Object.keys(unzipSync(result!.zip))).toEqual([
      "Chapter 1.mp3",
      "Chapter 3.mp3",
    ]);
  });

  it("keeps both chapters' audio when their numbers collide, under distinct names", async () => {
    // addChapter permits an explicit duplicate number, so nameChapter can map two
    // chapters to the same path. Both recordings must survive — a zip key is an
    // object key, and a second write to it silently drops the first while `chapters`
    // still counts two.
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

    const result = await exportBookZip(book.id, nameChapter);

    expect(result).not.toBeNull();
    expect(result!.chapters).toBe(2);
    const entries = unzipSync(result!.zip);
    // Two distinct entries — the collision was renamed, not overwritten.
    expect(Object.keys(entries)).toEqual([
      "Chapter 1.mp3",
      "Chapter 1 (2).mp3",
    ]);
    expect(entries["Chapter 1.mp3"]!.length).toBeGreaterThan(0);
    expect(entries["Chapter 1 (2).mp3"]!.length).toBeGreaterThan(0);
    expect(entries["Chapter 1.mp3"]).not.toEqual(entries["Chapter 1 (2).mp3"]);
  });

  it("returns null when no chapter has any audio", async () => {
    const bookId = await bookWith([[null], []]);
    expect(await exportBookZip(bookId, nameChapter)).toBeNull();
  });

  it("returns null for a book with no chapters", async () => {
    const book = await createBook("empty");
    expect(await exportBookZip(book.id, nameChapter)).toBeNull();
  });

  it("stops before touching any chapter when cancelled up front", async () => {
    // A share dismissed before the first chapter must not pay for a single
    // chapter's gather OR encode — the between-chapters guard, not chapter's own
    // shouldEncode. Spying on exportChapterMp3 (not encodeMp3) is what bites the
    // book-level short-circuit: encodeMp3 stays uncalled even without it, because
    // chapter's internal guard would skip the encode anyway.
    const bookId = await bookWith([[{ n: 100, v: 100 }], [{ n: 100, v: 200 }]]);
    const chapterSpy = vi.spyOn(chapterExport, "exportChapterMp3");
    const encodeSpy = vi.spyOn(mp3, "encodeMp3");

    const result = await exportBookZip(bookId, nameChapter, {}, () => false);

    expect(result).toBeNull();
    expect(chapterSpy).not.toHaveBeenCalled();
    expect(encodeSpy).not.toHaveBeenCalled();
    chapterSpy.mockRestore();
    encodeSpy.mockRestore();
  });
});
