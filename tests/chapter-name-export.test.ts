import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";

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
 * "Chapter N" only when the chapter has no name. Share your work (#987) lays
 * each book folder out exactly as Share Book does, so it is held to the same
 * rule here.
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

/** A book whose chapters each hold one recorded segment, named as given. */
async function bookNamed(
  book: string,
  chapterNames: ReadonlyArray<string | null>
): Promise<BookId> {
  const created = await createBook(book);
  for (const [i, name] of chapterNames.entries()) {
    const chapter = await addChapter(created.id);
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

describe("strings.shareFilename (#1218)", () => {
  it("names the MP3 after the chapter's own name when it has one", () => {
    expect(strings.shareFilename("Mark", 6, "The sower")).toBe(
      "Mark - The sower.mp3"
    );
  });

  it("falls back to the default chapter name when the chapter has none", () => {
    expect(strings.shareFilename("Mark", 3, null)).toBe(
      `Mark - ${strings.chapterName(3)}.mp3`
    );
  });

  it("makes the chapter name filename-safe", () => {
    // "2:1-4" is a real passage label a tester typed; `:` is illegal in a
    // filename on common filesystems and `/` would open a folder in a zip.
    expect(strings.shareFilename("Mark", 2, "2:1-4 / end")).toBe(
      "Mark - 2 1-4 end.mp3"
    );
  });

  it("falls back to the default when nothing of the name survives sanitising", () => {
    expect(strings.shareFilename("Mark", 4, ":/?")).toBe(
      `Mark - ${strings.chapterName(4)}.mp3`
    );
  });
});

describe("the chapter name reaches the zip entry (#1218)", () => {
  it("Share Book names each MP3 from the book and the chapter's own name", async () => {
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
      "Mark - The sower.mp3",
      `Mark - ${strings.chapterName(2)}.mp3`,
      "Mark - 99.mp3",
    ]);
  });

  it("keeps both chapters' audio when two chapters share a name", async () => {
    const bookId = await bookNamed("Mark", ["Intro", "Intro"]);
    const sink = memoryArchiveSink();
    await exportBookZip(
      bookId,
      (n, name) => strings.shareFilename("Mark", n, name),
      testCodec(),
      sink
    );
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark - Intro.mp3",
      "Mark - Intro (2).mp3",
    ]);
  });

  it("Share your work names each book folder's MP3s the same way", async () => {
    await bookNamed("Mark", ["The sower", null]);
    const sink = memoryArchiveSink();
    const result = await exportLibraryZip(
      (book) => book,
      strings.shareFilename,
      testCodec(),
      sink
    );
    expect(result).not.toBeNull();
    expect(Object.keys(unzipSync(archive(sink.chunks)))).toEqual([
      "Mark/Mark - The sower.mp3",
      `Mark/Mark - ${strings.chapterName(2)}.mp3`,
    ]);
  });
});
