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
 * Stand up the v4 schema (the v3 pivot stores — v4 added no store, only the
 * clip-encoding backfill). A chapter row written here has NO `name`, which is
 * exactly what a device that recorded on v0.1.x holds when #264's v5 opens it.
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

describe("v4 → v5 chapter-name backfill (append-only)", () => {
  it("stamps a pre-existing nameless chapter with name: null, keeping its data", async () => {
    const v4 = await openLegacyV4();
    await v4.put("chapters", {
      id: "ch1",
      bookId: "b1",
      number: 6,
      segmentIds: ["s1", "s2"],
    });
    v4.close();

    const v5 = await getDb();
    expect(v5.version).toBe(5);

    const chapter = await v5.get("chapters", "ch1" as never);
    // The field is now present and null — never undefined — and every other
    // field is untouched (ordinal, parent, segment order all come through).
    expect(chapter).toEqual({
      id: "ch1",
      bookId: "b1",
      number: 6,
      segmentIds: ["s1", "s2"],
      name: null,
    });
  });

  it("leaves a chapter that already carries a name alone", async () => {
    // Keys on the field being ABSENT, so a row written by a newer build before
    // an older one reopened the database is not clobbered back to null.
    const v4 = await openLegacyV4();
    await v4.put("chapters", {
      id: "ch2",
      bookId: "b1",
      number: 6,
      segmentIds: [],
      name: "Mark 6",
    });
    v4.close();

    const v5 = await getDb();
    expect((await v5.get("chapters", "ch2" as never))?.name).toBe("Mark 6");
  });
});

describe("v3 → v5 chapter-name backfill over a real row", () => {
  it("stamps a v3 nameless chapter with name: null on the way to v5, keeping its data", async () => {
    // The existing v4→v5 test writes its chapter into a v4 database; the v3 path
    // only ever ran over an EMPTY chapters store (G-P3.5). A device that recorded
    // on the v3 pivot build holds nameless chapter rows and jumps v3→v5 in one
    // open — the v4 clip backfill and the v5 chapter backfill both run on the way
    // up. This pins that the chapter row survives and gains name: null.
    const v3 = await openLegacyV3();
    await v3.put("chapters", {
      id: "ch1",
      bookId: "b1",
      number: 3,
      segmentIds: ["s1", "s2"],
    });
    v3.close();

    const v5 = await getDb();
    expect(v5.version).toBe(5);

    const chapter = await v5.get("chapters", "ch1" as never);
    expect(chapter).toEqual({
      id: "ch1",
      bookId: "b1",
      number: 3,
      segmentIds: ["s1", "s2"],
      name: null,
    });
  });
});

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

    const v4 = await getDb();
    // getDb now opens v5; the v4 clip-encoding backfill still runs on the way
    // up (oldVersion < 4), and the v5 chapter backfill no-ops over the empty
    // chapters store.
    expect(v4.version).toBe(5);

    // Nothing was dropped: the append-only discipline ADR 0008 promised from v3
    // onward. A v3 device's recordings come through.
    expect((await v4.get("books", "b1" as never))?.name).toBe("Book 001");
    const data = await v4.get("clipData", "c1" as never);
    expect(Array.from(new Int16Array(data!))).toEqual(Array.from(pcm));

    // The row is stamped as the PCM it already was, its v3 fields untouched.
    const meta = await v4.get("clipMeta", "c1" as never);
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
