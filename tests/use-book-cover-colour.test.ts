import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { performSetCoverColour } from "@/hooks/use-book-cover-colour";
import { createBook, getBook } from "@/lib/storage/books";
import * as booksStore from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import type { BookId } from "@/types/domain";

/**
 * `performSetCoverColour` is the whole of #957's hook minus React — the
 * in-flight guard and `settingCoverColour` state `useBookCoverColour` adds are
 * plain `useRef`/`useState` over this, the same split `use-erase-segment.ts`
 * draws and the same reason: this file proves the call actually reaches the
 * real store and maps its outcome; the guard itself would need a jsdom mount
 * to exercise, which is out of scope for a lane that mounts nothing on screen
 * (#957 item 6).
 */

vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    setBookCoverColour: vi.fn(actual.setBookCoverColour),
  };
});

beforeEach(async () => {
  // Clear every store rather than deleting the database (AGENTS.md, mirrored
  // from tests/storage.test.ts and tests/use-erase-segment.test.ts).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  vi.mocked(booksStore.setBookCoverColour).mockClear();
});

describe("performSetCoverColour", () => {
  it("writes the colour through to the real store", async () => {
    const book = await createBook("Mark");

    const result = await performSetCoverColour(book.id, "forest");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.coverColourKey).toBe("forest");
    expect((await getBook(book.id))?.coverColourKey).toBe("forest");
  });

  it("clears the colour with null", async () => {
    const book = await createBook("Mark");
    await performSetCoverColour(book.id, "forest");

    const result = await performSetCoverColour(book.id, null);

    expect(result.ok).toBe(true);
    expect((await getBook(book.id))?.coverColourKey).toBeNull();
  });

  it("catches a store rejection and maps it to the saveFailed KEY — never the raw store message (#172)", async () => {
    const bogus = "not-a-real-book" as BookId;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await performSetCoverColour(bogus, "forest");

    expect(result).toEqual({ ok: false, key: "saveFailed" });
    if (!result.ok)
      expect(JSON.stringify(result)).not.toContain("No such book");
    // Console keeps its own row, alongside `reportFailure`'s internal one
    // (#456) — the same doubling `performErase`'s identical test pins.
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("maps a quota-exceeded store rejection to the noRoom KEY, not saveFailed (#172)", async () => {
    const book = await createBook("Mark");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(booksStore.setBookCoverColour).mockRejectedValueOnce(
      Object.assign(new Error("disk full"), { name: "QuotaExceededError" })
    );

    const result = await performSetCoverColour(book.id, "forest");

    expect(result).toEqual({ ok: false, key: "noRoom" });
    consoleError.mockRestore();
  });

  it('reports a store rejection to the funnel once, under "book-cover-colour" (#957, following #456\'s precedent)', async () => {
    const bogus = "not-a-real-book" as BookId;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performSetCoverColour(bogus, "forest");

    off();
    consoleError.mockRestore();
    expect(reports.map((r) => r.context)).toEqual(["book-cover-colour"]);
  });

  it("reports nothing to the funnel on a successful write", async () => {
    const book = await createBook("Mark");
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performSetCoverColour(book.id, "forest");

    off();
    expect(reports).toEqual([]);
  });
});
