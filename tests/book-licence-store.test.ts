import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import path from "node:path";

import { unwrap } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBook, getBook } from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import {
  TemplateLicenceLockedError,
  setBookLicence,
} from "@/lib/storage/licence";
import { createBookFromPlan } from "@/lib/storage/template-book";
import { planBookFromTemplate } from "@/lib/templates/plan";
import { parseTemplatePackage } from "@/lib/templates/validate";
import type { Book, BookId, ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * `setBookLicence` (#1455, storage half). T1: the guarantees a later share
 * step relies on. D5-licence (`lock-template`): "Books made from a template
 * are CC BY-SA 4.0; other books choose". R20 (`empty-preselect`): "Empty
 * until someone chooses; CC BY-SA 4.0 is pre-selected when they share".
 */

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

async function templateBook(): Promise<Book> {
  const json: unknown = JSON.parse(
    readFileSync(
      path.join(__dirname, "fixtures", "templates", "obs-min.json"),
      "utf8"
    )
  );
  const plan = planBookFromTemplate(
    parseTemplatePackage(json),
    (kind, key) => `${kind}:${key}`,
    100
  );
  return createBookFromPlan(plan, {
    book: "book-t" as BookId,
    chapters: plan.chapters.map((chapter, c) => ({
      id: `chapter-t-${c}` as ChapterId,
      segments: chapter.segments.map(
        (_, s) => `segment-t-${c}-${s}` as SegmentId
      ),
    })),
  });
}

/** Every `IDBDatabase.transaction` call from here on, as [stores, mode]. */
async function spyTransactions() {
  const raw = unwrap(await getDb());
  return vi.spyOn(raw, "transaction");
}

describe("setBookLicence", () => {
  it("writes the licence and modifiedAt in one readwrite transaction", async () => {
    const book = await createBook("Mark", null, 100);
    expect(book.licence).toBeNull();
    const opened = await spyTransactions();

    const result = await setBookLicence(book.id, "CC-BY-4.0", 500);

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0]?.[0]).toBe("books");
    expect(opened.mock.calls[0]?.[1]).toBe("readwrite");
    expect(result.licence).toBe("CC-BY-4.0");
    expect(result.modifiedAt).toBe(500);
    const stored = await getBook(book.id);
    expect(stored?.licence).toBe("CC-BY-4.0");
    expect(stored?.modifiedAt).toBe(500);
    // Choosing a licence is not activity on the shelf.
    expect(stored?.updatedAt).toBe(book.updatedAt);
    expect(stored).toEqual({ ...book, licence: "CC-BY-4.0", modifiedAt: 500 });
  });

  it("refuses a template book with a typed error and writes nothing", async () => {
    const book = await templateBook();
    expect(book.provenance.kind).toBe("template");
    expect(book.licence).toBe("CC-BY-SA-4.0");

    for (const licence of ["CC0-1.0", "CC-BY-SA-4.0", null] as const) {
      const attempt = setBookLicence(book.id, licence, 500);
      await expect(attempt).rejects.toBeInstanceOf(TemplateLicenceLockedError);
      await expect(attempt).rejects.toMatchObject({ bookId: book.id });
    }

    expect(await getBook(book.id)).toEqual(book);
  });

  it("keeps null meaning not chosen on a blank book", async () => {
    const book = await createBook("Mark", null, 100);
    const opened = await spyTransactions();

    const result = await setBookLicence(book.id, null, 500);

    expect(opened).toHaveBeenCalledTimes(1);
    expect(result.licence).toBeNull();
    expect(await getBook(book.id)).toEqual(book);
  });

  it("is idempotent: the same licence again writes nothing", async () => {
    const book = await createBook("Mark", null, 100);
    await setBookLicence(book.id, "CC-BY-SA-4.0", 500);

    const again = await setBookLicence(book.id, "CC-BY-SA-4.0", 900);

    expect(again.licence).toBe("CC-BY-SA-4.0");
    expect(again.modifiedAt).toBe(500);
    expect((await getBook(book.id))?.modifiedAt).toBe(500);
  });

  it("changes a chosen licence, and can return it to not chosen", async () => {
    const book = await createBook("Mark", null, 100);
    await setBookLicence(book.id, "CC-BY-SA-4.0", 500);

    await setBookLicence(book.id, "all-rights-reserved", 600);
    expect((await getBook(book.id))?.licence).toBe("all-rights-reserved");

    await setBookLicence(book.id, null, 700);
    const stored = await getBook(book.id);
    expect(stored?.licence).toBeNull();
    expect(stored?.modifiedAt).toBe(700);
  });

  it("throws the shared missing-book shape for an unknown id", async () => {
    await expect(
      setBookLicence("nope" as BookId, "CC0-1.0", 500)
    ).rejects.toThrow("No such book: nope");
  });

  describe("refusals write nothing and leave no live transaction", () => {
    /** Every `put` on any object store, and every transaction abort. */
    function spyWrites() {
      return {
        put: vi.spyOn(IDBObjectStore.prototype, "put"),
        abort: vi.spyOn(IDBTransaction.prototype, "abort"),
      };
    }

    it("the no-op puts nothing and aborts nothing", async () => {
      const book = await createBook("Mark", null, 100);
      await setBookLicence(book.id, "CC0-1.0", 200);
      const spies = spyWrites();

      await setBookLicence(book.id, "CC0-1.0", 900);
      await setBookLicence(book.id, "CC0-1.0", 901);

      expect(spies.put).not.toHaveBeenCalled();
      expect(spies.abort).not.toHaveBeenCalled();
    });

    it("the template refusal puts nothing and aborts its transaction", async () => {
      const book = await templateBook();
      const spies = spyWrites();

      await expect(
        setBookLicence(book.id, "CC0-1.0", 500)
      ).rejects.toBeInstanceOf(TemplateLicenceLockedError);

      expect(spies.put).not.toHaveBeenCalled();
      expect(spies.abort).toHaveBeenCalledTimes(1);
      expect(await getBook(book.id)).toEqual(book);
    });

    it("the missing-book throw puts nothing and aborts its transaction", async () => {
      const spies = spyWrites();

      await expect(
        setBookLicence("nope" as BookId, "CC0-1.0", 500)
      ).rejects.toThrow("No such book: nope");

      expect(spies.put).not.toHaveBeenCalled();
      expect(spies.abort).toHaveBeenCalledTimes(1);
    });
  });
});
