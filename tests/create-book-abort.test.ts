import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBook, listBooks } from "@/lib/storage/books";
import type { Book } from "@/types/domain";
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
    const row = args[0] as Book;
    const isTarget =
      this.name === "books" &&
      row.id === targetId &&
      priorPositions.get(row.id) !== row.shelfPosition;
    if (!isTarget) return real.apply(this, args);
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
    // The rejection arrives as the DOMException the request failed with.
    const expected =
      mode === "throw"
        ? "injected put failure"
        : /constraint was not satisfied/i;

    it("leaves the shelf order and every row exactly as before", async () => {
      const t = await seedShelf(["A", "B", "C"]);
      const before = await listBooks();
      expect(before.map((b) => b.name)).toEqual(["C", "B", "A"]);

      // The SECOND renumbered row: the new book and the first row are already
      // written in the transaction when this one fails.
      const target = before[1]!;
      const hits = failRenumberPut(target.id, positions(before), mode);
      await expect(createBook("D", null, t + 10)).rejects.toThrow(expected);
      vi.restoreAllMocks();

      expect(hits).toHaveLength(1);
      expect(await listBooks()).toEqual(before);
    });

    it("does not leave the new book behind when the first renumber put fails", async () => {
      const t = await seedShelf(["A"]);
      const before = await listBooks();

      const hits = failRenumberPut(before[0]!.id, positions(before), mode);
      await expect(createBook("B", null, t + 10)).rejects.toThrow(expected);
      vi.restoreAllMocks();

      expect(hits).toHaveLength(1);
      const after = await listBooks();
      expect(after).toEqual(before);
      expect(after.map((b) => b.name)).not.toContain("B");
    });
  }
);
