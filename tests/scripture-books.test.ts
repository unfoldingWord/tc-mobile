import { describe, expect, it } from "vitest";

import {
  bibleBookTemplate,
  getScriptureBook,
  listScriptureBooks,
} from "@/lib/scripture/books";

describe("scripture-books table", () => {
  it("has exactly the 66 books of the Protestant canon, in canonical order", () => {
    const books = listScriptureBooks();
    expect(books).toHaveLength(66);
    // GEN first, REV last — a reordering or a dropped row both fail this.
    expect(books[0]?.code).toBe("GEN");
    expect(books[books.length - 1]?.code).toBe("REV");
  });

  it("has no duplicate USFM codes", () => {
    const codes = listScriptureBooks().map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("spot-checks the chapter counts #253 names", () => {
    expect(getScriptureBook("GEN")?.chapters).toBe(50);
    expect(getScriptureBook("PSA")?.chapters).toBe(150);
    expect(getScriptureBook("OBA")?.chapters).toBe(1);
  });

  it("sums to the well-known 1189 chapters in the whole Bible (929 OT + 260 NT)", () => {
    // A whole-table sanity check: a single row's miscount, or a rogue extra
    // row, both fail this even where the four spot checks above pass.
    const total = listScriptureBooks().reduce((sum, b) => sum + b.chapters, 0);
    expect(total).toBe(1189);
  });

  it("gives every book a non-empty English name and a positive chapter count", () => {
    for (const book of listScriptureBooks()) {
      expect(book.name.length, book.code).toBeGreaterThan(0);
      expect(book.chapters, book.code).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an unknown code", () => {
    expect(getScriptureBook("XXX")).toBeUndefined();
  });
});

describe("bibleBookTemplate", () => {
  it("builds one chapter per chapter of the book, one starter segment each, referenced to its whole chapter", () => {
    const template = bibleBookTemplate("RUT");
    expect(template.id).toBe("bible:RUT");
    expect(template.title).toBe("Ruth");
    expect(template.source).toEqual({ kind: "scripture", book: "RUT" });

    const chapters = template.chapters();
    expect(chapters).toHaveLength(4); // Ruth has 4 chapters
    expect(chapters.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    for (const chapter of chapters) {
      expect(chapter.segments).toHaveLength(1);
      expect(chapter.segments[0]?.reference).toEqual({
        book: "RUT",
        scope: String(chapter.number),
      });
    }
  });

  it("is pure: calling chapters() twice gives equal, independent structures", () => {
    const template = bibleBookTemplate("OBA");
    expect(template.chapters()).toEqual(template.chapters());
    expect(template.chapters()).not.toBe(template.chapters());
  });

  it("throws for a USFM code not in the table, rather than building an empty book", () => {
    expect(() => bibleBookTemplate("XXX")).toThrow(/XXX/);
  });
});
