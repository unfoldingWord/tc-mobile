import "fake-indexeddb/auto";

import { forceCloseDatabase } from "fake-indexeddb";
import { openDB, unwrap, type IDBPDatabase } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeDb,
  getDb,
  setUpgradeCoordinator,
  yieldDeferredUpgrade,
  type UpgradeCoordinator,
} from "@/lib/storage/db";

// db.ts keeps DB_NAME/DB_VERSION private; a lifecycle test necessarily knows
// the name and the version the app requests. Kept in sync by hand — there is
// nothing else to key them off. (Mirrors tests/db-migration.test.ts.)
const DB_NAME = "tc-mobile";
const APP_VERSION = 5;

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
  // The coordinator slot is module-wide, like the connection: a case that left
  // one registered would answer the next case's versionchange.
  setUpgradeCoordinator(null);
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
 * Register a coordinator whose calls a case can assert on.
 *
 * `holdsUnsavedWork` is a predicate rather than a boolean because WHEN it is
 * consulted is itself under test: the app's answer changes while it is
 * registered, every time a take is recorded or saved.
 */
function registerCoordinator(holdsUnsavedWork: () => boolean): {
  [K in keyof UpgradeCoordinator]: ReturnType<typeof vi.fn>;
} {
  const app = {
    holdsUnsavedWork: vi.fn(holdsUnsavedWork),
    onYielded: vi.fn(),
    onBlocked: vi.fn(),
    onUnblocked: vi.fn(),
  };
  setUpgradeCoordinator(app);
  return app;
}

/**
 * Open the database at a version ABOVE the app's, the way a newer copy of this
 * app does after a service-worker update — and record whether it was told it
 * was blocked, which is the event the yield exists to prevent.
 */
function openNewerCopy(): {
  db: Promise<IDBPDatabase>;
  wasBlocked: () => boolean;
} {
  let blocked = false;
  const db = openDB(DB_NAME, APP_VERSION + 1, {
    blocked() {
      blocked = true;
    },
  });
  return { db, wasBlocked: () => blocked };
}

/**
 * Stand up the real v3 pivot schema and KEEP the connection open, so the app's
 * open is blocked by it. It must be the real v3 shape (not an empty DB): once
 * this connection closes, the app's blocked open proceeds and runs the genuine
 * v3→v4→v5 backfills, which read the `clipMeta` and `chapters` stores v3 created.
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

/**
 * Run `body` with this process's `uncaughtException` handlers replaced by one
 * that collects, and return what it collected.
 *
 * One case here asserts that a throw is NOT swallowed — it escapes the
 * `versionchange` handler, which is what a browser turns into the window `error`
 * the failure sink listens for. fake-indexeddb dispatches that event from a
 * `setImmediate`, so the throw lands as an uncaught exception in Node with no
 * `try` anywhere above it; without this the run would be red on the very
 * behaviour the case exists to prove.
 *
 * The swap is total, and restored in a `finally`: leaving the runner's own
 * handler installed alongside would still fail the run, and leaving this one
 * installed afterwards would hide a genuine uncaught error in a later case.
 */
async function collectUncaught(body: () => Promise<void>): Promise<unknown[]> {
  const collected: unknown[] = [];
  const installed = process.listeners("uncaughtException");
  installed.forEach((listener) => process.off("uncaughtException", listener));
  const collect = (cause: unknown): void => {
    collected.push(cause);
  };
  process.on("uncaughtException", collect);
  try {
    await body();
  } finally {
    process.off("uncaughtException", collect);
    installed.forEach((listener) => process.on("uncaughtException", listener));
  }
  return collected;
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
    // after an autoUpdate SW swap). It never yields, so the app's open cannot
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

  it("closes only what existed when it was called, not a newer connection", async () => {
    const stale = await openLegacyV3Open();
    await expect(getDb()).rejects.toBeInstanceOf(Error);

    // The close begins while the rejected open is still queued. A read landing
    // during that wait opens a connection of its own — one this close never saw
    // and must not close: closing it would leave the app holding a dead handle
    // it has no reason to expect.
    const closing = closeDb();
    const opening = getDb();
    stale.close();
    await closing;

    const live = await opening;
    await expect(
      live.get("clipMeta", "absent" as never)
    ).resolves.toBeUndefined();
    await expect(getDb()).resolves.toBe(live);
    await closeDb();
  });

  it("leaves no closed connection behind in the cache", async () => {
    const stale = await openLegacyV3Open();
    await expect(getDb()).rejects.toBeInstanceOf(Error);

    // Nothing else asks for the database during this close, so the connection
    // the queued open finally hands over belongs to the close — it must not be
    // installed in the cache the close is emptying, or the next read is served
    // a connection this call has already closed.
    const closing = closeDb();
    stale.close();
    await closing;

    const db = await getDb();
    await expect(
      db.get("clipMeta", "absent" as never)
    ).resolves.toBeUndefined();
    await closeDb();
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

describe("another copy of the app upgrades the database (versionchange)", () => {
  /**
   * Wait for the newer copy's open, but never hang the suite on it: while this
   * copy holds its connection the open cannot finish, and "it did not finish"
   * is exactly what one of these cases asserts.
   */
  function raceOpen(newer: ReturnType<typeof openNewerCopy>): Promise<string> {
    return Promise.race<string>([
      newer.db.then(() => "opened"),
      delay(200).then(() => "waiting"),
    ]);
  }

  /** Let go of this copy's connection and tidy the newer one away. */
  async function release(
    newer: ReturnType<typeof openNewerCopy>
  ): Promise<void> {
    await closeDb();
    (await newer.db).close();
  }

  it("gives up the connection inside the handler, so the newer copy is never blocked", async () => {
    const app = registerCoordinator(() => false);
    const raw = unwrap(await getDb()) as IDBDatabase;

    // A second `versionchange` listener on the same connection, registered
    // AFTER idb registered the app's — so it runs after it, inside the same
    // dispatch, and can see whether the connection was closed by then.
    //
    // This is the assertion that pins "synchronously, in the handler". The
    // blocked event below cannot: fake-indexeddb queues its blocked check as a
    // task, so a close deferred by a microtask would still beat it there and
    // the case would pass while the real defect — a close that waits on a
    // promise that may not be resolved at all — went unnoticed (#221's P2).
    let closedBeforeTheHandlerReturned: boolean | null = null;
    raw.addEventListener("versionchange", () => {
      try {
        raw.transaction("clipMeta");
        closedBeforeTheHandlerReturned = false;
      } catch {
        // InvalidStateError: the connection is already closing.
        closedBeforeTheHandlerReturned = true;
      }
    });

    const newer = openNewerCopy();
    try {
      expect(await raceOpen(newer)).toBe("opened");
      expect(closedBeforeTheHandlerReturned).toBe(true);
      expect(newer.wasBlocked()).toBe(false);
      expect(app.onYielded).toHaveBeenCalledTimes(1);
    } finally {
      await release(newer);
    }
  });

  it("holds the connection while the app is holding unsaved work", async () => {
    const app = registerCoordinator(() => true);
    await getDb();

    const newer = openNewerCopy();
    try {
      // The upgrade waits. That is a wait for one person; yielding here would
      // close the only connection that could ever store the take this copy is
      // holding, which is a loss for another.
      expect(await raceOpen(newer)).toBe("waiting");
      expect(app.holdsUnsavedWork).toHaveBeenCalled();
      expect(newer.wasBlocked()).toBe(true);
      expect(app.onYielded).not.toHaveBeenCalled();
    } finally {
      await release(newer);
    }
  });

  it("asks the guard when the upgrade arrives, not when the app registered", async () => {
    // The app registers once, at launch, with nothing held — and then a take is
    // recorded. A coordinator whose answer was captured at registration would
    // still be saying "nothing held" here and would give the connection away
    // with a take in hand, which is the loss this whole path exists to prevent.
    let holding = false;
    const app = registerCoordinator(() => holding);
    await getDb();
    holding = true;

    const newer = openNewerCopy();
    try {
      expect(await raceOpen(newer)).toBe("waiting");
      expect(app.onYielded).not.toHaveBeenCalled();
    } finally {
      await release(newer);
    }
  });

  it("keeps the connection when the app's guard throws, and lets the throw escape", async () => {
    // The guard is the app answering a question about its own state from inside
    // an IndexedDB event handler. If that answer throws, the two readings are
    // opposite: "nothing was reported held, so yield" loses a take; "the app
    // could not say, so keep it" costs the other copy a wait. `blocking()`
    // deliberately does not catch, which makes the second one structural — the
    // close is simply never reached — rather than a policy a later edit inverts.
    //
    // The throw is then left to escape the handler, which is the only channel
    // `lib/storage` has: it may not import the failure sink (`hooks/`, the onion
    // rule), and a browser turns an exception thrown from an event listener into
    // a window `error` — which `src/app/install-failure-listeners.ts` reports.
    // Swallowing it here would be the silent catch AGENTS.md bans. What this
    // asserts is that it leaves `blocking()`; that `window` listener is covered
    // by its own tests, and the join between the two is review surface.
    const app = registerCoordinator(() => {
      throw new Error("the app could not answer");
    });
    await getDb();

    const newer = openNewerCopy();
    const escaped = await collectUncaught(async () => {
      expect(await raceOpen(newer)).toBe("waiting");
    });

    try {
      expect(app.holdsUnsavedWork).toHaveBeenCalled();
      expect(app.onYielded).not.toHaveBeenCalled();
      expect(newer.wasBlocked()).toBe(true);
      // Not swallowed: exactly one failure left the handler, and it is the one
      // the app threw. fake-indexeddb runs every listener and then rethrows what
      // they threw as an `AggregateError`, so unwrap one level.
      expect(escaped).toHaveLength(1);
      const errors = (escaped[0] as AggregateError).errors;
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("the app could not answer");
    } finally {
      await release(newer);
    }
  });

  it("gives up a refused upgrade once the app says the work is gone", async () => {
    // `versionchange` fires once. Refusing it protects the take in hand, but
    // nothing asks again — so without a replay the other copy is not waiting for
    // the take to be saved, it is waiting for this tab to be closed.
    let holding = true;
    const app = registerCoordinator(() => holding);
    await getDb();

    const newer = openNewerCopy();
    try {
      expect(await raceOpen(newer)).toBe("waiting");
      expect(app.onYielded).not.toHaveBeenCalled();

      // The take is saved and the recorder closed. No second `versionchange`
      // will ever arrive; this is the only thing that can let the other copy
      // through.
      holding = false;
      yieldDeferredUpgrade();

      expect(await raceOpen(newer)).toBe("opened");
      expect(app.onYielded).toHaveBeenCalledTimes(1);
    } finally {
      await release(newer);
    }
  });

  it("says this copy is out of date when the browser kills a connection that was refusing an upgrade", async () => {
    // The refusal is overruled from underneath: the connection protecting the
    // held take is gone, so the other copy upgrades and the disk version moves
    // past this build. The deferred closure cannot report that — `invalidate()`
    // has just made its own `dbPromise !== handle` check true, so it would
    // return silently — and if nothing else does, this copy believes it is fine
    // while every later save fails `VersionError` for good (George R1 P2-1).
    const app = registerCoordinator(() => true);
    const db = await getDb();

    const newer = openNewerCopy();
    try {
      expect(await raceOpen(newer)).toBe("waiting");
      expect(app.onYielded).not.toHaveBeenCalled();

      forceCloseDatabase(unwrap(db) as never);
      await delay(0);

      expect(app.onYielded).toHaveBeenCalledTimes(1);
    } finally {
      await release(newer);
    }
  });

  it("says it again to a copy that meets the newer data on an open, not on a yield", async () => {
    // The same condition reached the other way round: this copy never held the
    // connection that was in the way — it was started after the newer copy had
    // written, or its own was terminated. Every unchanged caller meets this as a
    // rejection it can only turn into its own local failure; none of them can
    // say the one true thing, which is that nothing from this copy will ever
    // read or write again.
    const app = registerCoordinator(() => false);
    const newer = await openNewerThanApp();
    newer.close();

    await expect(getDb()).rejects.toBeInstanceOf(Error);

    expect(app.onYielded).toHaveBeenCalledTimes(1);
  });

  it("honours a refused upgrade when the app unregisters, so the other copy is not stranded", async () => {
    // `ErrorBoundary` unmounts `App` on a render throw, taking the held take
    // with it (#167). The reason for the refusal is gone, but without this the
    // refusal is not: unregistering alone leaves the deferred close with nothing
    // left to run it, and the other copy waits on its blocked screen until this
    // page is actually discarded (George R1 P2-2).
    registerCoordinator(() => true);
    await getDb();

    const newer = openNewerCopy();
    try {
      expect(await raceOpen(newer)).toBe("waiting");

      // What the hook's effect cleanup does, in the order it does it.
      yieldDeferredUpgrade();
      setUpgradeCoordinator(null);

      expect(await raceOpen(newer)).toBe("opened");
    } finally {
      await release(newer);
    }
  });

  it("has nothing to give up when no upgrade was refused", async () => {
    // The other state of that gate. Work is held and released all the time with
    // no other copy anywhere near; a release that yielded anyway would close a
    // working connection and put a restart screen in front of someone who was
    // simply finished recording.
    const app = registerCoordinator(() => false);
    const db = await getDb();

    yieldDeferredUpgrade();

    expect(app.onYielded).not.toHaveBeenCalled();
    await expect(
      db.get("clipMeta", "absent" as never)
    ).resolves.toBeUndefined();
    await closeDb();
  });

  it("gives it up once the app has unregistered", async () => {
    registerCoordinator(() => true);
    await getDb();
    // The app is gone — nothing is mounted that could be holding a recording,
    // and refusing now would block the other copy with no screen to explain it.
    setUpgradeCoordinator(null);

    const newer = openNewerCopy();
    try {
      expect(await raceOpen(newer)).toBe("opened");
      expect(newer.wasBlocked()).toBe(false);
    } finally {
      await release(newer);
    }
  });

  it("tells the app when its own open is blocked by an older copy", async () => {
    const app = registerCoordinator(() => false);
    const stale = await openLegacyV3Open();
    try {
      await expect(getDb()).rejects.toBeInstanceOf(Error);
      // The Books screen's own Notice is not the whole story: the app needs to
      // know, wherever it is, that the database is unreachable and why.
      expect(app.onBlocked).toHaveBeenCalledTimes(1);
    } finally {
      stale.close();
      await closeDb();
    }
  });

  it("tells it the block is over when the other copy closes on its own", async () => {
    // `blocked` fires once, for the open being processed; a second open queues
    // behind it and is told nothing. So an app showing "another copy is open"
    // cannot find out by asking that it no longer is — and it has to find out,
    // because the panel is deferred while a take is held and the block can end
    // while that take is still in hand. Without this the deferred panel would go
    // up over a database this copy can read perfectly well.
    const opens = trackOpens();
    try {
      const app = registerCoordinator(() => false);
      const stale = await openLegacyV3Open();

      await expect(getDb()).rejects.toBeInstanceOf(Error);
      expect(app.onBlocked).toHaveBeenCalledTimes(1);
      expect(app.onUnblocked).not.toHaveBeenCalled();

      // The person closes the other copy. The open that was blocked comes
      // through and is cached, so the database is reachable with no further
      // action. Waited on by the request itself rather than a delay: how many
      // turns that takes is fake-indexeddb's business, not this case's.
      const appOpen = lastRequest(opens.requests);
      stale.close();
      await requestSettled(appOpen);
      await delay(0);

      expect(app.onUnblocked).toHaveBeenCalledTimes(1);
      await expect(
        (await getDb()).get("clipMeta", "absent" as never)
      ).resolves.toBeUndefined();
      await closeDb();
    } finally {
      opens.restore();
    }
  });

  it("says nothing about a block for an open that was never blocked", async () => {
    // The other half of that gate. `onUnblocked` withdraws a panel, so an open
    // that reports it when there was nothing to withdraw would be a screen
    // taken down for no reason — or, once more states exist, the wrong one.
    const app = registerCoordinator(() => false);
    await getDb();
    expect(app.onBlocked).not.toHaveBeenCalled();
    expect(app.onUnblocked).not.toHaveBeenCalled();
    await closeDb();
  });
});
