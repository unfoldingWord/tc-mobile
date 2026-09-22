import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { clearAllStores } from "./support";
import {
  addChapter,
  createBook,
  getBook,
  getChapter,
  renameBook,
  renameChapter,
} from "@/lib/storage/books";

/**
 * #394 deliberately accepts transaction-order last-write-wins. These cases use
 * one cached database connection and pin the observed same-tab call ordering,
 * plus overlapping book/chapter writes preserving each other's fields.
 * They do not establish typing-time ordering across tabs or devices.
 */
beforeEach(clearAllStores);

describe("concurrent renames of one target resolve last-call-wins (#394)", () => {
  it("book: two renames started back-to-back leave the later call's name", async () => {
    const book = await createBook("probe");
    const first = renameBook(book.id, "Mark");
    const second = renameBook(book.id, "Luke");
    await Promise.all([first, second]);
    expect((await getBook(book.id))?.name).toBe("Luke");
  });

  it("book: the property holds across a burst, not just once", async () => {
    const book = await createBook("probe");
    for (let round = 0; round < 20; round += 1) {
      await Promise.all([
        renameBook(book.id, `older-${round}`),
        renameBook(book.id, `newer-${round}`),
      ]);
      expect((await getBook(book.id))?.name).toBe(`newer-${round}`);
    }
  });

  it("book: renames of DIFFERENT books do not serialize the shelf into a wrong outcome either", async () => {
    const a = await createBook("A-book");
    const b = await createBook("B-book");
    await Promise.all([
      renameBook(a.id, "A-renamed"),
      renameBook(b.id, "B-renamed"),
    ]);
    expect((await getBook(a.id))?.name).toBe("A-renamed");
    expect((await getBook(b.id))?.name).toBe("B-renamed");
  });

  it("chapter: two renames started back-to-back leave the later call's name", async () => {
    const book = await createBook("probe");
    const chapter = await addChapter(book.id);
    await Promise.all([
      renameChapter(chapter.id, "Mark 6"),
      renameChapter(chapter.id, "Mark 9"),
    ]);
    expect((await getChapter(chapter.id))?.name).toBe("Mark 9");
  });

  it("chapter: a book rename and a chapter rename of one book overlap in scope — both survive, neither clobbers the other", async () => {
    // renameBook writes the book; renameChapter writes the chapter AND bumps
    // the parent book's updatedAt in the same transaction. Their scopes
    // overlap on `books`, so the engine serializes them; what must hold is
    // that each landing is complete, not partial.
    const book = await createBook("probe");
    const chapter = await addChapter(book.id);
    await Promise.all([
      renameBook(book.id, "Luke"),
      renameChapter(chapter.id, "Luke 3"),
    ]);
    expect((await getBook(book.id))?.name).toBe("Luke");
    expect((await getChapter(chapter.id))?.name).toBe("Luke 3");
  });
});
