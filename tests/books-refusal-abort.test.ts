import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addChapter,
  addSegment,
  createBook,
  getBook,
  renameBook,
  renameChapter,
  renameSegment,
  setBookCoverColour,
  setBookLanguageOnce,
} from "@/lib/storage/books";
import type { BookId, ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Every writer in `books.ts` that opens a readwrite transaction and then
 * refuses because the row is missing aborts that transaction before it throws,
 * and puts nothing (#1455). A thrown error does not roll a transaction back;
 * left alone it autocommits with `done` never observed.
 */

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

const MISSING_BOOK = "nope" as BookId;
const MISSING_CHAPTER = "nope" as ChapterId;
const MISSING_SEGMENT = "nope" as SegmentId;

describe("books.ts missing-row refusals abort their transaction", () => {
  const cases: [string, string, () => Promise<unknown>][] = [
    ["renameBook", "No such book: nope", () => renameBook(MISSING_BOOK, "x")],
    [
      "setBookCoverColour",
      "No such book: nope",
      () => setBookCoverColour(MISSING_BOOK, "forest"),
    ],
    [
      "setBookLanguageOnce",
      "No such book: nope",
      () => setBookLanguageOnce(MISSING_BOOK, "en"),
    ],
    ["addChapter", "No such book: nope", () => addChapter(MISSING_BOOK)],
    [
      "renameChapter",
      "No such chapter: nope",
      () => renameChapter(MISSING_CHAPTER, "x"),
    ],
    ["addSegment", "No such chapter: nope", () => addSegment(MISSING_CHAPTER)],
    [
      "renameSegment",
      "No such segment: nope",
      () => renameSegment(MISSING_SEGMENT, "x"),
    ],
  ];

  it.each(cases)(
    "%s puts nothing and aborts once",
    async (_name, message, call) => {
      await createBook("Mark", null, 100);
      const put = vi.spyOn(IDBObjectStore.prototype, "put");
      const add = vi.spyOn(IDBObjectStore.prototype, "add");
      const abort = vi.spyOn(IDBTransaction.prototype, "abort");

      await expect(call()).rejects.toThrow(message);

      expect(put).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(abort).toHaveBeenCalledTimes(1);
    }
  );

  it("an idempotent rename of a real book aborts nothing", async () => {
    const book = await createBook("Mark", null, 100);
    const abort = vi.spyOn(IDBTransaction.prototype, "abort");

    await renameBook(book.id, "Mark", 200);

    expect(abort).not.toHaveBeenCalled();
    expect(await getBook(book.id)).toEqual(book);
  });
});
