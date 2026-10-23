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
 * simulate the throw (the fourth `books` write fails; for v12 and v13, which
 * write through cursors, the fourth `segments` cursor update) and pin the guard: the
 * transaction aborts, the stored version stays where it was, nothing is
 * half-written, and the next open — with the fault gone — upgrades cleanly.
 *
 * Both old shelves are built by a raw `openDB` at the old version, not through
 * `getDb`, which would open the new one and never run the step under test.
 */

const DB_NAME = "tc-mobile";
const APP_VERSION = 14;

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

/** The two stores v12 adds, as v12 created them. */
function createV12Stores(db: Awaited<ReturnType<typeof openDB>>): void {
  db.createObjectStore("tombstones", { autoIncrement: true });
  db.createObjectStore("pendingTakes", { keyPath: "segmentId" });
}

/** A clip that is on the old shelf before the upgrade runs. */
const CLIP_KEY = "c-old";
const CLIP_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
/** A clip the upgrade itself writes just before it fails. */
const PARTIAL_CLIP_KEY = "c-written-by-the-failed-upgrade";

const SEED = [
  ["b1", "Book 001", 10],
  ["b2", "Mark", 60],
  ["b3", "Book 2", 30],
  ["b4", "Luke", 50],
  ["b5", "Book 003", 20],
  ["b6", "John", 40],
] as const;

/** The shelf order 1.0.x showed SEED in: newest first. */
const SHELF_ORDER = ["b2", "b4", "b6", "b3", "b5", "b1"];

/**
 * A shelf at `version` (9: placeholder names, no slot; 10: slots, no position;
 * 11: slots and positions, none of the v12 fields; 12: every v12 field and
 * store, no `audioRevision`).
 */
async function seed(version: 9 | 10 | 11 | 12) {
  const db = await openDB(DB_NAME, version, {
    upgrade(upgrading) {
      createStores(upgrading);
      if (version === 12) createV12Stores(upgrading);
    },
  });
  const v12Book =
    version === 12
      ? { provenance: { kind: "blank" }, licence: null, modifiedAt: null }
      : {};
  const v12Row =
    version === 12
      ? { createdAt: null, modifiedAt: null, templateKey: null }
      : {};
  for (const [id, name, createdAt] of SEED) {
    await db.put("books", {
      id,
      name: version === 9 ? name : name.startsWith("Book 0") ? null : name,
      ...(version >= 10 ? { number: Number(id.slice(1)) } : {}),
      ...(version >= 11 ? { shelfPosition: SHELF_ORDER.indexOf(id) } : {}),
      languageCode: null,
      chapterIds: [`${id}-ch1`],
      createdAt,
      updatedAt: createdAt,
      coverColourKey: null,
      ...v12Book,
    });
    await db.put("chapters", {
      id: `${id}-ch1`,
      bookId: id,
      number: 1,
      name: null,
      segmentIds: [`${id}-s1`],
      ...v12Row,
    });
    await db.put("segments", {
      id: `${id}-s1`,
      chapterId: `${id}-ch1`,
      index: 1,
      reference: null,
      label: null,
      activeTakeId: null,
      status: "not-started",
      ...v12Row,
    });
  }
  await db.put("clipData", CLIP_BYTES.slice().buffer, CLIP_KEY);
  const books = await db.getAll("books");
  const chapters = await db.getAll("chapters");
  const segments = await db.getAll("segments");
  db.close();
  return { books, chapters, segments };
}

/** The version on disk and the rows, read without upgrading anything. */
async function readRaw() {
  const db = await openDB(DB_NAME);
  const read = {
    version: db.version,
    books: await db.getAll("books"),
    chapters: await db.getAll("chapters"),
    segments: await db.getAll("segments"),
    clipKeys: (await db.getAllKeys("clipData")).map(String),
    clipBytes: Array.from(
      new Uint8Array((await db.get("clipData", CLIP_KEY)) as ArrayBuffer)
    ),
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
      // A clip byte write lands in the same `versionchange` transaction just
      // before the failure, so rolling it back is what the abort must do.
      this.transaction
        .objectStore("clipData")
        .put(new Uint8Array([9, 9, 9]).buffer, PARTIAL_CLIP_KEY);
      throw new Error("simulated fault inside the upgrade");
    }
    return realPut.apply(this, args);
  });
}

/**
 * Make the Nth `books` write fail as a REQUEST (a duplicate-key `add`, which
 * fails with a ConstraintError the way a refused write does), not as a thrown
 * error. IndexedDB aborts the transaction by itself on a failed request.
 * Simulated on fake-indexeddb; a real engine's quota path is not exercised.
 */
function failBooksRequestAt(nth: number) {
  const realPut = IDBObjectStore.prototype.put;
  let calls = 0;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === "books" && ++calls === nth) {
      this.transaction
        .objectStore("clipData")
        .put(new Uint8Array([9, 9, 9]).buffer, PARTIAL_CLIP_KEY);
      return this.add({ id: "b1" });
    }
    return realPut.apply(this, args);
  });
}

/**
 * The v12 step writes through cursors, not `put`, so its fault is on the Nth
 * `segments` cursor update (#1462, M6): the book and chapter rows v12 has
 * already stamped by then must roll back with it.
 */
function failSegmentsUpdateAt(nth: number, asRequest: boolean) {
  const realUpdate = IDBCursor.prototype.update;
  let calls = 0;
  return vi.spyOn(IDBCursor.prototype, "update").mockImplementation(function (
    this: IDBCursor,
    ...args
  ) {
    const store = this.source as IDBObjectStore;
    if (store.name === "segments" && ++calls === nth) {
      store.transaction
        .objectStore("clipData")
        .put(new Uint8Array([9, 9, 9]).buffer, PARTIAL_CLIP_KEY);
      if (asRequest) return store.add({ id: this.primaryKey });
      throw new Error("simulated fault inside the upgrade");
    }
    return realUpdate.apply(this, args);
  });
}

/** The fault for the step that `from` runs first: a book pass, or v12/v13. */
function failAt(from: 9 | 10 | 11 | 12, nth: number) {
  return from >= 11 ? failSegmentsUpdateAt(nth, false) : failBooksPutAt(nth);
}
function failRequestAt(from: 9 | 10 | 11 | 12, nth: number) {
  return from >= 11 ? failSegmentsUpdateAt(nth, true) : failBooksRequestAt(nth);
}

/** The keys v12 adds to a chapter or segment row, each backfilled null. */
const V12_ROW_KEYS = ["createdAt", "modifiedAt", "templateKey"];

beforeEach(wipe);
afterEach(async () => {
  vi.restoreAllMocks();
  await wipe();
});

describe.each([
  { from: 9 as const, step: "v10 (placeholder slots)" },
  { from: 10 as const, step: "v11 (shelf position)" },
  { from: 11 as const, step: "v12" },
  { from: 12 as const, step: "v13" },
])("a throw inside the $step upgrade", ({ from }) => {
  it("rejects the open with the thrown error and leaves the old version and every row as they were", async () => {
    const before = await seed(from);
    failAt(from, 4);

    await expect(getDb()).rejects.toThrow("simulated fault inside the upgrade");

    vi.restoreAllMocks();
    expect(await readRaw()).toEqual({
      version: from,
      ...before,
      clipKeys: [CLIP_KEY],
      clipBytes: Array.from(CLIP_BYTES),
    });
  });

  it("opens and migrates cleanly on the next try, once the fault is gone", async () => {
    const before = await seed(from);
    failAt(from, 4);
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
    expect((await listBooks()).map((b) => b.id)).toEqual(SHELF_ORDER);
    // Every v12 step ran on the retry: each book got its blank provenance,
    // and each chapter and segment its three null fields and nothing else.
    for (const row of rows) {
      expect(row.provenance).toEqual({ kind: "blank" });
      expect(row.licence).toBeNull();
      expect(row.modifiedAt).toBeNull();
    }
    const v12Fields = Object.fromEntries(V12_ROW_KEYS.map((k) => [k, null]));
    expect(await db.getAll("chapters")).toEqual(
      before.chapters.map((c) => ({ ...c, ...v12Fields }))
    );
    // And v13 gave each segment its revision, 0, and nothing else.
    expect(await db.getAll("segments")).toEqual(
      before.segments.map((s) => ({ ...s, ...v12Fields, audioRevision: 0 }))
    );
    // The clip that was already there is untouched; the one the failed
    // attempt wrote never existed.
    expect((await db.getAllKeys("clipData")).map(String)).toEqual([CLIP_KEY]);
    expect(
      Array.from(new Uint8Array((await db.get("clipData", CLIP_KEY as never))!))
    ).toEqual(Array.from(CLIP_BYTES));
  });

  it("a FAILED REQUEST inside the upgrade (it aborts the transaction itself) rejects with that error and changes nothing", async () => {
    const before = await seed(from);
    failRequestAt(from, 4);

    await expect(getDb()).rejects.toMatchObject({ name: "ConstraintError" });

    vi.restoreAllMocks();
    expect(await readRaw()).toEqual({
      version: from,
      ...before,
      clipKeys: [CLIP_KEY],
      clipBytes: Array.from(CLIP_BYTES),
    });
  });
});

/**
 * Make the Nth `books` write fail only AFTER the `versionchange` transaction
 * has committed: the write returns a promise (not a request) that rejects
 * `delayMs` after the transaction's `complete` (at once when 0), so nothing
 * keeps the transaction open while the step waits on it. With a delay, the
 * native open has already succeeded by the time the step fails. No current
 * step can do this (each awaits IDB requests only); it stands in for a step
 * that awaits something that is not IndexedDB.
 */
function failBooksPutAfterCommitAt(nth: number, delayMs: number) {
  const realPut = IDBObjectStore.prototype.put;
  let calls = 0;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === "books" && ++calls === nth) {
      const tx = this.transaction;
      return new Promise((_, reject) => {
        const fail = () =>
          reject(new Error("simulated fault after the upgrade committed"));
        tx.addEventListener("complete", () => {
          if (delayMs === 0) fail();
          else setTimeout(fail, delayMs);
        });
      }) as unknown as IDBRequest<IDBValidKey>;
    }
    return realPut.apply(this, args);
  });
}

describe.each([
  { delayMs: 0, when: "on the transaction's complete" },
  { delayMs: 25, when: "after the native open succeeded" },
])("a fault that surfaces $when", ({ delayMs }) => {
  it("closes the connection and rejects the open with the fault, rather than opening a half-migrated database", async () => {
    await seed(9);
    failBooksPutAfterCommitAt(4, delayMs);
    const close = vi.spyOn(IDBDatabase.prototype, "close");

    await expect(getDb()).rejects.toThrow(
      "simulated fault after the upgrade committed"
    );
    // The connection the open produced is closed, not left holding the
    // database with nothing referring to it.
    expect(close).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
    // The commit itself cannot be undone from the open: the version moved.
    // That is what the rejection reports.
    expect((await readRaw()).version).toBe(APP_VERSION);
  });
});
