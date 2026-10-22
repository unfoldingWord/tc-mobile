import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { createBook, getBook, setBookLanguageOnce } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { BookId } from "@/types/domain";

/**
 * `setBookLanguageOnce` (#1492): the language a book's first Export project
 * asked for is written once and never replaced. T1: these are the guarantees
 * the ask relies on to "never ask again" and to keep the first answer.
 */

beforeEach(async () => {
  // Clear every store rather than deleting the database (AGENTS.md).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("setBookLanguageOnce", () => {
  it("writes the tag to a book that has none and stamps modifiedAt", async () => {
    const book = await createBook("Mark", null, 100);
    expect(book.languageCode).toBeNull();

    const result = await setBookLanguageOnce(book.id, "swh", 500);

    expect(result.languageCode).toBe("swh");
    const stored = await getBook(book.id);
    expect(stored?.languageCode).toBe("swh");
    expect(stored?.modifiedAt).toBe(500);
    // Naming the language is not activity on the shelf.
    expect(stored?.updatedAt).toBe(book.updatedAt);
  });

  it("keeps the language a book already has and writes nothing", async () => {
    const book = await createBook("Mark", "fr", 100);

    const result = await setBookLanguageOnce(book.id, "swh", 500);

    expect(result.languageCode).toBe("fr");
    const stored = await getBook(book.id);
    expect(stored?.languageCode).toBe("fr");
    expect(stored?.modifiedAt).toBe(book.modifiedAt);
  });

  it("trims the tag and refuses a blank one", async () => {
    const book = await createBook("Mark");

    await expect(setBookLanguageOnce(book.id, "   ")).rejects.toThrow(
      /blank language tag/
    );
    expect((await getBook(book.id))?.languageCode).toBeNull();

    const result = await setBookLanguageOnce(book.id, "  id ");
    expect(result.languageCode).toBe("id");
  });

  it("keeps the first of two racing answers", async () => {
    const book = await createBook("Mark");

    const [first, second] = await Promise.all([
      setBookLanguageOnce(book.id, "en"),
      setBookLanguageOnce(book.id, "pt"),
    ]);

    expect(first.languageCode).toBe("en");
    expect(second.languageCode).toBe("en");
    expect((await getBook(book.id))?.languageCode).toBe("en");
  });

  it("throws for a book that is gone", async () => {
    await expect(
      setBookLanguageOnce("missing" as BookId, "en")
    ).rejects.toThrow(/No such book: missing/);
  });
});
