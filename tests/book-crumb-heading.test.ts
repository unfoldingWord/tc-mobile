import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { loadChapterView } from "@/hooks/use-chapter-segments";
import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import {
  addChapter,
  addSegment,
  createBook,
  renameBook,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import { strings } from "@/lib/strings";

/**
 * The book crumb on the Segments screen and in the recorder (#169).
 *
 * An unnamed book stores no words — `name: null` and a slot — so the two views
 * that feed those crumbs resolve the heading the Books row shows,
 * `strings.bookHeading`, rather than handing the screen the raw `null`. Without
 * that the crumb would read blank for every book created since the store
 * stopped writing "Book 001" into `name`. The deleted-book race keeps its `""`.
 */

beforeEach(async () => {
  // Clear every store rather than deleting the database: `deleteDatabase`
  // blocks while any connection is open (AGENTS.md).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("the book crumb's heading (#169)", () => {
  it("is the placeholder an unnamed book's slot renders, in both views", async () => {
    await createBook("");
    const book = await createBook("");
    expect(book.name).toBeNull();
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);

    const placeholder = strings.bookHeading(null, book.number);
    expect(placeholder).not.toBe("");
    expect((await loadChapterView(chapter.id)).bookName).toBe(placeholder);
    expect((await loadRecorderSegmentView(segment.id)).bookName).toBe(
      placeholder
    );
  });

  it("is the facilitator's name once the book has one", async () => {
    const book = await createBook("");
    await renameBook(book.id, "Ruth");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);

    expect((await loadChapterView(chapter.id)).bookName).toBe("Ruth");
    expect((await loadRecorderSegmentView(segment.id)).bookName).toBe("Ruth");
  });

  it("stays empty when the book is gone from under the chapter", async () => {
    const book = await createBook("");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const db = await getDb();
    await db.delete("books", book.id);

    expect((await loadChapterView(chapter.id)).bookName).toBe("");
    expect((await loadRecorderSegmentView(segment.id)).bookName).toBe("");
  });
});
