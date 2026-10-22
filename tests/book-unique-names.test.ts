import "fake-indexeddb/auto";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { isBookNameTaken, failureKey } from "@/hooks/save-failure";
import {
  BookNameTakenError,
  bookNameKey,
  createBook,
  getBook,
  listBooks,
  renameBook,
} from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import { createBookFromPlan } from "@/lib/storage/template-book";
import { planBookFromTemplate } from "@/lib/templates/plan";
import { parseTemplatePackage } from "@/lib/templates/validate";
import type { Book, BookId, ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * #1272 (PR A): book names are unique for NEW writes. S13 "Block it" ("require
 * unique names for the books"), U4a "Leave existing duplicates alone and block
 * only new ones", U4b "The app refuses and asks for a different name". The
 * guard lives in the store, in the write's own transaction.
 */

beforeEach(clearAllStores);

/** Plant two books with the same name, the way a pre-#1272 phone holds them. */
async function plantDuplicates(name: string): Promise<[BookId, BookId]> {
  const a = await createBook("seed-a", null, 1);
  const b = await createBook("seed-b", null, 2);
  const db = await getDb();
  for (const book of [a, b]) {
    await db.put("books", { ...book, name });
  }
  return [a.id, b.id];
}

describe("bookNameKey", () => {
  it("ignores case, outer and repeated spaces, and Unicode composition", () => {
    expect(bookNameKey("  MARK ")).toBe(bookNameKey("mark"));
    expect(bookNameKey("Mark   One")).toBe(bookNameKey("mark one"));
    expect(bookNameKey("Café")).toBe(bookNameKey("Café"));
  });
  it("keeps different names different", () => {
    expect([bookNameKey("Mark 1"), bookNameKey("Mark 2")]).toEqual([
      "mark 1",
      "mark 2",
    ]);
  });
});

describe("createBook", () => {
  it("refuses a name another book has, writing nothing", async () => {
    await createBook("Mark");
    await expect(createBook("Mark")).rejects.toBeInstanceOf(BookNameTakenError);
    expect(await listBooks()).toHaveLength(1);
  });

  it("compares trimmed and case-insensitively", async () => {
    await createBook("Mark");
    await expect(createBook("  mARK  ")).rejects.toBeInstanceOf(
      BookNameTakenError
    );
  });

  it("still lets unnamed books repeat: they hold no name", async () => {
    await createBook("");
    await createBook("");
    expect(await listBooks()).toHaveLength(2);
  });

  it("holds under two overlapping creates of one name", async () => {
    const results = await Promise.allSettled([
      createBook("Luke"),
      createBook("Luke"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await listBooks()).toHaveLength(1);
  });

  it("does not renumber the shelf when it refuses", async () => {
    await createBook("Mark");
    const before = await listBooks();
    await expect(createBook("Mark")).rejects.toThrow();
    expect(await listBooks()).toEqual(before);
  });

  it("is not blocked by an existing duplicate pair of another name", async () => {
    await plantDuplicates("Acts");
    await expect(createBook("John")).resolves.toMatchObject({ name: "John" });
  });
});

describe("renameBook", () => {
  it("refuses a name another book has, leaving the book as it was", async () => {
    const a = await createBook("Mark");
    const b = await createBook("Luke");
    await expect(renameBook(b.id, "mark")).rejects.toBeInstanceOf(
      BookNameTakenError
    );
    expect((await getBook(b.id))?.name).toBe("Luke");
    expect((await getBook(a.id))?.name).toBe("Mark");
  });

  it("lets a book change only its own case or spacing", async () => {
    const a = await createBook("Mark");
    const renamed = await renameBook(a.id, " MARK ");
    expect(renamed.name).toBe("MARK");
  });

  it("allows a name no one else has", async () => {
    const a = await createBook("Mark");
    expect((await renameBook(a.id, "Mark 2")).name).toBe("Mark 2");
  });

  it("leaves existing duplicates alone, and renaming one to its own name is a no-op (U4a)", async () => {
    const [a, b] = await plantDuplicates("Acts");
    const before = await getBook(a);
    const same = await renameBook(a, "Acts", 99);
    expect(same).toEqual(before);
    expect((await getBook(b))?.name).toBe("Acts");
    expect((await listBooks()).map((x) => x.name)).toEqual(["Acts", "Acts"]);
  });

  it("lets a duplicate be renamed away to a free name", async () => {
    const [a] = await plantDuplicates("Acts");
    expect((await renameBook(a, "Acts 2")).name).toBe("Acts 2");
  });

  it("refuses renaming a duplicate to a third book's name", async () => {
    const [a] = await plantDuplicates("Acts");
    await createBook("Ruth");
    await expect(renameBook(a, "Ruth")).rejects.toBeInstanceOf(
      BookNameTakenError
    );
  });
});

describe("createBookFromPlan with a name (U4b)", () => {
  const plan = planBookFromTemplate(
    parseTemplatePackage(
      JSON.parse(
        readFileSync(
          path.join(__dirname, "fixtures", "templates", firstFixture()),
          "utf8"
        )
      ) as unknown
    ),
    () => undefined,
    1_760_000_000_000
  );
  const idsFor = (tag: string) => ({
    book: `book-${tag}` as BookId,
    chapters: plan.chapters.map((chapter, c) => ({
      id: `chapter-${tag}-${c}` as ChapterId,
      segments: chapter.segments.map(
        (_, s) => `segment-${tag}-${c}-${s}` as SegmentId
      ),
    })),
  });

  it("refuses a second book with the first one's name, writing nothing", async () => {
    await createBookFromPlan(plan, idsFor("a"), "Mark");
    await expect(
      createBookFromPlan(plan, idsFor("b"), " mark")
    ).rejects.toBeInstanceOf(BookNameTakenError);
    const db = await getDb();
    expect(await db.count("books")).toBe(1);
    expect(await db.count("chapters")).toBe(plan.chapters.length);
  });

  it("accepts the second book under a different name", async () => {
    await createBookFromPlan(plan, idsFor("a"), "Mark");
    const second = await createBookFromPlan(plan, idsFor("b"), "Mark 2");
    expect(second.name).toBe("Mark 2");
  });

  it("refuses a name a typed book holds", async () => {
    await createBook("Mark");
    await expect(
      createBookFromPlan(plan, idsFor("a"), "Mark")
    ).rejects.toBeInstanceOf(BookNameTakenError);
  });

  it("leaves the book unnamed when no name is given, as before", async () => {
    const book: Book = await createBookFromPlan(plan, idsFor("a"));
    expect(book.name).toBeNull();
  });
});

describe("failure classification", () => {
  it("maps the refusal to its own key, ahead of the fallback", async () => {
    await createBook("Mark");
    const cause = await createBook("Mark").catch((e: unknown) => e);
    expect(isBookNameTaken(cause)).toBe(true);
    expect(failureKey(cause, "saveFailed")).toBe("bookNameTaken");
  });
  it("does not mistake another failure for it", () => {
    expect(isBookNameTaken(new Error("boom"))).toBe(false);
    expect(failureKey(new Error("boom"), "saveFailed")).toBe("saveFailed");
  });
  it("still reports a full disk as noRoom", () => {
    expect(failureKey({ name: "QuotaExceededError" }, "saveFailed")).toBe(
      "noRoom"
    );
  });
});

function firstFixture(): string {
  const dir = path.join(__dirname, "fixtures", "templates");
  const name = readdirSync(dir).find(
    (f) => f.endsWith(".json") && !f.startsWith("titles-")
  );
  if (!name) throw new Error("no template fixture");
  return name;
}
