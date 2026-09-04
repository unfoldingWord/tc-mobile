import "fake-indexeddb/auto";

import { forceCloseDatabase } from "fake-indexeddb";
import { openDB, unwrap, type IDBPDatabase } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/lib/storage/db";

// db.ts keeps DB_NAME/DB_VERSION private; a lifecycle test necessarily knows
// the name and the version the app requests. Kept in sync by hand — there is
// nothing else to key them off. (Mirrors tests/db-migration.test.ts.)
const DB_NAME = "tc-mobile";
const APP_VERSION = 4;

/**
 * Delete the database outright so each case starts from a true fresh install,
 * AND — the reason these cases cannot reset by clearing object stores — so the
 * version on disk is reset. Several cases here push the stored version ABOVE the
 * app's (to force a downgrade) or open extra versions (to force a block);
 * clearing stores leaves that version behind, and the next case's `getDb()`
 * would misbehave. Deletion is safe here for the same reason it is in
 * db-migration.test.ts: every connection is closed first, and `onblocked`
 * REJECTS loudly rather than silently carrying a prior database forward.
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Push the stored version ABOVE the app's, to force a downgrade on the next
 * `getDb()`. The app rejects before it ever runs an upgrade, so the store list
 * is irrelevant here — none is created.
 */
function openNewerThanApp(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, APP_VERSION + 1);
}

/**
 * Stand up the real v3 pivot schema and KEEP the connection open, so the app's
 * v4 open is blocked by it. It must be the real v3 shape (not an empty DB): once
 * this connection closes, the app's blocked open proceeds and runs the genuine
 * v3→v4 backfill, which reads the `clipMeta` store v3 created.
 */
function openLegacyV3Open(): Promise<IDBPDatabase> {
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

beforeEach(wipe);
afterEach(wipe);

describe("getDb — blocked open (an older connection elsewhere)", () => {
  it("rejects with a blocked error instead of hanging on 'Loading your books.'", async () => {
    // An older connection is still open (another tab, or the pre-update page
    // after an autoUpdate SW swap). It never yields, so the app's v4 open cannot
    // upgrade past it.
    const stale = await openLegacyV3Open();
    try {
      // Race the open against a timeout: unhandled, `blocked` leaves the open
      // pending forever, so a plain `await` here would hang the suite. This lets
      // the RED run assert cleanly on the timeout instead of timing out.
      const outcome = await Promise.race<unknown>([
        getDb().then(
          () => "opened",
          (cause: unknown) => cause
        ),
        delay(200).then(() => "timeout"),
      ]);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).name).toBe("DatabaseBlockedError");
    } finally {
      // Close the blocker so the app's (pending or orphaned) open can settle,
      // then drop the app handle, so afterEach's deleteDatabase is not blocked.
      stale.close();
      await closeDb();
    }
  });

  it("does not cache the blocked rejection: retry opens once the blocker closes", async () => {
    const stale = await openLegacyV3Open();
    // First attempt is blocked and rejects.
    const first = await getDb().then(
      () => "opened",
      (cause: unknown) => cause
    );
    expect((first as Error).name).toBe("DatabaseBlockedError");

    // The other copy closes; a retry must open cleanly rather than replay the
    // cached rejection.
    stale.close();
    await delay(0);
    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    await closeDb();
  });
});

describe("getDb — version downgrade (stored data is newer than this build)", () => {
  it("rejects with a downgrade error rather than an opaque VersionError", async () => {
    // A newer build already wrote v5 on this device; this (older) build asks for
    // v4. IndexedDB refuses with a VersionError — deleting to 'fix' it would
    // destroy the newer build's recordings, so the open must fail deliberately.
    const newer = await openNewerThanApp();
    newer.close();

    const cause = await getDb().then(
      () => null,
      (e: unknown) => e
    );
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).name).toBe("DatabaseDowngradeError");
    // The message is what the Books-screen Notice shows; keep it human.
    expect((cause as Error).message).toMatch(/older than the data/i);
  });

  it("does not cache the rejected open: once the newer data is gone, getDb reopens", async () => {
    const newer = await openNewerThanApp();
    newer.close();

    // First open rejects (downgrade).
    await expect(getDb()).rejects.toBeInstanceOf(Error);

    // The newer database is removed (e.g. the newer app cleared its data, or a
    // fresh device). Delete it directly rather than via `wipe()`: `closeDb()`
    // clears the cached handle too, which would mask a getDb that failed to
    // clear its own rejected promise. This way only getDb's own recovery can
    // make the retry below succeed.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("deleteDatabase blocked"));
    });

    // A cached rejected promise would keep failing forever; the open must
    // recover on the next call without a page reload.
    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    await closeDb();
  });
});

describe("getDb — the browser terminates the connection", () => {
  it("drops the dead handle so the next getDb reopens a live one", async () => {
    const first = await getDb();
    expect(first.version).toBe(APP_VERSION);

    // Simulate the UA abnormally closing the connection (resource pressure, a
    // discarded tab): fake-indexeddb's forceCloseDatabase fires the raw db's
    // 'close' event, which is exactly what idb's `terminated` listens for.
    // `unwrap` returns the raw FDBDatabase idb wired 'close' onto;
    // fake-indexeddb's own type for this helper mis-declares the parameter as
    // the constructor rather than an instance, so cast through `never`.
    forceCloseDatabase(unwrap(first) as never);
    await delay(0);

    // Without a terminated handler the cache still holds the dead connection and
    // this read throws (InvalidStateError). With it, getDb reopens a live one and
    // the read completes.
    const second = await getDb();
    await expect(
      second.get("clipMeta", "absent" as never)
    ).resolves.toBeUndefined();
    await closeDb();
  });
});
