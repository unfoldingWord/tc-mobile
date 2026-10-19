import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  exportBookZip,
  exportLibraryZip,
  memoryArchiveSink,
} from "@/lib/export/book";
import {
  addChapter,
  addSegment,
  createBook,
  renameChapter,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import { strings } from "@/lib/strings";
import type { BookId } from "@/types/domain";
import { clearAllStores, testCodec } from "./support";

/**
 * #1218: the MP3s inside a book's zip carry the chapter name the translator
 * gave the chapter, made filename-safe, and fall back to the default
 * "Chapter N" only when the chapter has no name. #1233 (R18, the requirements
 * owner: "Use the number and name"): the chapter's number comes first,
 * zero-padded to two digits, so the files sort in chapter order. Share your
 * work (#987) lays each book folder out exactly as Share Book does, so it is
 * held to the same rule here.
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

/**
 * A book whose chapters each hold one recorded segment, named as given, and
 * numbered as given when `numbers` is passed (the store's next number
 * otherwise).
 */
async function bookNamed(
  book: string,
  chapterNames: ReadonlyArray<string | null>,
  numbers?: ReadonlyArray<number>
): Promise<BookId> {
  const created = await createBook(book);
  for (const [i, name] of chapterNames.entries()) {
    const chapter = await addChapter(created.id, numbers?.[i]);
    if (name !== null) await renameChapter(chapter.id, name);
    const seg = await addSegment(chapter.id);
    await saveTake(
      seg.id,
      newClipId(),
      Int16Array.from({ length: CANONICAL_SAMPLE_RATE }, () => 100 * (i + 1)),
      CANONICAL_SAMPLE_RATE
    );
  }
  return created.id;
}

beforeEach(clearAllStores);

describe("strings.shareFilename (#1218, #1233)", () => {
  it("names the MP3 after the chapter's number and own name when it has one", () => {
    expect(strings.shareFilename("Mark", 6, "The sower")).toBe(
      "Mark - 06 The sower.mp3"
    );
  });

  it("falls back to the default chapter name when the chapter has none", () => {
    expect(strings.shareFilename("Mark", 3, null)).toBe(
      `Mark - 03 ${strings.chapterName(3)}.mp3`
    );
  });

  it("pads the number to two digits and no further (#1233)", () => {
    expect(strings.shareFilename("Jonah", 3, "Jonah runs")).toBe(
      "Jonah - 03 Jonah runs.mp3"
    );
    expect(strings.shareFilename("Mark", 12, "Twelve")).toBe(
      "Mark - 12 Twelve.mp3"
    );
    expect(strings.shareFilename("Psalms", 119, "Aleph")).toBe(
      "Psalms - 119 Aleph.mp3"
    );
  });

  it("sorts a book's files in chapter order, named or not (#1233)", () => {
    const names: ReadonlyArray<string | null> = [
      "Zion",
      null,
      "Amen",
      "Mercy",
      null,
      "Bread",
      "Ark",
      null,
      "Yes",
      "Dawn",
      "Cross",
      "Bethel",
    ];
    const files = names.map((name, i) =>
      strings.shareFilename("Mark", i + 1, name)
    );
    expect([...files].sort()).toEqual(files);
  });

  it("pads to the width of the book's highest chapter number (#1233)", () => {
    // Coordinator decision on #1516: a 150-chapter book needs three digits, or
    // a plain-text sort puts "100" before "11".
    expect(strings.shareFilename("Psalms", 3, "Aleph", 150)).toBe(
      "Psalms - 003 Aleph.mp3"
    );
    expect(strings.shareFilename("Psalms", 150, null, 150)).toBe(
      `Psalms - 150 ${strings.chapterName(150)}.mp3`
    );
    // Under 100 chapters the width stays two, as in the owner's example.
    expect(strings.shareFilename("Jonah", 3, "Jonah runs", 4)).toBe(
      "Jonah - 03 Jonah runs.mp3"
    );
  });

  it("sorts a 150-chapter book's files in chapter order (#1233)", () => {
    const files = Array.from({ length: 150 }, (_, i) =>
      strings.shareFilename("Psalms", i + 1, i % 3 === 0 ? null : "Song", 150)
    );
    expect([...files].sort()).toEqual(files);
  });

  it("makes the chapter name filename-safe", () => {
    // "2:1-4" is a real passage label a tester typed; `:` is illegal in a
    // filename on common filesystems and `/` would open a folder in a zip.
    expect(strings.shareFilename("Mark", 2, "2:1-4 / end")).toBe(
      "Mark - 02 2 1-4 end.mp3"
    );
  });

  it("routes the fallback label through filenameSafe too (#1233 item 23)", () => {
    // The default is app copy and safe today; this pins that a future edit to
    // it (a `/` or `:` in the wording) still cannot reach a filename.
    const spy = vi
      .spyOn(strings, "chapterName")
      .mockImplementation((n) => `Ch/${n}: x`);
    try {
      expect(strings.shareFilename("Mark", 4, null)).toBe(
        "Mark - 04 Ch 4 x.mp3"
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the default when nothing of the name survives sanitising", () => {
    expect(strings.shareFilename("Mark", 4, ":/?")).toBe(
      `Mark - 04 ${strings.chapterName(4)}.mp3`
    );
  });
});

describe("the chapter name reaches the zip entry (#1218)", () => {
  it("Share Book names each MP3 from the book and the chapter's number and name", async () => {
    const bookId = await bookNamed("Mark", ["The sower", null, "99"]);
    const sink = memoryArchiveSink();
    const result = await exportBookZip(
      bookId,
      (n, name) => strings.shareFilename("Mark", n, name),
      testCodec(),
      sink
    );
    expect(result).not.toBeNull();
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark - 01 The sower.mp3",
      `Mark - 02 ${strings.chapterName(2)}.mp3`,
      "Mark - 03 99.mp3",
    ]);
  });

  it("pads every file in a book to its highest chapter number's width", async () => {
    const bookId = await bookNamed(
      "Psalms",
      ["Aleph", null, "Last"],
      [1, 2, 100]
    );
    const sink = memoryArchiveSink();
    await exportBookZip(
      bookId,
      (n, name, highest) => strings.shareFilename("Psalms", n, name, highest),
      testCodec(),
      sink
    );
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Psalms - 001 Aleph.mp3",
      `Psalms - 002 ${strings.chapterName(2)}.mp3`,
      "Psalms - 100 Last.mp3",
    ]);
  });

  it("tells two chapters that share a name apart by their numbers", async () => {
    const bookId = await bookNamed("Mark", ["Intro", "Intro"]);
    const sink = memoryArchiveSink();
    await exportBookZip(
      bookId,
      (n, name) => strings.shareFilename("Mark", n, name),
      testCodec(),
      sink
    );
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark - 01 Intro.mp3",
      "Mark - 02 Intro.mp3",
    ]);
  });

  it("keeps both chapters' audio when two chapters share a number and a name", async () => {
    // `addChapter` permits an explicit duplicate number, so the number alone
    // cannot always keep two files apart.
    const bookId = await bookNamed("Mark", ["Intro", "Intro"], [1, 1]);
    const sink = memoryArchiveSink();
    await exportBookZip(
      bookId,
      (n, name) => strings.shareFilename("Mark", n, name),
      testCodec(),
      sink
    );
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark - 01 Intro.mp3",
      "Mark - 01 Intro (2).mp3",
    ]);
  });

  it("keeps both chapters' audio when two names differ only in case", async () => {
    // Case-insensitive filesystems (iOS Files, Windows, macOS) would extract
    // these onto one path, so the zip must already keep them apart. The
    // numbers repeat on purpose, so only the names could tell the files apart.
    const bookId = await bookNamed(
      "Mark",
      ["Intro", "intro", null, "chapter 3"],
      [1, 1, 3, 3]
    );
    const sink = memoryArchiveSink();
    await exportBookZip(
      bookId,
      (n, name) => strings.shareFilename("Mark", n, name),
      testCodec(),
      sink
    );
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark - 01 Intro.mp3",
      "Mark - 01 intro (2).mp3",
      `Mark - 03 ${strings.chapterName(3)}.mp3`,
      "Mark - 03 chapter 3 (2).mp3",
    ]);
  });

  it("Share your work names each book folder's MP3s the same way", async () => {
    await bookNamed("Mark", ["The sower", null]);
    const sink = memoryArchiveSink();
    const result = await exportLibraryZip(
      (book) => book.name ?? "",
      (book, n, name) => strings.shareFilename(book.name ?? "", n, name),
      testCodec(),
      sink
    );
    expect(result).not.toBeNull();
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark/Mark - 01 The sower.mp3",
      `Mark/Mark - 02 ${strings.chapterName(2)}.mp3`,
    ]);
  });
});
