import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  estimateLibraryZipBytes,
  exportBookZip,
  exportLibraryZip,
  roomForExport,
} from "@/lib/export/book";
import * as chapterExport from "@/lib/export/chapter";
import * as booksStore from "@/lib/storage/books";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import { strings } from "@/lib/strings";
import type { BookId } from "@/types/domain";
import { clearAllStores, testCodec } from "./support";

/**
 * #987: "Share your work" — every book in one zip, one folder per book, each
 * folder laid out exactly as Share Book (`exportBookZip`) lays out that book.
 *
 * The folder and entry names are injected by the caller (translator-facing
 * copy). Entries use `strings.shareFilename`, the namer Share Book passes
 * today, so "the same layout" is asserted against the real call shape. The
 * folder namer is the raw book name, so the export's own path-safety is what
 * the sanitising test below exercises.
 */
const nameBook = (bookName: string): string => bookName;
const nameChapter = (bookName: string, n: number): string =>
  strings.shareFilename(bookName, n);

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

function archive(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Same fixture shape as `book-export.test.ts`'s `bookWith`, with a name. */
async function bookWith(
  name: string,
  chapters: Array<Array<{ n: number; v: number } | null>>
): Promise<BookId> {
  const book = await createBook(name);
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

beforeEach(clearAllStores);

describe("exportLibraryZip", () => {
  it("puts each book in its own folder, laid out byte-for-byte as Share Book lays it out", async () => {
    const mark = await bookWith("Mark", [
      [{ n: CANONICAL_SAMPLE_RATE, v: 1000 }],
      [{ n: CANONICAL_SAMPLE_RATE, v: -1000 }],
    ]);
    const luke = await bookWith("Luke", [
      [{ n: CANONICAL_SAMPLE_RATE, v: 500 }],
    ]);

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    expect(result).not.toBeNull();
    expect(result!.books).toBe(2);
    expect(result!.missing).toBe(0);
    const entries = unzipSync(archive(result!.chunks));

    // The book loop must reach BOTH books — a loop that stops after the first
    // (or only ever reads one) leaves a folder out and fails here.
    expect(Object.keys(entries).sort()).toEqual([
      "Luke/Luke - Chapter 1.mp3",
      "Mark/Mark - Chapter 1.mp3",
      "Mark/Mark - Chapter 2.mp3",
    ]);

    for (const [bookId, name] of [
      [mark, "Mark"],
      [luke, "Luke"],
    ] as const) {
      const solo = await exportBookZip(
        bookId,
        (n) => nameChapter(name, n),
        testCodec()
      );
      const soloEntries = unzipSync(archive(solo!.chunks));
      const folder = Object.fromEntries(
        Object.entries(entries)
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, bytes]) => [path.slice(name.length + 1), bytes])
      );
      expect(folder).toEqual(soloEntries);
    }
  });

  it("is a clean no-op for an empty library: null, and no encode", async () => {
    const codec = testCodec();
    expect(await exportLibraryZip(nameBook, nameChapter, codec)).toBeNull();
    expect(codec.encodeMp3).not.toHaveBeenCalled();
  });

  it("returns null when no book has any audio", async () => {
    await bookWith("A", [[null], []]);
    await bookWith("B", []);
    expect(
      await exportLibraryZip(nameBook, nameChapter, testCodec())
    ).toBeNull();
  });

  it("leaves a book with no audio out, counts it missing, and still ships the books either side of it", async () => {
    // A strictly increasing clock pins shelf order (`listBooks` sorts by
    // `updatedAt`, newest first): Later, Empty, Earlier. The empty book sits
    // BETWEEN two full ones, so a loop that stops at it loses "Earlier".
    let t = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (t += 10));
    await bookWith("Earlier", [[{ n: 100, v: 100 }]]);
    await bookWith("Empty", [[null]]);
    await bookWith("Later", [[{ n: 100, v: 200 }]]);
    clock.mockRestore();

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    expect(result).not.toBeNull();
    expect(result!.books).toBe(2);
    expect(result!.missing).toBe(1);
    expect(Object.keys(unzipSync(archive(result!.chunks)))).toEqual([
      "Later/Later - Chapter 1.mp3",
      "Earlier/Earlier - Chapter 1.mp3",
    ]);
  });

  it("rolls up incomplete chapters, and the books holding them, across the whole library", async () => {
    // A: one chapter with a segment gap, one chapter left out entirely → 2
    // incomplete chapters in one book. B: whole. C: one gapped chapter.
    await bookWith("A", [
      [{ n: 100, v: 100 }, null],
      [null],
      [{ n: 100, v: 1 }],
    ]);
    await bookWith("B", [[{ n: 100, v: 200 }]]);
    await bookWith("C", [[{ n: 100, v: 300 }, null, null]]);

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    expect(result).not.toBeNull();
    expect(result!.books).toBe(3);
    expect(result!.missing).toBe(0);
    expect(result!.incompleteChapters).toBe(3);
    expect(result!.incompleteBooks).toBe(2);
  });

  it("reports no gap for a library whose included books are whole", async () => {
    await bookWith("A", [[{ n: 100, v: 100 }]]);
    await bookWith("B", [[{ n: 100, v: 200 }], [{ n: 100, v: 250 }]]);
    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    expect(result!.incompleteChapters).toBe(0);
    expect(result!.incompleteBooks).toBe(0);
  });

  it("keeps two same-named books apart under distinct folders", async () => {
    await bookWith("Mark", [[{ n: 100, v: 100 }]]);
    await bookWith("Mark", [[{ n: 200, v: 200 }]]);
    await bookWith("1.John", [[{ n: 100, v: 300 }]]);
    await bookWith("1.John", [[{ n: 100, v: 400 }]]);

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    const folders = Object.keys(unzipSync(archive(result!.chunks)))
      .map((path) => path.slice(0, path.indexOf("/")))
      .sort();
    // A folder has no extension: "1.John" disambiguates as "1.John (2)", not
    // "1 (2).John".
    expect(folders).toEqual(["1.John", "1.John (2)", "Mark", "Mark (2)"]);
  });

  it("keeps books whose names differ only in case apart too, since the phone's filesystem may not", async () => {
    // iOS Files (APFS default), Windows and macOS extract case-insensitively,
    // so "Mark/" and "mark/" would merge and one book's chapters clobber the
    // other's.
    await bookWith("Mark", [[{ n: 100, v: 100 }]]);
    await bookWith("mark", [[{ n: 100, v: 200 }]]);

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    const folders = Object.keys(unzipSync(archive(result!.chunks))).map(
      (path) => path.slice(0, path.indexOf("/")).toLowerCase()
    );
    expect(folders).toHaveLength(2);
    expect(new Set(folders).size).toBe(2);
  });

  it("gives a book with no audio no folder, so its name stays free for a same-named sibling", async () => {
    // Shelf order is newest first: the empty "Mark" is reached BEFORE the
    // full one, so reserving its name would push the real audio to "Mark (2)".
    let t = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (t += 10));
    await bookWith("Mark", [[{ n: 100, v: 100 }]]);
    await bookWith("Mark", [[null]]);
    clock.mockRestore();

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    expect(result!.missing).toBe(1);
    expect(Object.keys(unzipSync(archive(result!.chunks)))).toEqual([
      "Mark/Mark - Chapter 1.mp3",
    ]);
  });

  it("counts a dangling chapter id among an included book's incomplete chapters", async () => {
    const bookId = await bookWith("A", [
      [{ n: 100, v: 100 }],
      [{ n: 100, v: 150 }],
      [{ n: 100, v: 200 }],
    ]);
    // Erase the middle chapter record; its id stays in book.chapterIds.
    const mid = (await booksStore.resolveBookChapters(bookId)).chapters[1];
    const db = await getDb();
    await db.delete("chapters", mid!.id);

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    expect(result!.books).toBe(1);
    expect(result!.incompleteChapters).toBe(1);
    expect(result!.incompleteBooks).toBe(1);
  });

  it("never lets a book name become a path: separators are sanitised, dot-only names fall back", async () => {
    await bookWith("Mark/Luke", [[{ n: 100, v: 100 }]]);
    await bookWith("..", [[{ n: 100, v: 200 }]]);

    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    const paths = Object.keys(unzipSync(archive(result!.chunks)));
    const folders = paths.map((p) => p.slice(0, p.indexOf("/")));
    expect(folders).toContain("Mark Luke");
    expect(folders).not.toContain("..");
    // Every entry sits exactly one folder deep.
    for (const p of paths) {
      expect(p.split("/")).toHaveLength(2);
      expect(p.startsWith("../")).toBe(false);
    }
  });

  it("rejects the whole call when a chapter fails on a later book — no archive comes back", async () => {
    await bookWith("A", [[{ n: 100, v: 100 }]]);
    await bookWith("B", [[{ n: 100, v: 200 }]]);
    const codec = testCodec();
    const real = codec.encodeMp3.getMockImplementation()!;
    codec.encodeMp3
      .mockImplementationOnce(real)
      .mockImplementationOnce(() => Promise.reject(new Error("encoder died")));

    await expect(
      exportLibraryZip(nameBook, nameChapter, codec)
    ).rejects.toThrow("encoder died");
    expect(codec.encodeMp3).toHaveBeenCalledTimes(2);
  });

  it("stops before the NEXT book once cancelled between books", async () => {
    await bookWith("A", [[{ n: 100, v: 100 }]]);
    await bookWith("B", [[{ n: 100, v: 200 }]]);
    const real = chapterExport.exportChapterMp3;
    let firstDone = false;
    const chapterSpy = vi
      .spyOn(chapterExport, "exportChapterMp3")
      .mockImplementation(async (id, codec, cont) => {
        const r = await real(id, codec, cont);
        firstDone = true;
        return r;
      });
    // The between-BOOKS guard specifically: each book's own chapter loop would
    // also stop before encoding, but only after reading the next book. The
    // resolve count is what tells the two apart.
    const resolveSpy = vi.spyOn(booksStore, "resolveBookChapters");
    const codec = testCodec();

    const result = await exportLibraryZip(
      nameBook,
      nameChapter,
      codec,
      () => !firstDone
    );

    expect(result).toBeNull();
    expect(chapterSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);
    chapterSpy.mockRestore();
    resolveSpy.mockRestore();
  });
});

describe("estimateLibraryZipBytes", () => {
  it("is 0 for an empty library and for a library with no audio", async () => {
    expect(await estimateLibraryZipBytes()).toBe(0);
    await bookWith("A", [[null], []]);
    expect(await estimateLibraryZipBytes()).toBe(0);
  });

  it("is never below the archive it predicts, and not wildly above it", async () => {
    // Five seconds per segment, so the MP3 payload — not the fixed per-entry
    // allowance — dominates, as it does on a real library.
    const fiveSeconds = 5 * CANONICAL_SAMPLE_RATE;
    await bookWith("A", [
      [
        { n: fiveSeconds, v: 1000 },
        { n: fiveSeconds, v: -1000 },
      ],
      [{ n: fiveSeconds, v: 300 }, null],
    ]);
    await bookWith("B", [[{ n: fiveSeconds, v: 700 }]]);

    const estimate = await estimateLibraryZipBytes();
    const result = await exportLibraryZip(nameBook, nameChapter, testCodec());
    const actual = archive(result!.chunks).length;

    expect(estimate).not.toBeNull();
    expect(estimate!).toBeGreaterThanOrEqual(actual);
    // An estimate sized from PCM (~11x) would refuse shares that fit.
    expect(estimate!).toBeLessThan(actual * 1.5);
  });

  it("returns null once cancelled", async () => {
    await bookWith("A", [[{ n: 100, v: 100 }]]);
    expect(await estimateLibraryZipBytes(() => false)).toBeNull();
  });
});

describe("roomForExport", () => {
  const MB = 1024 * 1024;

  it("is unknown when the browser gave no usable figures", () => {
    expect(roomForExport(undefined, 100 * MB, MB)).toBe("unknown");
    expect(roomForExport(10 * MB, undefined, MB)).toBe("unknown");
    expect(roomForExport(0, 0, MB)).toBe("unknown");
    expect(roomForExport(Number.NaN, 100 * MB, MB)).toBe("unknown");
    expect(roomForExport(-1, 100 * MB, MB)).toBe("unknown");
    expect(roomForExport(0, Number.POSITIVE_INFINITY, MB)).toBe("unknown");
  });

  it("wants twice the archive free: room at exactly that, short one byte under", () => {
    // 100 MB quota, 80 MB used → 20 MB free; a 10 MB archive needs 20 MB.
    expect(roomForExport(80 * MB, 100 * MB, 10 * MB)).toBe("room");
    expect(roomForExport(80 * MB + 1, 100 * MB, 10 * MB)).toBe("short");
    expect(roomForExport(10 * MB, 100 * MB, 10 * MB)).toBe("room");
  });

  it("is short when usage already exceeds the quota", () => {
    expect(roomForExport(120 * MB, 100 * MB, 1)).toBe("short");
  });
});
