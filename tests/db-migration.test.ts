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

beforeEach(wipe);
afterEach(wipe);

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

    // Reopen through the app's getDb — this triggers the v3 upgrade.
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

    // Destructive: the seeded v2 rows are gone, not migrated.
    expect(await v3.getAll("clipMeta")).toEqual([]);
    expect(await v3.count("takes")).toBe(0);
  });
});
