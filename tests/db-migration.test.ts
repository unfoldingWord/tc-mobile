import "fake-indexeddb/auto";

import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/lib/storage/db";

// db.ts keeps DB_NAME private; a migration test necessarily knows the name it
// is migrating. Kept in sync by hand — there is nothing else to key it off.
const DB_NAME = "tc-mobile";

// The version `getDb` opens. Like DB_NAME, kept in sync with db.ts by hand —
// a migration test necessarily knows the ladder it is climbing. Asserted rather
// than assumed, so a bump that forgets to add its own case fails here first.
const APP_VERSION = 8;

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

/**
 * Stand up the v5 schema — the v3 pivot stores, with named chapters and the v4
 * clip fields already in place, and NO `failures` store. This is what a device
 * on v0.1.13 holds when #205's v6 opens it.
 */
async function openLegacyV5() {
  return openDB(DB_NAME, 5, {
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
 * Stand up the v6 schema: the pivot stores plus the failures log.
 * Clip metadata has no stall count, and segments have no label.
 */
async function openLegacyV6() {
  return openDB(DB_NAME, 6, {
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
      db.createObjectStore("failures", { autoIncrement: true });
    },
  });
}

beforeEach(wipe);
afterEach(wipe);

describe("v8 segment-label backfill (append-only)", () => {
  it.each([6, 7])(
    "stamps a v%i database while preserving recordings and stall counts",
    async (version) => {
      const legacy = await openLegacyV6();
      legacy.close();
      const v6 = await openDB(DB_NAME, version);
      await v6.put("chapters", {
        id: "ch1",
        bookId: "b1",
        number: 1,
        segmentIds: ["s1", "s2"],
        name: null,
      });
      await v6.put("segments", {
        id: "s1",
        chapterId: "ch1",
        index: 1,
        reference: null,
        activeTakeId: "t1",
        status: "affirmed",
      });
      await v6.put("segments", {
        id: "s2",
        chapterId: "ch1",
        index: 2,
        reference: null,
        activeTakeId: null,
        status: "not-started",
      });
      await v6.put("takes", {
        id: "t1",
        segmentId: "s1",
        clipId: "c1",
        createdAt: 3,
        durationMs: 1,
      });
      const pcm = Int16Array.from([1, 2, 3, 4]);
      await v6.put("clipMeta", {
        id: "c1",
        sampleRate: 44100,
        frameCount: 4,
        durationMs: 1,
        createdAt: 3,
        encoding: "pcm",
        generation: 0,
        byteLength: 8,
        peaks: null,
        ...(version === 7 ? { transcodeStallCount: 3 } : {}),
      });
      await v6.put("clipData", pcm.buffer, "c1");
      const priorMeta = await v6.get("clipMeta", "c1");
      const priorTake = await v6.get("takes", "t1");
      v6.close();

      const v8 = await getDb();
      expect(v8.version).toBe(APP_VERSION);

      // Every row gains the field as null — never undefined — and nothing else
      // about it moves: ordinal, pointer and status come through as they were.
      expect(await v8.getAll("segments")).toEqual([
        {
          id: "s1",
          chapterId: "ch1",
          index: 1,
          reference: null,
          activeTakeId: "t1",
          status: "affirmed",
          label: null,
        },
        {
          id: "s2",
          chapterId: "ch1",
          index: 2,
          reference: null,
          activeTakeId: null,
          status: "not-started",
          label: null,
        },
      ]);
      expect(await v8.get("clipMeta", "c1" as never)).toEqual({
        ...priorMeta,
        transcodeStallCount: version === 7 ? 3 : 0,
      });
      expect(await v8.get("takes", "t1" as never)).toEqual(priorTake);
      // The audio behind the segment is untouched.
      expect((await v8.get("takes", "t1" as never))?.clipId).toBe("c1");
      const bytes = await v8.get("clipData", "c1" as never);
      expect(Array.from(new Int16Array(bytes!))).toEqual([1, 2, 3, 4]);
      expect((await v8.get("chapters", "ch1" as never))?.segmentIds).toEqual([
        "s1",
        "s2",
      ]);
    }
  );

  it("leaves a segment that already carries a label alone", async () => {
    // Keys on the field being ABSENT, like the v5 chapter backfill, so a row a
    // newer build already labelled is not clobbered back to null.
    const v6 = await openLegacyV6();
    await v6.put("segments", {
      id: "s1",
      chapterId: "ch1",
      index: 3,
      reference: null,
      activeTakeId: null,
      status: "not-started",
      label: "verses 3–4",
    });
    v6.close();

    const v8 = await getDb();
    expect((await v8.get("segments", "s1" as never))?.label).toBe("verses 3–4");
  });

  it("stamps a v3 segment on the way up, alongside the older backfills", async () => {
    // A device that recorded on the v3 pivot build jumps every step in one open.
    const v3 = await openLegacyV3();
    await v3.put("segments", {
      id: "s1",
      chapterId: "ch1",
      index: 1,
      reference: null,
      activeTakeId: null,
      status: "not-started",
    });
    v3.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect((await db.get("segments", "s1" as never))?.label).toBeNull();
  });
});

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
    expect(v5.version).toBe(APP_VERSION);

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
    expect(v5.version).toBe(APP_VERSION);

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

describe("v5 → v6 failure log (append-only, a new store)", () => {
  it("adds the failures store to a v5 database without touching a row", async () => {
    // The strongest shape an upgrade has: a new store and nothing else. This
    // pins BOTH halves — that the store arrives, and that the existing tree is
    // not read, stamped or moved on the way (a v6 step that recreated anything
    // would take a dev device's recordings with it).
    const v5 = await openLegacyV5();
    await v5.put("books", {
      id: "b1",
      name: "Book 001",
      languageCode: null,
      chapterIds: ["ch1"],
      createdAt: 0,
      updatedAt: 0,
    });
    await v5.put("chapters", {
      id: "ch1",
      bookId: "b1",
      number: 6,
      segmentIds: [],
      name: "Mark 6",
    });
    v5.close();

    const v6 = await getDb();
    expect(v6.version).toBe(APP_VERSION);
    expect(Array.from(v6.objectStoreNames)).toContain("failures");
    expect(await v6.count("failures")).toBe(0);

    // Untouched, including the v5 name the v5 backfill must not re-stamp.
    expect((await v6.get("books", "b1" as never))?.chapterIds).toEqual(["ch1"]);
    expect((await v6.get("chapters", "ch1" as never))?.name).toBe("Mark 6");
  });

  it("creates the failures store on a fresh install too", async () => {
    // oldVersion 0 runs the v3 recreate and then every additive step. Without
    // its own case, a v6 block written inside the `oldVersion < 3` branch would
    // pass the upgrade test above and leave every new phone with no log.
    const db = await getDb();
    expect(Array.from(db.objectStoreNames)).toContain("failures");
  });

  it("keeps a failure row across the next open", async () => {
    // The point of the store: durability. Written, connection dropped, read
    // back — which is the reload a `console.error` does not survive.
    const first = await getDb();
    await first.add("failures", {
      at: 5,
      context: "render",
      message: "Error: boom",
    });
    await closeDb();

    const second = await getDb();
    expect(await second.getAll("failures")).toEqual([
      { at: 5, context: "render", message: "Error: boom" },
    ]);
  });
});

describe("no structure change after the upgrade has yielded (George #2, R1)", () => {
  /**
   * A `versionchange` transaction stays alive across awaited IDB requests, and
   * the backfills depend on that. A STRUCTURE change after the handler has
   * yielded is a different thing: some WebKit versions refuse it with
   * `InvalidStateError` and abort the whole upgrade, which would leave `getDb()`
   * rejecting and nothing able to record. `fake-indexeddb` permits it, so the
   * ordering cannot be caught by simply opening the database — this models the
   * refusal instead.
   *
   * `openCursor` is the yield: every await in the upgrade is one of these. Once
   * one has been called, `createObjectStore` throws, exactly as the strict
   * engine would. Both prototypes are restored afterwards.
   */
  function refuseStructureChangeAfterYield(): () => void {
    const openCursor = IDBObjectStore.prototype.openCursor;
    const createObjectStore = IDBDatabase.prototype.createObjectStore;
    let yielded = false;

    IDBObjectStore.prototype.openCursor = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof openCursor>
    ) {
      yielded = true;
      return openCursor.apply(this, args);
    };
    IDBDatabase.prototype.createObjectStore = function (
      this: IDBDatabase,
      ...args: Parameters<typeof createObjectStore>
    ) {
      if (yielded) {
        throw new Error(
          "InvalidStateError: createObjectStore after the upgrade yielded"
        );
      }
      return createObjectStore.apply(this, args);
    };

    return () => {
      IDBObjectStore.prototype.openCursor = openCursor;
      IDBDatabase.prototype.createObjectStore = createObjectStore;
    };
  }

  it("opens on a FRESH install under an engine that refuses a late create", async () => {
    // oldVersion 0 runs the v3 recreate and then every backfill, each of which
    // opens a cursor unconditionally even over an empty store — so this is the
    // path where a v6 create placed after them sits behind those awaits, on
    // every new phone.
    const restore = refuseStructureChangeAfterYield();
    try {
      const db = await getDb();
      expect(db.version).toBe(APP_VERSION);
      expect(Array.from(db.objectStoreNames)).toContain("failures");
    } finally {
      restore();
    }
  });

  it("opens on a v3 UPGRADE carrying rows, under the same refusal", async () => {
    // The other entry that actually yields with the create still ahead of it.
    // An upgrade that starts at or above the newest create runs backfills only,
    // so it would pass this whatever the order. A v3 device is the real case:
    // every backfill runs, over NON-EMPTY stores, so the upgrade genuinely
    // yields — after the v6 create, which is what the ordering is about.
    const v3 = await openLegacyV3();
    await v3.put("chapters", {
      id: "ch1",
      bookId: "b1",
      number: 3,
      segmentIds: [],
    });
    await v3.put("clipMeta", {
      id: "c1",
      sampleRate: 44100,
      frameCount: 10,
      durationMs: 1,
      createdAt: 7,
    });
    v3.close();

    const restore = refuseStructureChangeAfterYield();
    try {
      const db = await getDb();
      expect(db.version).toBe(APP_VERSION);
      expect(Array.from(db.objectStoreNames)).toContain("failures");
      // And both yield-dependent backfills still did their job.
      expect((await db.get("chapters", "ch1" as never))?.name).toBeNull();
      expect((await db.get("clipMeta", "c1" as never))?.encoding).toBe("pcm");
    } finally {
      restore();
    }
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
    // getDb now opens the current version; the v4 clip-encoding backfill still
    // runs on the way up (oldVersion < 4), the v5 chapter backfill no-ops over
    // the empty chapters store, and v6 adds the failure log.
    expect(v4.version).toBe(APP_VERSION);

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
      transcodeStallCount: 0,
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
    expect(meta?.transcodeStallCount).toBe(0);
  });
});

describe("the v7 transcode-stall count backfill", () => {
  const fieldlessMeta = (id: string) => ({
    id,
    sampleRate: 44100,
    frameCount: 10,
    durationMs: 1,
    createdAt: 7,
    encoding: "pcm" as const,
    generation: 0,
    byteLength: 20,
    peaks: null,
  });

  it("stamps a v6 device's clip metadata, leaving the failure log alone", async () => {
    const v6 = await openLegacyV6();
    await v6.put("clipMeta", fieldlessMeta("c1"));
    await v6.add("failures", { context: "save-take", at: 1 } as never);
    v6.close();

    const v7 = await getDb();
    expect(v7.version).toBe(APP_VERSION);
    expect((await v7.get("clipMeta", "c1" as never))?.transcodeStallCount).toBe(
      0
    );
    // Append-only: the upgrade touches clip metadata and nothing else.
    expect(await v7.count("failures")).toBe(1);
  });

  it("stamps a v5 device's clip metadata, which gains `failures` in the same open", async () => {
    const v5 = await openLegacyV5();
    await v5.put("clipMeta", fieldlessMeta("c1"));
    v5.close();

    const v7 = await getDb();
    expect(v7.version).toBe(APP_VERSION);
    expect((await v7.get("clipMeta", "c1" as never))?.transcodeStallCount).toBe(
      0
    );
    expect(Array.from(v7.objectStoreNames)).toContain("failures");
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
