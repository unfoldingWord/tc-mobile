import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBook, listBooks } from "@/lib/storage/books";
import type { Book } from "@/types/domain";
import { getDb } from "@/lib/storage/db";
import { clearAllStores } from "./support";

/**
 * `createBook` writes the new row and renumbers the shelf in ONE readwrite
 * transaction (#338), so a `put` that throws partway through the renumber must
 * abort it, as `moveBook` does: the shelf stays exactly as it was and no
 * half-created book is left behind (#1369).
 */

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

/**
 * Make the renumber put for ONE existing book fail, and let every other write
 * through. The failure is keyed on the record written (its id is `targetId` and
 * it carries a new `shelfPosition`), never on a call count, so it still lands
 * on the renumber put if `createBook` gains or reorders other writes.
 *
 * - `throw`: `put` throws synchronously, the shape that does not abort the
 *   transaction by itself.
 * - `reject`: the request fails asynchronously (a ConstraintError from `add`
 *   on a key that exists), which IndexedDB aborts on its own.
 *
 * Returns the matches seen, so a test can assert the failure really fired on
 * that record and not on some other write.
 */
function failRenumberPut(
  targetId: string,
  priorPositions: ReadonlyMap<string, number>,
  mode: "throw" | "reject"
) {
  const real = IDBObjectStore.prototype.put;
  const realAdd = IDBObjectStore.prototype.add;
  const hits: Book[] = [];
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    const row: unknown = args[0];
    // A non-object value falls through to the real `put`, which throws its own
    // DataError, rather than a TypeError from inside this spy.
    const isBook = (value: unknown): value is Book =>
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "shelfPosition" in value;
    const isTarget = (value: unknown): value is Book =>
      this.name === "books" &&
      isBook(value) &&
      value.id === targetId &&
      priorPositions.get(value.id) !== value.shelfPosition;
    if (!isTarget(row)) return real.apply(this, args);
    hits.push(row);
    if (mode === "throw") throw new Error("injected put failure");
    return realAdd.apply(this, args);
  });
  return hits;
}

async function seedShelf(names: string[]) {
  let t = 1_000;
  for (const name of names) await createBook(name, null, (t += 10));
  return t;
}

function positions(books: readonly Book[]) {
  return new Map(books.map((b) => [b.id as string, b.shelfPosition]));
}

describe.each(["throw", "reject"] as const)(
  "createBook: a failed renumber put aborts the transaction (#1369), %s",
  (mode) => {
    // The throw shape is our own Error; the reject shape is the DOMException
    // the request failed with, matched by its `name`, not by the engine's
    // English message.
    const expectFailure = (p: Promise<unknown>) =>
      mode === "throw"
        ? expect(p).rejects.toThrow("injected put failure")
        : expect(p).rejects.toMatchObject({ name: "ConstraintError" });

    it("leaves the shelf order and every row exactly as before", async () => {
      const t = await seedShelf(["A", "B", "C"]);
      const before = await listBooks();
      expect(before.map((b) => b.name)).toEqual(["C", "B", "A"]);

      // The target is the middle existing row. How many writes came before it
      // in the transaction is not asserted.
      const target = before[1]!;
      const hits = failRenumberPut(target.id, positions(before), mode);
      await expectFailure(createBook("D", null, t + 10));
      vi.restoreAllMocks();

      expect(hits).toHaveLength(1);
      expect(await listBooks()).toEqual(before);
    });

    it("does not leave the new book behind when the first renumber put fails", async () => {
      const t = await seedShelf(["A"]);
      const before = await listBooks();

      const hits = failRenumberPut(before[0]!.id, positions(before), mode);
      await expectFailure(createBook("B", null, t + 10));
      vi.restoreAllMocks();

      expect(hits).toHaveLength(1);
      const after = await listBooks();
      expect(after).toEqual(before);
      expect(after.map((b) => b.name)).not.toContain("B");
    });
  }
);

it("failRenumberPut passes a non-object put through to the real put", async () => {
  failRenumberPut("none", new Map(), "throw");
  try {
    const db = await getDb();
    const store = db.transaction("books", "readwrite").objectStore("books");
    // The real put throws a DataError synchronously for a null value; a spy
    // that cast first would throw a TypeError instead.
    expect(() => store.put(null as never)).toThrow(
      expect.objectContaining({ name: "DataError" })
    );
  } finally {
    vi.restoreAllMocks();
  }
});
