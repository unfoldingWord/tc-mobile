import "fake-indexeddb/auto";

import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listBooks } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * A JavaScript error thrown part-way through the `upgrade` callback (#1421).
 *
 * `idb` does not await the async callback, so before the guard in `db.ts` a
 * throw left the `versionchange` transaction to commit what it had written, at
 * the NEW version: the steps that had not run never ran again. These cases
 * simulate the throw (the fourth `books` write fails) and pin the guard: the
 * transaction aborts, the stored version stays where it was, nothing is
 * half-written, and the next open — with the fault gone — upgrades cleanly.
 *
 * Both old shelves are built by a raw `openDB` at the old version, not through
 * `getDb`, which would open the new one and never run the step under test.
 */

const DB_NAME = "tc-mobile";
const APP_VERSION = 11;

async function wipe(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

function createStores(db: Awaited<ReturnType<typeof openDB>>): void {
  db.createObjectStore("books", { keyPath: "id" });
  const chapters = db.createObjectStore("chapters", { keyPath: "id" });
  chapters.createIndex("bookId", "bookId");
  const segments = db.createObjectStore("segments", { keyPath: "id" });
  segments.createIndex("chapterId", "chapterId");
  const takes = db.createObjectStore("takes", { keyPath: "id" });
  takes.createIndex("segmentId", "segmentId");
  db.createObjectStore("clipMeta", { keyPath: "id" });
  db.createObjectStore("clipData");
  db.createObjectStore("failures", { autoIncrement: true });
}

const SEED = [
  ["b1", "Book 001", 10],
  ["b2", "Mark", 60],
  ["b3", "Book 2", 30],
  ["b4", "Luke", 50],
  ["b5", "Book 003", 20],
  ["b6", "John", 40],
] as const;

/** A shelf at `version` (9: placeholder names, no slot; 10: slots, no position). */
async function seed(version: 9 | 10) {
  const db = await openDB(DB_NAME, version, {
    upgrade(upgrading) {
      createStores(upgrading);
    },
  });
  for (const [id, name, createdAt] of SEED) {
    await db.put("books", {
      id,
      name: version === 9 ? name : name.startsWith("Book 0") ? null : name,
      ...(version === 10 ? { number: Number(id.slice(1)) } : {}),
      languageCode: null,
      chapterIds: [`${id}-ch1`],
      createdAt,
      updatedAt: createdAt,
      coverColourKey: null,
    });
    await db.put("chapters", {
      id: `${id}-ch1`,
      bookId: id,
      number: 1,
      name: null,
      segmentIds: [],
    });
  }
  const books = await db.getAll("books");
  const chapters = await db.getAll("chapters");
  db.close();
  return { books, chapters };
}

/** The version on disk and the rows, read without upgrading anything. */
async function readRaw() {
  const db = await openDB(DB_NAME);
  const read = {
    version: db.version,
    books: await db.getAll("books"),
    chapters: await db.getAll("chapters"),
  };
  db.close();
  return read;
}

/** Make the Nth `books` write fail, as the red team's simulation did. */
function failBooksPutAt(nth: number) {
  const realPut = IDBObjectStore.prototype.put;
  let calls = 0;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === "books" && ++calls === nth) {
      throw new Error("simulated fault inside the upgrade");
    }
    return realPut.apply(this, args);
  });
}

beforeEach(wipe);
afterEach(async () => {
  vi.restoreAllMocks();
  await wipe();
});

describe.each([
  { from: 9 as const, step: "v10 (placeholder slots)" },
  { from: 10 as const, step: "v11 (shelf position)" },
])("a throw inside the $step upgrade", ({ from }) => {
  it("rejects the open with the thrown error and leaves the old version and every row as they were", async () => {
    const before = await seed(from);
    failBooksPutAt(4);

    await expect(getDb()).rejects.toThrow("simulated fault inside the upgrade");

    vi.restoreAllMocks();
    expect(await readRaw()).toEqual({ version: from, ...before });
  });

  it("opens and migrates cleanly on the next try, once the fault is gone", async () => {
    const before = await seed(from);
    failBooksPutAt(4);
    await expect(getDb()).rejects.toThrow();
    vi.restoreAllMocks();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    const rows = await db.getAll("books");
    expect(rows).toHaveLength(SEED.length);
    for (const row of rows) {
      expect(typeof row.number).toBe("number");
      expect(Number.isFinite(row.shelfPosition)).toBe(true);
    }
    expect(rows.map((r) => r.shelfPosition).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    // newest first, as 1.0.x showed it
    expect((await listBooks()).map((b) => b.id)).toEqual([
      "b2",
      "b4",
      "b6",
      "b3",
      "b5",
      "b1",
    ]);
    expect(await db.getAll("chapters")).toEqual(before.chapters);
  });
});
