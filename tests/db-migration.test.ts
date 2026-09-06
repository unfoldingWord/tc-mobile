import "fake-indexeddb/auto";

import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/lib/storage/db";

// db.ts keeps DB_NAME private; a migration test necessarily knows the name it
// is migrating. Kept in sync by hand — there is nothing else to key it off.
const DB_NAME = "tc-mobile";

/**
 * Delete the database outright so each test starts from a true fresh install.
 *
 * Never resolve on `onblocked`: a silent pass there would carry a prior
 * database forward, and the v2→v3 transition — the whole point of this file —
 * would never actually run.
 */
async function wipe(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

/**
 * Stand up the pre-pivot v2 database with the OLD schema exactly as it shipped:
 * `projects`/`chapters`/`sections`/`segments`/`takes`/`clipMeta`/`clipData`,
 * the section-shaped indexes, and the empty `media` store added at v2. This is
 * a raw `openDB` at version 2 on purpose — going through `getDb` would open v3
 * and the transition under test would never be exercised.
 */
async function openLegacyV2() {
  return openDB(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("projects", { keyPath: "id" });
        const chapters = db.createObjectStore("chapters", { keyPath: "id" });
        chapters.createIndex("projectId", "projectId");
        const sections = db.createObjectStore("sections", { keyPath: "id" });
        sections.createIndex("chapterId", "chapterId");
        const segments = db.createObjectStore("segments", { keyPath: "id" });
        segments.createIndex("sectionId", "sectionId");
        const takes = db.createObjectStore("takes", { keyPath: "id" });
        takes.createIndex("segmentId", "segmentId");
        db.createObjectStore("clipMeta", { keyPath: "id" });
        db.createObjectStore("clipData");
      }
      if (oldVersion < 2) {
        db.createObjectStore("media", { keyPath: "url" });
      }
    },
  });
}

/**
 * Stand up the PIVOT schema exactly as v3 shipped it (B1), with a `clipMeta` row
 * in its v3 shape — no `encoding`, `generation`, `byteLength` or `peaks`. This is
 * what a dev device that recorded on v0.1.x holds when B8's v4 opens it.
 */
async function openLegacyV3() {
  return openDB(DB_NAME, 3, {
    upgrade(db) {
      db.createObjectStore("books", { keyPath: "id" });
      const chapters = db.createObjectStore("chapters", { keyPath: "id" });
      chapters.createIndex("bookId", "bookId");
      const segments = db.createObjectStore("segments", { keyPath: "id" });
      segments.createIndex("chapterId", "chapterId");
      const takes = db.createObjectStore("takes", { keyPath: "id" });
      takes.createIndex("segmentId", "segmentId");
      db.createObjectStore("clipMeta", { keyPath: "id" });
      db.createObjectStore("clipData");
    },
  });
}

/**
 * Stand up the schema exactly as v4 shipped it (B8): `books` rows have no
 * `provenance` field yet. This is what a dev device that recorded on v0.1.x
 * (post-B8, pre-#253) holds when #253's v5 opens it.
 */
async function openLegacyV4() {
  return openDB(DB_NAME, 4, {
    upgrade(db) {
      db.createObjectStore("books", { keyPath: "id" });
      const chapters = db.createObjectStore("chapters", { keyPath: "id" });
      chapters.createIndex("bookId", "bookId");
      const segments = db.createObjectStore("segments", { keyPath: "id" });
      segments.createIndex("chapterId", "chapterId");
      const takes = db.createObjectStore("takes", { keyPath: "id" });
      takes.createIndex("segmentId", "segmentId");
      db.createObjectStore("clipMeta", { keyPath: "id" });
      db.createObjectStore("clipData");
    },
  });
}

beforeEach(wipe);
afterEach(wipe);

describe("v3 → v4 clip-encoding backfill (append-only resumes)", () => {
  it("keeps every v3 row and stamps each clip as generation-0 PCM", async () => {
    const v3 = await openLegacyV3();
    await v3.put("books", {
      id: "b1",
      name: "Book 001",
      languageCode: null,
      chapterIds: [],
      createdAt: 0,
      updatedAt: 0,
    });
    await v3.put("clipMeta", {
      id: "c1",
      sampleRate: 44100,
      frameCount: 10,
      durationMs: 1,
      createdAt: 7,
    });
    const pcm = Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await v3.put("clipData", pcm.buffer, "c1");
    v3.close();

    // getDb() opens at the CURRENT DB_VERSION, so a v3 device jumps straight
    // through every intervening additive step (v4's clip backfill, #253's v5
    // provenance backfill) in one open — exercising them run in sequence, not
    // in isolation, is itself part of what "append-only" has to hold up under.
    const db = await getDb();
    expect(db.version).toBe(5);

    // Nothing was dropped: the append-only discipline ADR 0008 promised from v3
    // onward. A v3 device's recordings come through, and the v5 step (#253)
    // backfilled the book with the "no template" provenance.
    const book = await db.get("books", "b1" as never);
    expect(book?.name).toBe("Book 001");
    expect(book?.provenance).toBeNull();
    const data = await db.get("clipData", "c1" as never);
    expect(Array.from(new Int16Array(data!))).toEqual(Array.from(pcm));

    // The row is stamped as the PCM it already was, its v3 fields untouched.
    const meta = await db.get("clipMeta", "c1" as never);
    expect(meta).toEqual({
      id: "c1",
      sampleRate: 44100,
      frameCount: 10,
      durationMs: 1,
      createdAt: 7,
      encoding: "pcm",
      generation: 0,
      byteLength: 20,
      peaks: null,
    });
  });

  it("leaves a clip that already carries an encoding alone", async () => {
    // The backfill keys on the field being ABSENT, so re-running it (or a row
    // written by a newer build before an older one reopened the database) is
    // not re-stamped back to PCM/0.
    const v3 = await openLegacyV3();
    await v3.put("clipMeta", {
      id: "c2",
      sampleRate: 44100,
      frameCount: 10,
      durationMs: 1,
      createdAt: 0,
      encoding: "mp3",
      generation: 2,
      byteLength: 5,
      peaks: null,
    });
    v3.close();

    const v4 = await getDb();
    const meta = await v4.get("clipMeta", "c2" as never);
    expect(meta?.encoding).toBe("mp3");
    expect(meta?.generation).toBe(2);
    expect(meta?.byteLength).toBe(5);
  });
});

describe("v4 → v5 Book.provenance backfill (#253, append-only continues)", () => {
  it("stamps every pre-existing book provenance: null, and leaves everything else untouched", async () => {
    const v4 = await openLegacyV4();
    await v4.put("books", {
      id: "b1",
      name: "Book 001",
      languageCode: "en",
      chapterIds: ["c1"],
      createdAt: 5,
      updatedAt: 9,
    }); // no `provenance` field — the pre-v5 shape
    v4.close();

    const v5 = await getDb();
    expect(v5.version).toBe(5);

    const book = await v5.get("books", "b1" as never);
    expect(book).toEqual({
      id: "b1",
      name: "Book 001",
      languageCode: "en",
      chapterIds: ["c1"],
      createdAt: 5,
      updatedAt: 9,
      provenance: null,
    });
  });

  it("leaves a book that already carries provenance alone", async () => {
    // Keys on the field being ABSENT, so re-running it (or a row written by a
    // newer build before an older one reopened the database) is not
    // re-stamped back to null over a real provenance value.
    const v4 = await openLegacyV4();
    await v4.put("books", {
      id: "b2",
      name: "Ruth 001",
      languageCode: null,
      provenance: { kind: "scripture", book: "RUT" },
      chapterIds: [],
      createdAt: 0,
      updatedAt: 0,
    });
    v4.close();

    const v5 = await getDb();
    const book = await v5.get("books", "b2" as never);
    expect(book?.provenance).toEqual({ kind: "scripture", book: "RUT" });
  });
});

describe("v2 → v3 destructive recreate", () => {
  it("recreates the pivot schema and drops the pre-pivot stores + data", async () => {
    // A real v2 database with data in it, so v3 has something to destroy.
    const v2 = await openLegacyV2();
    await v2.put("projects", {
      id: "p1",
      name: "x",
      languageCode: null,
      chapterIds: [],
      createdAt: 0,
      updatedAt: 0,
    });
    await v2.put("clipMeta", {
      id: "c1",
      sampleRate: 44100,
      frameCount: 10,
      durationMs: 1,
      createdAt: 0,
    });
    await v2.put("clipData", new ArrayBuffer(20), "c1");
    await v2.put("takes", {
      id: "t1",
      segmentId: "s1",
      clipId: "c1",
      createdAt: 0,
      durationMs: 1,
    });
    v2.close();

    // Reopen through the app's getDb — this triggers the v3 recreate (and the
    // v4 backfill after it, over stores the recreate has just emptied).
    const v3 = await getDb();
    const stores = Array.from(v3.objectStoreNames);

    // The pivot stores exist; the pre-pivot ones are gone.
    expect(stores).toContain("books");
    expect(stores).not.toContain("projects");
    expect(stores).not.toContain("sections");
    expect(stores).not.toContain("media");

    // `segments` is re-indexed by chapterId (was sectionId); `chapters` by
    // bookId (was projectId) — segments now hang off the chapter directly.
    const segIndexes = Array.from(v3.transaction("segments").store.indexNames);
    expect(segIndexes).toEqual(["chapterId"]);
    expect(v3.transaction("segments").store.index("chapterId").keyPath).toBe(
      "chapterId"
    );
    expect(v3.transaction("chapters").store.index("bookId").keyPath).toBe(
      "bookId"
    );

    // Destructive ON PURPOSE: the v2→v3 upgrade is a one-time pre-alpha wipe,
    // not a data-preserving migration (ADR 0008, DRI decision). This asserts the
    // intended behaviour for a schema with no field data — it is not an
    // endorsement of data loss as a pattern; append-only resumes from v3.
    expect(await v3.getAll("clipMeta")).toEqual([]);
    expect(await v3.count("takes")).toBe(0);
  });
});
