import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBook, listBooks } from "@/lib/storage/books";
import { clearAllStores } from "./support";

/**
 * `createBook` writes the new row and renumbers the shelf in ONE readwrite
 * transaction (#338), so a `put` that throws partway through the renumber must
 * abort it, as `moveBook` does: the shelf stays exactly as it was and no
 * half-created book is left behind (#1369).
 */

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

/** Let the first `okCalls` puts through, then throw on every later one. */
function failPutAfter(okCalls: number) {
  const real = IDBObjectStore.prototype.put;
  let calls = 0;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    calls++;
    if (calls > okCalls) throw new Error("injected put failure");
    return real.apply(this, args);
  });
}

describe("createBook: a failed renumber put aborts the transaction (#1369)", () => {
  it("leaves the shelf order and every row exactly as before", async () => {
    let t = 1_000;
    await createBook("A", null, (t += 10));
    await createBook("B", null, (t += 10));
    await createBook("C", null, (t += 10));
    const before = await listBooks();
    expect(before.map((b) => b.name)).toEqual(["C", "B", "A"]);

    // Put 1 is the new book, put 2 the first renumbered row; put 3 throws.
    failPutAfter(2);
    await expect(createBook("D", null, (t += 10))).rejects.toThrow(
      "injected put failure"
    );
    vi.restoreAllMocks();

    expect(await listBooks()).toEqual(before);
  });

  it("does not leave the new book behind when the first renumber put throws", async () => {
    let t = 1_000;
    await createBook("A", null, (t += 10));
    const before = await listBooks();

    failPutAfter(1);
    await expect(createBook("B", null, (t += 10))).rejects.toThrow(
      "injected put failure"
    );
    vi.restoreAllMocks();

    const after = await listBooks();
    expect(after).toEqual(before);
    expect(after.map((b) => b.name)).not.toContain("B");
  });
});
