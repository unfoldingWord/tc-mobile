import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import { clearAllStores } from "./support";

/**
 * The creators write the v12 fields (#1462, docs/design/v12-schema.md,
 * "Creators change in the same PR"): a new book is blank with no licence
 * chosen (R20) and a write time; a new chapter or segment carries its write
 * time as both timestamps and no template key. Read back from the store, so
 * what is asserted is what was persisted.
 */

const NOW = 1_760_000_000_000;

beforeEach(async () => {
  await clearAllStores();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the creators write the v12 fields", () => {
  it("createBook: blank provenance, no licence, modifiedAt the write time", async () => {
    const book = await createBook("Mark", "swh", 42);
    const stored = await (await getDb()).get("books", book.id);
    expect(stored).toMatchObject({ languageCode: "swh", createdAt: 42 });
    expect(stored?.provenance).toEqual({ kind: "blank" });
    expect(stored?.licence).toBeNull();
    expect(stored?.modifiedAt).toBe(42);
  });

  it("addChapter and addSegment: both timestamps the write time, no template key", async () => {
    const book = await createBook("Mark");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const db = await getDb();
    for (const row of [
      await db.get("chapters", chapter.id),
      await db.get("segments", segment.id),
    ]) {
      expect(row?.createdAt).toBe(NOW);
      expect(row?.modifiedAt).toBe(NOW);
      expect(row?.templateKey).toBeNull();
    }
    expect((await db.get("segments", segment.id))?.reference).toBeNull();
  });
});
