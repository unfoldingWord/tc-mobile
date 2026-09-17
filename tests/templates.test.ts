import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createBook,
  getBook,
  getChapter,
  getSegment,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import { createBookFromTemplate, type Template } from "@/lib/storage/templates";
import type { BookProvenance } from "@/types/domain";

beforeEach(async () => {
  // Clear every store rather than deleting the database — see storage.test.ts
  // for why `deleteDatabase` is the wrong tool for this.
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

/**
 * A minimal `Template`, standing in for `obsTemplate`/`bibleBookTemplate`:
 * `chapterCount` chapters, `segmentsPerChapter` segments each, each segment
 * referenced to a distinct scope so the writer's per-segment fidelity is
 * checkable. `source` defaults to a fictitious scripture book code so two
 * DIFFERENT test templates (different `book`) never share the naming
 * counter, which is exactly what a real Bible-book import needs.
 */
function testTemplate(opts: {
  title?: string;
  bookCode?: string;
  chapterCount?: number;
  segmentsPerChapter?: number;
}): Template {
  const {
    title = "Test Template",
    bookCode = "TST",
    chapterCount = 1,
    segmentsPerChapter = 1,
  } = opts;
  const source: BookProvenance = { kind: "scripture", book: bookCode };
  return {
    id: `test:${bookCode}`,
    title,
    source,
    chapters: () =>
      Array.from({ length: chapterCount }, (_, ci) => {
        const number = ci + 1;
        return {
          number,
          segments: Array.from({ length: segmentsPerChapter }, (_, si) => ({
            reference: { book: bookCode, scope: `${number}:${si + 1}` },
          })),
        };
      }),
  };
}

describe("createBookFromTemplate", () => {
  it("writes the book, every chapter and every segment in one call, reference set on each segment", async () => {
    const template = testTemplate({ chapterCount: 2, segmentsPerChapter: 2 });
    const bookId = await createBookFromTemplate(template);

    const book = await getBook(bookId);
    expect(book).toBeDefined();
    expect(book?.chapterIds).toHaveLength(2);

    const chapters = await Promise.all(
      book!.chapterIds.map((id) => getChapter(id))
    );
    expect(chapters.map((c) => c?.number)).toEqual([1, 2]);

    for (const chapter of chapters) {
      expect(chapter?.segmentIds).toHaveLength(2);
      const segments = await Promise.all(
        chapter!.segmentIds.map((id) => getSegment(id))
      );
      segments.forEach((segment, i) => {
        expect(segment?.reference).toEqual({
          book: "TST",
          scope: `${chapter!.number}:${i + 1}`,
        });
        expect(segment?.index).toBe(i + 1);
        expect(segment?.activeTakeId).toBeNull();
        expect(segment?.status).toBe("not-started");
      });
    }
  });

  it("stamps Book.provenance from the template's source", async () => {
    const template = testTemplate({ bookCode: "RUT" });
    const bookId = await createBookFromTemplate(template);
    const book = await getBook(bookId);
    expect(book?.provenance).toEqual({ kind: "scripture", book: "RUT" });
  });

  it("returns the new BookId", async () => {
    const template = testTemplate({});
    const bookId = await createBookFromTemplate(template);
    expect(typeof bookId).toBe("string");
    expect(await getBook(bookId)).toBeDefined();
  });

  describe("idempotency (#253 point 3: a repeated import creates a SECOND book, not a silent dedupe)", () => {
    it("names a repeated import of the same template with an incrementing counter", async () => {
      const template = testTemplate({ title: "Ruth", bookCode: "RUT" });
      const first = await getBook(await createBookFromTemplate(template));
      const second = await getBook(await createBookFromTemplate(template));
      const third = await getBook(await createBookFromTemplate(template));

      expect(first?.name).toBe("Ruth 001");
      expect(second?.name).toBe("Ruth 002");
      expect(third?.name).toBe("Ruth 003");
      // Three distinct books, not one overwritten three times.
      expect(new Set([first?.id, second?.id, third?.id]).size).toBe(3);
    });

    it("gives each repeated import identical structure", async () => {
      const template = testTemplate({
        title: "Ruth",
        bookCode: "RUT",
        chapterCount: 4,
      });
      const a = await getBook(await createBookFromTemplate(template));
      const b = await getBook(await createBookFromTemplate(template));
      expect(a?.chapterIds).toHaveLength(4);
      expect(b?.chapterIds).toHaveLength(4);
    });

    it("lets an explicit name bypass the counter entirely", async () => {
      const template = testTemplate({ title: "Ruth", bookCode: "RUT" });
      const bookId = await createBookFromTemplate(template, "My Ruth Book");
      expect((await getBook(bookId))?.name).toBe("My Ruth Book");
    });

    it("scopes the counter to the template's source, never to name text alone", async () => {
      // A hand-made book that happens to collide with the counter's default
      // name text must not be mistaken for a prior import: only a book whose
      // OWN provenance matches this template's source counts.
      await createBook("Ruth 001");
      const template = testTemplate({ title: "Ruth", bookCode: "RUT" });
      const bookId = await createBookFromTemplate(template);
      expect((await getBook(bookId))?.name).toBe("Ruth 001");
    });

    it("keeps two different templates' counters independent", async () => {
      const ruth = testTemplate({ title: "Ruth", bookCode: "RUT" });
      const obadiah = testTemplate({ title: "Obadiah", bookCode: "OBA" });
      const r1 = await getBook(await createBookFromTemplate(ruth));
      const o1 = await getBook(await createBookFromTemplate(obadiah));
      const r2 = await getBook(await createBookFromTemplate(ruth));
      expect(r1?.name).toBe("Ruth 001");
      expect(o1?.name).toBe("Obadiah 001");
      expect(r2?.name).toBe("Ruth 002");
    });

    // Mutation target for the transaction-scope guard (#253 fix shape item 6):
    // if the naming count and the writes below it are ever split into two
    // separate transactions (rather than the one this function opens), two
    // concurrent imports can both read count 0 before either has written —
    // exactly the "New Book" race `createNextBook` already guards against,
    // now for a bulk template write. IndexedDB serialises overlapping
    // readwrite transactions that share a store, so ONE transaction here
    // guarantees the second import observes the first's write.
    it("gives two concurrent imports of the same template distinct sequential names (one transaction, not two)", async () => {
      const template = testTemplate({ title: "Ruth", bookCode: "RUT" });
      const [aId, bId] = await Promise.all([
        createBookFromTemplate(template),
        createBookFromTemplate(template),
      ]);
      const [a, b] = await Promise.all([getBook(aId), getBook(bId)]);
      const names = [a?.name, b?.name].sort();
      expect(names).toEqual(["Ruth 001", "Ruth 002"]);
    });
  });
});
