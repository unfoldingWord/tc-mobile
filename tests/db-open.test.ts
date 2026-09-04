import "fake-indexeddb/auto";

import { forceCloseDatabase } from "fake-indexeddb";
import { openDB, unwrap, type IDBPDatabase } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  await deleteDb();
}

/**
 * Delete the database, REJECTING if the delete is blocked. A block means a
 * connection is still open — which is the assertion in the `closeDb` case
 * below, not an inconvenience to be waited out.
 */
function deleteDb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

/**
 * Record every `indexedDB.open` the process makes, so a case can assert that
 * `getDb()` did NOT open again.
 *
 * That count is the only thing separating "served the connection it already
 * had" from "opened a second one": both hand back a working database, so every
 * other observable is identical. The spy also hands back the request object,
 * which is how a case waits for a blocked open to finish rather than guessing
 * at a delay.
 */
function trackOpens(): {
  requests: IDBOpenDBRequest[];
  restore: () => void;
} {
  const requests: IDBOpenDBRequest[] = [];
  const open = indexedDB.open.bind(indexedDB);
  const spy = vi
    .spyOn(indexedDB, "open")
    .mockImplementation((name: string, version?: number) => {
      const request = open(name, version);
      requests.push(request);
      return request;
    });
  return { requests, restore: () => spy.mockRestore() };
}

/** Resolve once an open request has finished, however it finished. */
function requestSettled(request: IDBOpenDBRequest): Promise<void> {
  return new Promise<void>((resolve) => {
    if (request.readyState === "done") {
      resolve();
      return;
    }
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => resolve());
  });
}

/** The most recent open request the spy saw. */
function lastRequest(requests: IDBOpenDBRequest[]): IDBOpenDBRequest {
  const request = requests.at(-1);
  if (!request) throw new Error("no open request was made");
  return request;
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

describe("getDb — the connection a blocked open finally receives", () => {
  it("is cached rather than closed, so recovery does not pay for a second open", async () => {
    const opens = trackOpens();
    try {
      const stale = await openLegacyV3Open();
      const cause = await getDb().then(
        () => null,
        (e: unknown) => e
      );
      expect((cause as Error).name).toBe("DatabaseBlockedError");

      // The rejected open is still queued: it proceeds the moment the other
      // copy closes, and hands over a live connection to this version.
      const appOpen = lastRequest(opens.requests);
      stale.close();
      await requestSettled(appOpen);
      await delay(0);

      // That connection is the one `getDb()` must hand out. Reopening here is
      // the extra Try again the recovery flow would otherwise need.
      const before = opens.requests.length;
      const db = await getDb();
      expect(opens.requests.length).toBe(before);
      expect(unwrap(db)).toBe(appOpen.result);
      // And it is live, not the closed orphan the connection used to become.
      await expect(
        db.get("clipMeta", "absent" as never)
      ).resolves.toBeUndefined();
      await closeDb();
    } finally {
      opens.restore();
    }
  });

  it("is closed, not cached, when a retry already holds the cache", async () => {
    const opens = trackOpens();
    try {
      const stale = await openLegacyV3Open();
      const cause = await getDb().then(
        () => null,
        (e: unknown) => e
      );
      expect((cause as Error).name).toBe("DatabaseBlockedError");
      const abandoned = lastRequest(opens.requests);

      // The person taps Try again while the other copy is still open, so a
      // SECOND open is queued behind the first. Both come through when the
      // blocker closes; only one of them can be the cached connection.
      const retry = getDb();
      stale.close();
      const db = await retry;
      await delay(0);

      expect(unwrap(db)).not.toBe(abandoned.result);
      // The first connection must not be left open behind the cache: an orphan
      // blocks the next version upgrade and any delete.
      expect(() =>
        (abandoned.result as IDBDatabase).transaction("clipMeta")
      ).toThrow();
      await closeDb();
      await expect(deleteDb()).resolves.toBeUndefined();
    } finally {
      opens.restore();
    }
  });

  it("is dropped like any other cached connection when the browser terminates it", async () => {
    const stale = await openLegacyV3Open();
    await expect(getDb()).rejects.toBeInstanceOf(Error);
    stale.close();
    await delay(0);

    // The cached connection came in by the late path rather than through
    // `getDb()`; its `terminated` must still clear the cache, or every later
    // read is served a dead handle.
    const cached = await getDb();
    forceCloseDatabase(unwrap(cached) as never);
    await delay(0);

    const reopened = await getDb();
    await expect(
      reopened.get("clipMeta", "absent" as never)
    ).resolves.toBeUndefined();
    await closeDb();
  });
});

describe("closeDb — an open that is still in flight", () => {
  it("waits for it and closes the connection instead of orphaning it", async () => {
    const stale = await openLegacyV3Open();
    const cause = await getDb().then(
      () => null,
      (e: unknown) => e
    );
    expect((cause as Error).name).toBe("DatabaseBlockedError");

    // `getDb()` has rejected, but the open behind it is still queued behind the
    // other copy. Returning now would leave whatever it receives orphaned, open
    // and holding the database — the timing-dependent teardown this pins down.
    let done = false;
    const closing = closeDb().then(() => {
      done = true;
    });
    await delay(20);
    expect(done).toBe(false);

    stale.close();
    await closing;

    // Nothing is left holding the database, so a delete is not blocked.
    await expect(deleteDb()).resolves.toBeUndefined();
  });
});

describe("getDb — cache invalidation is identity-checked", () => {
  it("a superseded connection's terminated does not drop the live one", async () => {
    const first = await getDb();

    // `closeDb()` drops the cached handle and closes `first`; a read that lands
    // in the same tick opens a replacement while that close is still in flight.
    const closing = closeDb();
    const opening = getDb();
    await closing;
    const second = await opening;
    expect(second).not.toBe(first);

    // The superseded connection now reports itself closed (the UA discarding
    // it, or the close above landing late). Its `terminated` must invalidate
    // only its OWN handle: nulling the cache here drops the live replacement
    // and orphans it.
    forceCloseDatabase(unwrap(first) as never);
    await delay(0);

    await expect(getDb()).resolves.toBe(second);
    await closeDb();
  });
});
