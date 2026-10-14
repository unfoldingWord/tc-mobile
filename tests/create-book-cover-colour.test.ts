import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { createBook, getBook } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * The New Book sheet's cover colour (#1190) is written by `createBook` itself,
 * in the same readwrite transaction that derives the slot, not by a second
 * `setBookCoverColour` after it. The proof that there is no second write: a
 * recolour would bump `updatedAt` past `createdAt`, so equal stamps (both the
 * injected `now`) mean the row was written once.
 */
beforeEach(async () => {
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("createBook with a cover colour", () => {
  it("stores the chosen colour on the created row, in one write", async () => {
    const book = await createBook("Mark", null, 5000, "forest");
    expect(book.coverColourKey).toBe("forest");
    const stored = await getBook(book.id);
    expect(stored?.coverColourKey).toBe("forest");
    expect(stored?.createdAt).toBe(5000);
    expect(stored?.updatedAt).toBe(5000);
  });

  it("keeps the colour on a blank-named book, which still gets its slot", async () => {
    const book = await createBook("", null, 1, "plum");
    expect(book.name).toBeNull();
    expect(book.number).toBe(1);
    expect((await getBook(book.id))?.coverColourKey).toBe("plum");
  });

  it("leaves the colour unset when none is passed, as before", async () => {
    const book = await createBook("Mark");
    expect(book.coverColourKey).toBeNull();
    expect((await getBook(book.id))?.coverColourKey).toBeNull();
  });
});
