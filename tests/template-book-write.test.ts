import "fake-indexeddb/auto";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addChapter,
  createBook,
  getBook,
  getChapter,
  getSegmentsOfChapter,
  listBooks,
} from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import {
  type TemplateBookIds,
  createBookFromPlan,
} from "@/lib/storage/template-book";
import { type BookPlan, planBookFromTemplate } from "@/lib/templates/plan";
import { parseTemplatePackage } from "@/lib/templates/validate";
import type { BookId, ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * The storage half of #253 (part of #1450): a planned book, its chapters and
 * its segments written in ONE readwrite transaction, idempotent on the
 * caller's ids. The plan is `planBookFromTemplate`'s, from each fixture.
 */

const FIXTURES = path.join(__dirname, "fixtures", "templates");
const PACKAGES = readdirSync(FIXTURES).filter(
  (f) => f.endsWith(".json") && !f.startsWith("titles-")
);
const NOW = 1_760_000_000_000;

function planOf(name: string): BookPlan {
  const json: unknown = JSON.parse(
    readFileSync(path.join(FIXTURES, name), "utf8")
  );
  // A resolver that knows every key: titles are planned, so a test can see
  // that the writer leaves them out rather than that there were none.
  return planBookFromTemplate(
    parseTemplatePackage(json),
    (kind, key) => `${kind}:${key}`,
    NOW
  );
}

function idsFor(plan: BookPlan, tag = "a"): TemplateBookIds {
  return {
    book: `book-${tag}` as BookId,
    chapters: plan.chapters.map((chapter, c) => ({
      id: `chapter-${tag}-${c}` as ChapterId,
      segments: chapter.segments.map(
        (_, s) => `segment-${tag}-${c}-${s}` as SegmentId
      ),
    })),
  };
}

/** Every row in the three stores, so a test can say "nothing was written". */
async function rowCounts() {
  const db = await getDb();
  return {
    books: await db.count("books"),
    chapters: await db.count("chapters"),
    segments: await db.count("segments"),
  };
}

/** What was stored, in the plan's own shape, for the fields it has a home for. */
async function readBack(bookId: BookId) {
  const book = await getBook(bookId);
  if (!book) throw new Error("book not written");
  const chapters = [];
  for (const chapterId of book.chapterIds) {
    const chapter = await getChapter(chapterId);
    if (!chapter) throw new Error("chapter not written");
    const segments = await getSegmentsOfChapter(chapterId);
    chapters.push({ chapter, segments });
  }
  return { book, chapters };
}

/** The plan with the two fields no domain row stores: title and thumbnail. */
function storable(plan: BookPlan) {
  return {
    provenance: plan.provenance,
    licence: plan.licence,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    modifiedAt: plan.modifiedAt,
    chapters: plan.chapters.map((c) => ({
      number: c.number,
      templateKey: c.templateKey,
      createdAt: c.createdAt,
      modifiedAt: c.modifiedAt,
      segments: c.segments.map((s) => ({
        index: s.index,
        templateKey: s.templateKey,
        reference: s.reference,
        createdAt: s.createdAt,
        modifiedAt: s.modifiedAt,
      })),
    })),
  };
}

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

describe("createBookFromPlan", () => {
  it.each(PACKAGES)("round-trips the plan of %s", async (name) => {
    const plan = planOf(name);
    const ids = idsFor(plan);
    await createBookFromPlan(plan, ids);

    const { book, chapters } = await readBack(ids.book);
    expect({
      provenance: book.provenance,
      licence: book.licence,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      modifiedAt: book.modifiedAt,
      chapters: chapters.map(({ chapter, segments }) => ({
        number: chapter.number,
        templateKey: chapter.templateKey,
        createdAt: chapter.createdAt,
        modifiedAt: chapter.modifiedAt,
        segments: segments.map((s) => ({
          index: s.index,
          templateKey: s.templateKey,
          reference: s.reference,
          createdAt: s.createdAt,
          modifiedAt: s.modifiedAt,
        })),
      })),
    }).toEqual(storable(plan));

    // The ids are the caller's, in the plan's order, and the rows link up.
    expect(book.chapterIds).toEqual(ids.chapters.map((c) => c.id));
    for (const [c, { chapter, segments }] of chapters.entries()) {
      expect(chapter.bookId).toBe(ids.book);
      expect(chapter.segmentIds).toEqual(ids.chapters[c]?.segments);
      expect(segments.map((s) => s.chapterId)).toEqual(
        segments.map(() => chapter.id)
      );
    }
  });

  it("leaves titles unwritten: no chapter name, no segment label", async () => {
    // Written-versus-rendered is open with the DRI (#1450); `templateKey` is
    // what either answer reads, so nothing the resolver gave is stored.
    const plan = planOf("obs-min.json");
    const ids = idsFor(plan);
    const book = await createBookFromPlan(plan, ids);
    expect(book.name).toBeNull();
    const { chapters } = await readBack(ids.book);
    for (const { chapter, segments } of chapters) {
      expect(chapter.name).toBeNull();
      for (const segment of segments) {
        expect(segment.label).toBeNull();
        expect(segment.activeTakeId).toBeNull();
        expect(segment.status).toBe("not-started");
      }
    }
  });

  it("stores the provenance stamp and the licence exactly as planned", async () => {
    const plan = planOf("collection-min.json");
    const ids = idsFor(plan);
    await createBookFromPlan(plan, ids);
    const stored = await getBook(ids.book);
    expect(stored?.provenance).toEqual({
      kind: "template",
      template: {
        id: "collection:psalm-songs",
        version: "0.1.0",
        kind: "collection",
      },
      attribution: "Fixture collection, CC BY-SA 4.0",
    });
    expect(stored?.licence).toBe("CC-BY-SA-4.0");
  });

  it("lands at the top of the shelf, in the first free placeholder slot", async () => {
    await createBook("Mark", null, 1_000);
    await createBook("", null, 2_000);
    const plan = planOf("bible-book-min.json");
    const book = await createBookFromPlan(plan, idsFor(plan));
    const shelf = await listBooks();
    expect(shelf.map((b) => b.id)).toEqual([
      book.id,
      ...shelf.slice(1).map((b) => b.id),
    ]);
    expect(shelf.map((b) => b.shelfPosition)).toEqual([0, 1, 2]);
    expect(book.number).toBe(2);
  });

  it("is idempotent: re-running the same create writes nothing new", async () => {
    await createBook("Mark", null, 1_000);
    const plan = planOf("obs-min.json");
    const ids = idsFor(plan);
    const first = await createBookFromPlan(plan, ids);
    const shelfBefore = await listBooks();
    const countsBefore = await rowCounts();

    const second = await createBookFromPlan(plan, ids);

    expect(second).toEqual(first);
    expect(await listBooks()).toEqual(shelfBefore);
    expect(await rowCounts()).toEqual(countsBefore);
    expect(countsBefore.books).toBe(2);
    expect(
      (await listBooks()).filter((b) => b.provenance.kind === "template")
    ).toHaveLength(1);
  });

  it("a replay after the book was edited still writes nothing", async () => {
    const plan = planOf("pair-v0.1.0.json");
    const ids = idsFor(plan);
    await createBookFromPlan(plan, ids);
    await addChapter(ids.book);
    const edited = await getBook(ids.book);
    const countsBefore = await rowCounts();

    expect(await createBookFromPlan(plan, ids)).toEqual(edited);
    expect(await rowCounts()).toEqual(countsBefore);
  });

  it("refuses the same book id from a different create of the same package", async () => {
    const plan = planOf("pair-v0.1.0.json");
    const ids = idsFor(plan);
    await createBookFromPlan(plan, ids);
    const later = { ...plan, createdAt: plan.createdAt + 1 };
    await expect(createBookFromPlan(later, ids)).rejects.toThrow(ids.book);
  });

  it("a second create with new ids is a second book", async () => {
    const plan = planOf("pair-v0.1.0.json");
    await createBookFromPlan(plan, idsFor(plan, "a"));
    await createBookFromPlan(plan, idsFor(plan, "b"));
    const counts = await rowCounts();
    const segmentCount = plan.chapters.reduce(
      (n, c) => n + c.segments.length,
      0
    );
    expect(counts).toEqual({
      books: 2,
      chapters: 2 * plan.chapters.length,
      segments: 2 * segmentCount,
    });
  });

  it("refuses a book id already held by a different book", async () => {
    const other = await createBook("Mark", null, 1_000);
    const plan = planOf("pair-v0.1.0.json");
    const ids = { ...idsFor(plan), book: other.id };
    await expect(createBookFromPlan(plan, ids)).rejects.toThrow(other.id);
    expect(await rowCounts()).toEqual({ books: 1, chapters: 0, segments: 0 });
  });

  it("refuses a chapter or segment id another book already holds", async () => {
    const plan = planOf("pair-v0.1.0.json");
    await createBookFromPlan(plan, idsFor(plan, "a"));
    const before = await rowCounts();
    const clash = { ...idsFor(plan, "a"), book: "book-b" as BookId };
    await expect(createBookFromPlan(plan, clash)).rejects.toThrow(
      "chapter-a-0"
    );
    expect(await rowCounts()).toEqual(before);
  });

  it("refuses ids that do not match the plan's shape, before any write", async () => {
    const plan = planOf("pair-v0.1.0.json");
    const ids = idsFor(plan);
    const short = { ...ids, chapters: ids.chapters.slice(1) };
    await expect(createBookFromPlan(plan, short)).rejects.toThrow(
      /do not match/
    );
    const repeated = {
      ...ids,
      chapters: ids.chapters.map((c) => ({
        ...c,
        segments: c.segments.map(() => "segment-same" as SegmentId),
      })),
    };
    await expect(createBookFromPlan(plan, repeated)).rejects.toThrow(
      "segment-same"
    );
    expect(await rowCounts()).toEqual({ books: 0, chapters: 0, segments: 0 });
  });
});

/**
 * Make the put of ONE segment fail, keyed on the row written, and let every
 * other write through: `throw` is the synchronous shape that does not abort a
 * transaction by itself, `reject` the request failure IndexedDB aborts on its
 * own (a ConstraintError from `add` on a key that is already there). The last
 * segment of the plan is the target, so the book and every chapter were put
 * before it failed.
 */
function failSegmentPut(targetId: SegmentId, mode: "throw" | "reject") {
  const real = IDBObjectStore.prototype.put;
  const realAdd = IDBObjectStore.prototype.add;
  const hits: unknown[] = [];
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    const row: unknown = args[0];
    const isTarget =
      this.name === "segments" &&
      typeof row === "object" &&
      row !== null &&
      (row as { id?: unknown }).id === targetId;
    if (!isTarget) return real.apply(this, args);
    hits.push(row);
    if (mode === "throw") throw new Error("injected put failure");
    // Put the row first so the `add` below collides with it.
    real.apply(this, args);
    return realAdd.apply(this, args);
  });
  return hits;
}

describe.each(["throw", "reject"] as const)(
  "createBookFromPlan: a failed write mid-transaction leaves nothing, %s",
  (mode) => {
    it("writes no book, chapter or segment, and keeps the shelf", async () => {
      await createBook("Mark", null, 1_000);
      const shelfBefore = await listBooks();
      const plan = planOf("obs-min.json");
      const ids = idsFor(plan);
      const last = ids.chapters.at(-1)?.segments.at(-1);
      if (!last) throw new Error("fixture has no segment");
      const hits = failSegmentPut(last, mode);

      await expect(createBookFromPlan(plan, ids)).rejects.toBeTruthy();
      expect(hits).toHaveLength(1);

      vi.restoreAllMocks();
      expect(await getBook(ids.book)).toBeUndefined();
      expect(await rowCounts()).toEqual({
        books: 1,
        chapters: 0,
        segments: 0,
      });
      expect(await listBooks()).toEqual(shelfBefore);
    });
  }
);
