import "fake-indexeddb/auto";

import { openDB, type IDBPDatabase } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listBooks } from "@/lib/storage/books";
import { closeDb, getDb, type TcMobileDb } from "@/lib/storage/db";

// db.ts keeps DB_NAME private; a migration test necessarily knows the name it
// is migrating. Kept in sync by hand — there is nothing else to key it off.
const DB_NAME = "tc-mobile";

// The version `getDb` opens. Like DB_NAME, kept in sync with db.ts by hand —
// a migration test necessarily knows the ladder it is climbing. Asserted rather
// than assumed, so a bump that forgets to add its own case fails here first.
const APP_VERSION = 14;

/**
 * What the v12 step (#1462, docs/design/v12-schema.md) adds to a row that had
 * none of it. Spread into the whole-row expectations of the older steps' cases,
 * which climb to v12 too: every value is null or blank, never an upgrade time.
 */
const V12_BOOK = {
  provenance: { kind: "blank" },
  licence: null,
  modifiedAt: null,
} as const;
const V12_ROW = { createdAt: null, modifiedAt: null, templateKey: null };
/**
 * A segment climbing to v13 also gains `audioRevision: 0` (#38,
 * docs/design/pending-take-lifecycle.md §2): the v12 fields plus that one.
 */
const V13_SEGMENT = { ...V12_ROW, audioRevision: 0 };
/** A clip row climbing to v14 gains `processing: null` (#1433), and only that. */
const V14_CLIP = { processing: null };

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

/**
 * Stand up the v8 schema: the pivot stores, with named chapters, labelled
 * segments and the v4/v7 clip fields all already in place. This is what a
 * device on v0.2.x holds when #957's v9 opens it — a book row with no
 * `coverColourKey`.
 */
async function openLegacyV8() {
  return openDB(DB_NAME, 8, {
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

/**
 * Stand up the v9 schema — v8's stores, unchanged (v9 was a book-row backfill,
 * not a structure change), holding books the way v9 and earlier wrote them:
 * the placeholder rendered into `name`, a `coverColourKey`, and no `number`.
 *
 * This is the only path on which v10's pass is the whole upgrade: `oldVersion`
 * 9 skips the v3 recreate, the v6 create and every older backfill.
 */
async function openLegacyV9() {
  const legacy = await openLegacyV8();
  legacy.close();
  return openDB(DB_NAME, 9);
}

/** A v9 `books` row: a name (placeholder or chosen), a colour, and no slot. */
const v9Book = (id: string, name: string, chapterIds: string[] = []) => ({
  id,
  name,
  languageCode: null,
  chapterIds,
  createdAt: 0,
  updatedAt: 0,
  coverColourKey: null,
});

beforeEach(wipe);
afterEach(wipe);

describe("v9 book cover-colour backfill (append-only)", () => {
  it("stamps a pre-existing colourless book with coverColourKey: null, keeping its data", async () => {
    const v8 = await openLegacyV8();
    await v8.put("books", {
      id: "b1",
      name: "Mark",
      languageCode: null,
      chapterIds: ["ch1"],
      createdAt: 3,
      updatedAt: 7,
    });
    v8.close();

    const v9 = await getDb();
    expect(v9.version).toBe(APP_VERSION);

    const book = await v9.get("books", "b1" as never);
    // The field is now present and null — never undefined — and every other
    // field is untouched (name, language, chapter order, timestamps). The
    // `number` is v10's (#169), stamped on the same open; a named book's slot
    // is dormant.
    expect(book).toEqual({
      id: "b1",
      name: "Mark",
      number: 1,
      languageCode: null,
      chapterIds: ["ch1"],
      createdAt: 3,
      updatedAt: 7,
      coverColourKey: null,
      // v11 (#338): the only book on the shelf is at its top.
      shelfPosition: 0,
      ...V12_BOOK,
    });
  });

  it("leaves a book that already carries a colour alone", async () => {
    // Keys on the field being ABSENT, like the v5/v8 backfills before it, so a
    // row a newer build already coloured is not clobbered back to null.
    const v8 = await openLegacyV8();
    await v8.put("books", {
      id: "b2",
      name: "Luke",
      languageCode: null,
      chapterIds: [],
      createdAt: 0,
      updatedAt: 0,
      coverColourKey: "forest",
    });
    v8.close();

    const v9 = await getDb();
    expect((await v9.get("books", "b2" as never))?.coverColourKey).toBe(
      "forest"
    );
  });

  it("stamps a v3 book on the way up, alongside the older backfills", async () => {
    // A device that recorded on the v3 pivot build jumps every step in one
    // open — the v9 backfill runs alongside v4/v5/v6/v7/v8's.
    const v3 = await openLegacyV3();
    await v3.put("books", {
      id: "b1",
      name: "Mark",
      languageCode: null,
      chapterIds: [],
      createdAt: 0,
      updatedAt: 0,
    });
    v3.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect((await db.get("books", "b1" as never))?.coverColourKey).toBeNull();
  });

  it("does not touch chapters, segments, takes or clips on the way up", async () => {
    const v8 = await openLegacyV8();
    await v8.put("books", {
      id: "b1",
      name: "Mark",
      languageCode: null,
      chapterIds: ["ch1"],
      createdAt: 0,
      updatedAt: 0,
    });
    await v8.put("chapters", {
      id: "ch1",
      bookId: "b1",
      number: 1,
      segmentIds: ["s1"],
      name: "Mark 6",
    });
    await v8.put("segments", {
      id: "s1",
      chapterId: "ch1",
      index: 1,
      reference: null,
      activeTakeId: null,
      status: "not-started",
      label: "verses 3-4",
    });
    await v8.put("takes", {
      id: "t1",
      segmentId: "s1",
      clipId: "c1",
      createdAt: 3,
      durationMs: 1,
    });
    const pcm = Int16Array.from([1, 2, 3, 4]);
    await v8.put("clipMeta", {
      id: "c1",
      sampleRate: 44100,
      frameCount: 4,
      durationMs: 1,
      createdAt: 3,
      encoding: "pcm",
      generation: 0,
      byteLength: 8,
      peaks: null,
      transcodeStallCount: 2,
    });
    await v8.put("clipData", pcm.buffer, "c1");
    const priorChapter = await v8.get("chapters", "ch1");
    const priorSegment = await v8.get("segments", "s1");
    const priorTake = await v8.get("takes", "t1");
    const priorMeta = await v8.get("clipMeta", "c1");
    v8.close();

    const v9 = await getDb();
    expect(v9.version).toBe(APP_VERSION);
    // Whole-row equality: v9 opens only `books`, so every other row must come
    // through exactly as the v8 store held it — no field added, none dropped.
    expect(priorChapter).toBeDefined();
    expect(priorSegment).toBeDefined();
    expect(priorTake).toBeDefined();
    expect(priorMeta).toBeDefined();
    // v12 (#1462) adds its three fields, and only those, on the same open.
    expect(await v9.get("chapters", "ch1" as never)).toEqual({
      ...priorChapter,
      ...V12_ROW,
    });
    expect(await v9.get("segments", "s1" as never)).toEqual({
      ...priorSegment,
      ...V13_SEGMENT,
    });
    expect(await v9.get("takes", "t1" as never)).toEqual(priorTake);
    expect(await v9.get("clipMeta", "c1" as never)).toEqual({
      ...priorMeta,
      ...V14_CLIP,
    });
    const data = await v9.get("clipData", "c1" as never);
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Int16Array(data as ArrayBuffer))).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

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
          ...V13_SEGMENT,
        },
        {
          id: "s2",
          chapterId: "ch1",
          index: 2,
          reference: null,
          activeTakeId: null,
          status: "not-started",
          label: null,
          ...V13_SEGMENT,
        },
      ]);
      expect(await v8.get("clipMeta", "c1" as never)).toEqual({
        ...priorMeta,
        transcodeStallCount: version === 7 ? 3 : 0,
        // s1 is Finished and its clip still PCM: a transcode owed across the
        // upgrade, so v14 records that no stage ran (U6c).
        processing: {
          stages: [],
          measuredLufs: null,
          measuredTruePeakDbtp: null,
          appliedGainDb: 0,
        },
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
      ...V12_ROW,
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
      ...V12_ROW,
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
      // v12's two stores obey the same rule (#1462, M3).
      expect(Array.from(db.objectStoreNames)).toContain("tombstones");
      expect(Array.from(db.objectStoreNames)).toContain("pendingTakes");
      // And v13's (#38, R6).
      expect(Array.from(db.objectStoreNames)).toContain("takeDispositions");
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
      expect(Array.from(db.objectStoreNames)).toContain("tombstones");
      expect(Array.from(db.objectStoreNames)).toContain("pendingTakes");
      expect(Array.from(db.objectStoreNames)).toContain("takeDispositions");
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
    // …and the v8 pass on the way up un-freezes the placeholder this v3 row
    // stored as English, which is the shape a reader meets from here on.
    expect(await v4.get("books", "b1" as never)).toMatchObject({
      name: null,
      number: 1,
    });
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
      ...V14_CLIP,
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

describe("the v9 → v10 book placeholder migration (#169)", () => {
  it("turns a placeholder name into a slot, keeping every other field", async () => {
    // What every device in the field holds: a book nobody named, carrying the
    // English the old writer rendered into it. After v10 the words are gone and
    // the slot they encoded is stored instead, so the screen renders them
    // again — in whatever language it is running.
    const v9 = await openLegacyV9();
    await v9.put("books", {
      ...v9Book("b1", "Book 003", ["ch1"]),
      languageCode: "swh",
      createdAt: 11,
      updatedAt: 22,
    });
    v9.close();

    const v10 = await getDb();
    expect(v10.version).toBe(APP_VERSION);
    expect(await v10.get("books", "b1" as never)).toEqual({
      id: "b1",
      name: null,
      number: 3,
      languageCode: "swh",
      chapterIds: ["ch1"],
      createdAt: 11,
      updatedAt: 22,
      coverColourKey: null,
      // v11 (#338): the only book on the shelf is at its top.
      shelfPosition: 0,
      ...V12_BOOK,
    });
  });

  it("never rewrites a name a facilitator chose, and parks each on a FREE slot", async () => {
    // The half that would be unrecoverable if it were wrong: "Mark" is a
    // person's work, not copy. Each named row keeps its name and takes a slot
    // no other row holds — the placeholders first, then the named ones in
    // order — so no two rows on the shelf can claim the same one.
    //
    // The shelf is arranged so that "the next free slot" is never simply 1 and
    // never simply "one per row": 1 and 3 are already showing, so the two
    // named books have to step over them to 2 and 4.
    const v9 = await openLegacyV9();
    await v9.put("books", v9Book("b1", "Book 001"));
    await v9.put("books", v9Book("b2", "Book 003"));
    await v9.put("books", v9Book("b3", "Mark"));
    await v9.put("books", v9Book("b4", "Ruth"));
    v9.close();

    const v10 = await getDb();
    const rows = await v10.getAll("books");
    expect(
      Object.fromEntries(rows.map((r) => [r.id, [r.name, r.number]]))
    ).toEqual({
      b1: [null, 1],
      b2: [null, 3],
      b3: ["Mark", 2],
      b4: ["Ruth", 4],
    });
    // And no slot is handed out twice, which is the property the numbers above
    // are only one arrangement of.
    expect(new Set(rows.map((r) => r.number)).size).toBe(rows.length);
  });

  it("keeps an unpadded look-alike as the typed name it is", async () => {
    // "Book 1" is not a string this database ever wrote — the writer padded to
    // three digits — so it is a name somebody typed, exactly as the pre-#169
    // placeholder rule already treated it (it never blocked "Book 001").
    const v9 = await openLegacyV9();
    await v9.put("books", v9Book("b1", "Book 1"));
    await v9.put("books", v9Book("b2", "Book 0001"));
    v9.close();

    const v10 = await getDb();
    expect((await v10.get("books", "b1" as never))?.name).toBe("Book 1");
    expect((await v10.get("books", "b2" as never))?.name).toBe("Book 0001");
  });

  it("leaves a row that already carries a slot alone", async () => {
    // Keys on `number` being ABSENT, like every backfill before it, so a row
    // written by a newer build before an older one reopened the database is
    // not re-derived — and a name of "Book 004" that a person typed AFTER v10
    // stays theirs.
    const v9 = await openLegacyV9();
    await v9.put("books", { ...v9Book("b1", "Book 004"), number: 9 });
    v9.close();

    const v10 = await getDb();
    expect(await v10.get("books", "b1" as never)).toMatchObject({
      name: "Book 004",
      number: 9,
    });
  });

  it("runs over an empty shelf, and on a fresh install, without complaint", async () => {
    // The two paths with nothing to convert: a v9 device that never made a
    // book, and oldVersion 0, where the v3 recreate has just emptied the store
    // the pass then reads.
    const v9 = await openLegacyV9();
    v9.close();
    const v10 = await getDb();
    expect(v10.version).toBe(APP_VERSION);
    expect(await v10.count("books")).toBe(0);

    await wipe();
    const fresh = await getDb();
    expect(fresh.version).toBe(APP_VERSION);
    expect(await fresh.count("books")).toBe(0);
  });

  it("does not hand a named row a slot an already-numbered unnamed row is showing", async () => {
    // A row that already carries a slot is left alone — and if it is unnamed,
    // that slot is on screen, so the named rows parked below must step over it.
    const v9 = await openLegacyV9();
    await v9.put("books", { ...v9Book("b1", "x"), name: null, number: 1 });
    await v9.put("books", v9Book("b2", "Mark"));
    v9.close();

    const v10 = await getDb();
    const rows = await v10.getAll("books");
    expect(
      Object.fromEntries(rows.map((r) => [r.id, [r.name, r.number]]))
    ).toEqual({
      b1: [null, 1],
      b2: ["Mark", 2],
    });
  });

  it("composes with v9 on a v8 device: a placeholder book gains a colour key AND a slot", async () => {
    // The ladder a 0.2.x device climbs: v9's colour stamp and v10's slot pass
    // run in one open, over the same `books` rows, in that order.
    const v8 = await openLegacyV8();
    await v8.put("books", {
      id: "b1",
      name: "Book 002",
      languageCode: null,
      chapterIds: [],
      createdAt: 5,
      updatedAt: 6,
    });
    v8.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect(await db.get("books", "b1" as never)).toEqual({
      id: "b1",
      name: null,
      number: 2,
      languageCode: null,
      chapterIds: [],
      createdAt: 5,
      updatedAt: 6,
      coverColourKey: null,
      // v11 (#338): the only book on the shelf is at its top.
      shelfPosition: 0,
      ...V12_BOOK,
    });
  });
});

/**
 * Stand up the v10 schema — v9's stores, unchanged (v10 was a book-row pass,
 * not a structure change), holding books the way v10 wrote them: a nullable
 * name, a slot, a colour, and no shelf position.
 */
async function openLegacyV10() {
  const legacy = await openLegacyV9();
  legacy.close();
  return openDB(DB_NAME, 10);
}

/** A v10 `books` row: everything but the shelf position. */
const v10Book = (id: string, createdAt: number, number = 1) => ({
  id,
  name: null as string | null,
  number,
  languageCode: null as string | null,
  chapterIds: [] as string[],
  createdAt,
  updatedAt: createdAt,
  coverColourKey: null as string | null,
});

/**
 * The order the shelf showed before v11, written out from the rule v10's
 * `listBooks` used: newest `createdAt` first, ties in primary-key order
 * (`getAll` returns key order and the sort is stable).
 */
const v10ShelfOrder = (
  rows: ReadonlyArray<{ id: string; createdAt: number }>
) =>
  rows
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => r.id);

describe("the v10 → v11 shelf position (#338)", () => {
  it("gives every book the position the shelf showed it at, so nobody's shelf jumps", async () => {
    // Out of key order and out of time order on purpose, with a createdAt tie
    // (b2/b3) that only the key order breaks.
    const rows = [
      v10Book("b5", 7),
      v10Book("b1", 5),
      v10Book("b3", 9),
      v10Book("b4", 1),
      v10Book("b2", 9),
    ];
    const v10 = await openLegacyV10();
    for (const row of rows) await v10.put("books", row);
    v10.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    const stored = await db.getAll("books");
    expect(
      Object.fromEntries(stored.map((r) => [r.id, r.shelfPosition]))
    ).toEqual({ b2: 0, b3: 1, b5: 2, b1: 3, b4: 4 });
    // And the shelf the app reads is the one it showed before the upgrade.
    expect((await listBooks()).map((b) => b.id)).toEqual(v10ShelfOrder(rows));
  });

  it("adds the position and touches nothing else on the row", async () => {
    const v10 = await openLegacyV10();
    await v10.put("books", {
      ...v10Book("b1", 11, 3),
      name: "Mark",
      languageCode: "swh",
      chapterIds: ["ch1"],
      updatedAt: 22,
      coverColourKey: "forest",
    });
    v10.close();

    const db = await getDb();
    expect(await db.get("books", "b1" as never)).toEqual({
      id: "b1",
      name: "Mark",
      number: 3,
      languageCode: "swh",
      chapterIds: ["ch1"],
      createdAt: 11,
      updatedAt: 22,
      coverColourKey: "forest",
      shelfPosition: 0,
      ...V12_BOOK,
    });
  });

  it("leaves a row that already carries a position alone, and parks the rest below it", async () => {
    // Keys on the field being ABSENT, like every backfill before it. The
    // positioned row is the OLDEST, so a pass that re-derived it from
    // createdAt would move it.
    const v10 = await openLegacyV10();
    await v10.put("books", { ...v10Book("b1", 1), shelfPosition: 0 });
    await v10.put("books", v10Book("b2", 9));
    await v10.put("books", v10Book("b3", 5));
    v10.close();

    const db = await getDb();
    const stored = await db.getAll("books");
    expect(
      Object.fromEntries(stored.map((r) => [r.id, r.shelfPosition]))
    ).toEqual({ b1: 0, b2: 1, b3: 2 });
  });

  it("treats a non-finite position as absent, so it cannot poison the rest", async () => {
    // No v10 row carries the field, but one that does must not turn `next`
    // into NaN or Infinity for every row parked after it.
    const v10 = await openLegacyV10();
    await v10.put("books", { ...v10Book("b1", 1), shelfPosition: 0 });
    await v10.put("books", { ...v10Book("b2", 9), shelfPosition: Number.NaN });
    await v10.put("books", {
      ...v10Book("b3", 5),
      shelfPosition: Number.POSITIVE_INFINITY,
    });
    await v10.put("books", v10Book("b4", 3));
    v10.close();

    const db = await getDb();
    const stored = await db.getAll("books");
    expect(
      Object.fromEntries(stored.map((r) => [r.id, r.shelfPosition]))
    ).toEqual({ b1: 0, b2: 1, b3: 2, b4: 3 });
  });

  it("runs over an empty shelf, and on a fresh install, without complaint", async () => {
    const v10 = await openLegacyV10();
    v10.close();
    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect(await db.count("books")).toBe(0);

    await wipe();
    const fresh = await getDb();
    expect(fresh.version).toBe(APP_VERSION);
    expect(await fresh.count("books")).toBe(0);
  });

  it("climbs v9 → v10 → v11 in one open: a placeholder book gains a slot AND a position", async () => {
    // A device still on v9 skips v10 entirely: both passes run in one
    // upgrade, over the same rows, in order.
    const v9 = await openLegacyV9();
    await v9.put("books", { ...v9Book("b1", "Book 002"), createdAt: 4 });
    await v9.put("books", { ...v9Book("b2", "Mark"), createdAt: 8 });
    v9.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect(await db.get("books", "b1" as never)).toEqual({
      id: "b1",
      name: null,
      number: 2,
      languageCode: null,
      chapterIds: [],
      createdAt: 4,
      updatedAt: 0,
      coverColourKey: null,
      shelfPosition: 1,
      ...V12_BOOK,
    });
    expect(await db.get("books", "b2" as never)).toMatchObject({
      name: "Mark",
      number: 1,
      shelfPosition: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// A whole shelf, upgraded: every recording still resolves (#1421)
// ---------------------------------------------------------------------------
//
// The cases above prove the upgrade steps row by row. These two start from a
// shelf shaped like a tester's — several books, chapters, segments and takes,
// finished (MP3) and unfinished (PCM) clips side by side — written with raw
// `put`s in the record shapes v1.0.x wrote (no app helper), and ask the
// question that matters: after the upgrade, does every recording still resolve
// to the bytes it had, with the encoding it had.

type SeedBook = {
  id: string;
  name: string | null;
  createdAt: number;
  /** Present from v10 on. */
  number?: number;
  /** Present from v11 on. */
  shelfPosition?: number;
  /** `null` unless a case gives one; v12 must keep a stored tag. */
  languageCode?: string | null;
};

type SeededClip = {
  clipId: string;
  segmentId: string;
  encoding: "mp3" | "pcm";
};

/**
 * Six books, two chapters each, three segments per chapter, and a take on the
 * first two segments of every chapter (the third stays unrecorded): 6 books,
 * 12 chapters, 36 segments, 24 takes. The takes alternate MP3 / PCM, so 12
 * clips of each encoding. Segment status follows the encoding (a finished
 * segment holds an MP3). Clip bytes differ per clip, so a swapped or truncated
 * clip cannot pass for the right one.
 */
async function seedShelf(
  db: Awaited<ReturnType<typeof openLegacyV9>>,
  books: readonly SeedBook[]
): Promise<SeededClip[]> {
  const clips: SeededClip[] = [];
  let clipCount = 0;
  for (const book of books) {
    const chapterIds = [1, 2].map((n) => `${book.id}-ch${n}`);
    await db.put("books", {
      ...book,
      languageCode: book.languageCode ?? null,
      chapterIds,
      updatedAt: book.createdAt + 1,
      coverColourKey: null,
    });
    for (const [chapterIndex, chapterId] of chapterIds.entries()) {
      const segmentIds = [1, 2, 3].map((n) => `${chapterId}-s${n}`);
      await db.put("chapters", {
        id: chapterId,
        bookId: book.id,
        number: chapterIndex + 1,
        name: chapterIndex === 0 ? "Mark 6" : null,
        segmentIds,
      });
      for (const [segmentIndex, segmentId] of segmentIds.entries()) {
        const recorded = segmentIndex < 2;
        const encoding = clipCount % 2 === 0 ? "mp3" : "pcm";
        const clipId = `${segmentId}-clip`;
        const takeId = `${segmentId}-take`;
        await db.put("segments", {
          id: segmentId,
          chapterId,
          index: segmentIndex + 1,
          reference: null,
          label: segmentIndex === 0 ? "verses 1-2" : null,
          activeTakeId: recorded ? takeId : null,
          status: !recorded
            ? "not-started"
            : encoding === "mp3"
              ? "affirmed"
              : "draft",
        });
        if (!recorded) continue;
        clipCount++;
        clips.push({ clipId, segmentId, encoding });
        await db.put("takes", {
          id: takeId,
          segmentId,
          clipId,
          createdAt: 100 + clipCount,
          durationMs: 1000 + clipCount,
        });
        const bytes =
          encoding === "mp3"
            ? Uint8Array.from([0xff, 0xfb, clipCount, clipCount + 1, 7])
            : new Uint8Array(
                Int16Array.from([clipCount, -clipCount, 3, 4]).buffer
              );
        await db.put("clipMeta", {
          id: clipId,
          sampleRate: 44100,
          frameCount: encoding === "mp3" ? 1152 : 4,
          durationMs: 1000 + clipCount,
          createdAt: 100 + clipCount,
          encoding,
          generation: encoding === "mp3" ? 1 : 0,
          byteLength: bytes.byteLength,
          peaks: null,
          transcodeStallCount: 0,
        });
        await db.put("clipData", bytes.buffer.slice(0), clipId);
      }
    }
  }
  return clips;
}

/** Every row of every store but `books`, and the clip bytes as plain arrays. */
async function snapshotNonBookStores(db: IDBPDatabase<TcMobileDb>) {
  const stores = ["chapters", "segments", "takes", "clipMeta"] as const;
  const rows = Object.fromEntries(
    await Promise.all(stores.map(async (s) => [s, await db.getAll(s)] as const))
  );
  const keys = (await db.getAllKeys("clipData")) as string[];
  const data = Object.fromEntries(
    await Promise.all(
      keys.map(
        async (k) =>
          [
            k,
            Array.from(
              new Uint8Array(
                (await db.get("clipData", k as never)) as ArrayBuffer
              )
            ),
          ] as const
      )
    )
  );
  return { rows, data };
}

async function expectEveryRecordingResolves(clips: readonly SeededClip[]) {
  const { loadSegmentClip } = await import("@/lib/storage/segment-audio");
  expect(clips).toHaveLength(24);
  expect(clips.filter((c) => c.encoding === "mp3")).toHaveLength(12);
  const db = await getDb();
  for (const { clipId, segmentId, encoding } of clips) {
    const audio = await loadSegmentClip(segmentId as never);
    expect(audio.kind).toBe("resolved");
    if (audio.kind !== "resolved") continue;
    expect(audio.clip.encoding).toBe(encoding);
    expect(audio.clip.meta.id).toBe(clipId);
    const stored = new Uint8Array(
      (await db.get("clipData", clipId as never)) as ArrayBuffer
    );
    const read =
      audio.clip.encoding === "mp3"
        ? audio.clip.mp3
        : new Uint8Array(audio.clip.samples.buffer);
    expect(Array.from(read)).toEqual(Array.from(stored));
  }
}

// Newest first; "Book 2" is a typed look-alike (not the 3-digit placeholder),
// and b4/b5 tie on createdAt so only the key order separates them. b5 carries a
// language tag, which v12 keeps (R12: the existing field is the language).
const SHELF: readonly SeedBook[] = [
  { id: "b1", name: "Book 001", createdAt: 10 },
  { id: "b2", name: "Mark", createdAt: 60 },
  { id: "b3", name: "Book 2", createdAt: 30 },
  { id: "b4", name: "Book 1000", createdAt: 50 },
  { id: "b5", name: "Luke", createdAt: 50, languageCode: "swh" },
  { id: "b6", name: "Book 003", createdAt: 20 },
];
const SHELF_ORDER_1_0_X = ["b2", "b4", "b5", "b3", "b6", "b1"];

/** What v10 makes of SHELF's names: the slot each book holds afterwards. */
const SHELF_SLOTS: Record<string, [string | null, number]> = {
  b1: [null, 1],
  b2: ["Mark", 2],
  b3: ["Book 2", 4],
  b4: [null, 1000],
  b5: ["Luke", 5],
  b6: [null, 3],
};

/** SHELF as v10 stored it: slots written, no shelf position. */
const SHELF_V10: readonly SeedBook[] = SHELF.map((b) => ({
  ...b,
  name: SHELF_SLOTS[b.id]![0],
  number: SHELF_SLOTS[b.id]![1],
}));

/** SHELF as v11 stored it: slots and the shelf position 1.0.x showed. */
const SHELF_V11: readonly SeedBook[] = SHELF_V10.map((b) => ({
  ...b,
  shelfPosition: SHELF_ORDER_1_0_X.indexOf(b.id),
}));

/**
 * The before/after comparison narrowed field by field for v12
 * (docs/design/v12-schema.md, "Narrowing the whole-shelf test"), not loosened:
 *
 * - takes, clipMeta and the clip bytes keep a full `toEqual` (M5 dies here);
 * - every chapter and segment row's key set is exactly the before-row's keys
 *   plus the three v12 keys, each of them `null` (a stamped clock value, or a
 *   missing or extra key, fails);
 * - with exactly those keys removed, the row equals the before-row, so a
 *   chapter's `number` and every other stored field is pinned unchanged.
 */
function expectNarrowedToBefore(
  after: Awaited<ReturnType<typeof snapshotNonBookStores>>,
  before: Awaited<ReturnType<typeof snapshotNonBookStores>>
): void {
  expect(after.data).toEqual(before.data);
  expect(after.rows.takes).toEqual(before.rows.takes);
  expect(after.rows.clipMeta).toEqual(
    (before.rows.clipMeta as object[]).map((row) => ({ ...row, ...V14_CLIP }))
  );
  for (const store of ["chapters", "segments"] as const) {
    const added = store === "segments" ? V13_SEGMENT : V12_ROW;
    const addedKeys = Object.keys(added);
    const priorRows = before.rows[store] as unknown as Record<
      string,
      unknown
    >[];
    const rows = after.rows[store] as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(priorRows.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const [i, row] of rows.entries()) {
      const prior = priorRows[i]!;
      expect(Object.keys(row).sort()).toEqual(
        [...Object.keys(prior), ...addedKeys].sort()
      );
      for (const [key, value] of Object.entries(added)) {
        expect(row[key]).toBe(value);
      }
      const rest = Object.fromEntries(
        Object.entries(row).filter(([key]) => !addedKeys.includes(key))
      );
      expect(rest).toEqual(prior);
    }
  }
}

/**
 * Every book row, whole: the seeded fields, the v10/v11 fields, and the v12
 * backfill. A `toEqual`, because `toMatchObject` passes an unexpected extra
 * field (a `language` key, say).
 */
async function expectV12Books(db: IDBPDatabase<TcMobileDb>): Promise<void> {
  const rows = await db.getAll("books");
  expect(rows).toHaveLength(SHELF.length);
  for (const book of rows) {
    const seeded = SHELF.find((s) => s.id === book.id)!;
    expect(book).toEqual({
      id: seeded.id,
      name: SHELF_SLOTS[seeded.id]![0],
      number: SHELF_SLOTS[seeded.id]![1],
      languageCode: seeded.languageCode ?? null,
      chapterIds: [`${seeded.id}-ch1`, `${seeded.id}-ch2`],
      createdAt: seeded.createdAt,
      updatedAt: seeded.createdAt + 1,
      coverColourKey: null,
      shelfPosition: SHELF_ORDER_1_0_X.indexOf(seeded.id),
      provenance: { kind: "blank" },
      licence: null,
      modifiedAt: null,
    });
  }
  expect((await db.get("books", "b5" as never))?.languageCode).toBe("swh");
  // The two v12 stores arrive empty: no backfill writes either.
  expect(await db.getAll("tombstones")).toEqual([]);
  expect(await db.getAll("pendingTakes")).toEqual([]);
}

describe("a whole shelf survives the upgrade to the current version (#1421)", () => {
  // A finite clock: a backfill that stamped the upgrade time would carry this
  // number into a row, and `expectNarrowedToBefore` asks for null (M13).
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("v9 → v13: every non-book row and clip byte is identical and every recording resolves", async () => {
    const v9 = await openLegacyV9();
    const clips = await seedShelf(v9, SHELF);
    const before = await snapshotNonBookStores(
      v9 as unknown as IDBPDatabase<TcMobileDb>
    );
    expect(before.rows.chapters).toHaveLength(12);
    expect(before.rows.segments).toHaveLength(36);
    expect(before.rows.takes).toHaveLength(24);
    v9.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expectNarrowedToBefore(await snapshotNonBookStores(db), before);
    await expectEveryRecordingResolves(clips);

    // The shelf reads in the order 1.0.x showed it.
    expect((await listBooks()).map((b) => b.id)).toEqual(SHELF_ORDER_1_0_X);
    const { strings } = await import("@/lib/strings");
    const headings = Object.fromEntries(
      (await listBooks()).map((b) => [
        b.id,
        strings.bookHeading(b.name, b.number),
      ])
    );
    expect(headings).toEqual({
      b1: "Book 001",
      b2: "Mark",
      b3: "Book 2",
      b4: "Book 1000",
      b5: "Luke",
      b6: "Book 003",
    });
    // The rendered placeholder is taken back off the row and becomes a slot;
    // a typed name (including the look-alike "Book 2") is kept, with a free
    // slot. Only the book rows changed, and only in the fields the steps own.
    await expectV12Books(db);
  });

  it("v10 → v13: the same shelf, with slots already written", async () => {
    const v10 = await openLegacyV10();
    const clips = await seedShelf(v10, SHELF_V10);
    const before = await snapshotNonBookStores(
      v10 as unknown as IDBPDatabase<TcMobileDb>
    );
    v10.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expectNarrowedToBefore(await snapshotNonBookStores(db), before);
    await expectEveryRecordingResolves(clips);
    expect((await listBooks()).map((b) => b.id)).toEqual(SHELF_ORDER_1_0_X);
    await expectV12Books(db);
  });

  it("v11 → v13: the same shelf, with slots and positions already written", async () => {
    const v11 = await openLegacyV11();
    const clips = await seedShelf(v11, SHELF_V11);
    const before = await snapshotNonBookStores(
      v11 as unknown as IDBPDatabase<TcMobileDb>
    );
    v11.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expectNarrowedToBefore(await snapshotNonBookStores(db), before);
    await expectEveryRecordingResolves(clips);
    expect((await listBooks()).map((b) => b.id)).toEqual(SHELF_ORDER_1_0_X);
    await expectV12Books(db);
  });
});

// ---------------------------------------------------------------------------
// v12 (#1462): provenance, licence, timestamps, template keys; two new stores
// ---------------------------------------------------------------------------

/**
 * Stand up the v11 schema — v10's stores, unchanged (v11 was a book-row pass,
 * not a structure change). Rows written here carry everything v11 wrote and
 * none of the v12 fields.
 */
async function openLegacyV11() {
  const legacy = await openLegacyV10();
  legacy.close();
  return openDB(DB_NAME, 11);
}

const v11Book = (id: string, chapterIds: string[] = []) => ({
  id,
  name: "Mark",
  number: 1,
  languageCode: "swh",
  chapterIds,
  createdAt: 3,
  updatedAt: 4,
  coverColourKey: "forest",
  shelfPosition: 0,
});
const v11Chapter = (id: string, number: number, segmentIds: string[] = []) => ({
  id,
  bookId: "b1",
  number,
  name: null,
  segmentIds,
});
const v11Segment = (id: string, index = 1) => ({
  id,
  chapterId: "ch1",
  index,
  reference: null,
  label: "verses 1-2",
  activeTakeId: null,
  status: "draft",
});

/**
 * Count the row writes the upgrade makes, per store, through either path a
 * step can write by: a cursor `update` or a store `put`.
 */
function countWrites(): Record<string, number> {
  const writes: Record<string, number> = {};
  const realUpdate = IDBCursor.prototype.update;
  const realPut = IDBObjectStore.prototype.put;
  vi.spyOn(IDBCursor.prototype, "update").mockImplementation(function (
    this: IDBCursor,
    ...args
  ) {
    const name = (this.source as IDBObjectStore).name;
    writes[name] = (writes[name] ?? 0) + 1;
    return realUpdate.apply(this, args);
  });
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    writes[this.name] = (writes[this.name] ?? 0) + 1;
    return realPut.apply(this, args);
  });
  return writes;
}

describe("the v11 → v12 schema (#1462)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives a book blank provenance, no licence and no modifiedAt, and keeps its language", async () => {
    const v11 = await openLegacyV11();
    await v11.put("books", v11Book("b1", ["ch1"]));
    v11.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect(await db.get("books", "b1" as never)).toEqual({
      ...v11Book("b1", ["ch1"]),
      provenance: { kind: "blank" },
      licence: null,
      modifiedAt: null,
    });
  });

  it("gives a chapter null createdAt, modifiedAt and templateKey, and keeps its number", async () => {
    const v11 = await openLegacyV11();
    await v11.put("chapters", v11Chapter("ch1", 6, ["s1"]));
    v11.close();

    const db = await getDb();
    expect(await db.get("chapters", "ch1" as never)).toEqual({
      ...v11Chapter("ch1", 6, ["s1"]),
      ...V12_ROW,
    });
  });

  it("gives a segment null createdAt, modifiedAt and templateKey, and keeps everything else", async () => {
    // M4: a v12 step without the segments walk dies here.
    const v11 = await openLegacyV11();
    await v11.put("segments", v11Segment("s1"));
    await v11.put("segments", v11Segment("s2", 2));
    v11.close();

    const db = await getDb();
    expect(await db.getAll("segments")).toEqual([
      { ...v11Segment("s1"), ...V13_SEGMENT },
      { ...v11Segment("s2", 2), ...V13_SEGMENT },
    ]);
  });

  it("keeps chapter numbers that differ from their position, and the chapter order (R7)", async () => {
    // `number` is the real chapter number from v12 on, and today's stored
    // value is kept as it is: no renumbering from position, in either order.
    const v11 = await openLegacyV11();
    await v11.put("books", v11Book("b1", ["chA", "chB", "chC"]));
    await v11.put("chapters", v11Chapter("chA", 7));
    await v11.put("chapters", v11Chapter("chB", 2));
    await v11.put("chapters", v11Chapter("chC", 2));
    v11.close();

    const db = await getDb();
    expect((await db.get("books", "b1" as never))?.chapterIds).toEqual([
      "chA",
      "chB",
      "chC",
    ]);
    expect((await db.getAll("chapters")).map((c) => [c.id, c.number])).toEqual([
      ["chA", 7],
      ["chB", 2],
      ["chC", 2],
    ]);
  });

  it("leaves a row that already carries createdAt alone", async () => {
    // M1: a stamp with no absence check overwrites the 5.
    const v11 = await openLegacyV11();
    await v11.put("chapters", { ...v11Chapter("ch1", 1), createdAt: 5 });
    await v11.put("segments", { ...v11Segment("s1"), createdAt: 5 });
    v11.close();

    const db = await getDb();
    expect(await db.get("chapters", "ch1" as never)).toEqual({
      ...v11Chapter("ch1", 1),
      ...V12_ROW,
      createdAt: 5,
    });
    expect(await db.get("segments", "s1" as never)).toEqual({
      ...v11Segment("s1"),
      ...V13_SEGMENT,
      createdAt: 5,
    });
  });

  it("a row carrying every v12 field, nullable ones null, is left identical and not written", async () => {
    // M2: a value test (`row.templateKey == null`) reads the deliberate null
    // as missing and restamps the row; the write count catches a rewrite that
    // happens to leave the same values.
    const book = {
      ...v11Book("b1"),
      provenance: {
        kind: "template",
        template: { id: "pkg", version: "1.0.0", kind: "collection" },
        attribution: "Text: CC BY-SA 4.0",
      },
      licence: "CC-BY-SA-4.0",
      modifiedAt: null,
    };
    const chapter = {
      ...v11Chapter("ch1", 1),
      createdAt: 5,
      modifiedAt: 7,
      templateKey: null,
    };
    const segment = {
      ...v11Segment("s1"),
      createdAt: 5,
      modifiedAt: null,
      templateKey: "01-07",
    };
    const v11 = await openLegacyV11();
    await v11.put("books", book);
    await v11.put("chapters", chapter);
    await v11.put("segments", segment);
    v11.close();

    const writes = countWrites();
    const db = await getDb();
    // The v12 pass writes nothing; v13's walk gives the segment its revision.
    expect(writes).toEqual({ segments: 1 });
    vi.restoreAllMocks();
    expect(await db.get("books", "b1" as never)).toEqual(book);
    expect(await db.get("chapters", "ch1" as never)).toEqual(chapter);
    expect(await db.get("segments", "s1" as never)).toEqual({
      ...segment,
      audioRevision: 0,
    });
  });

  it("writes each row that lacks fields exactly once, and nothing else", async () => {
    // One put per row at most: the fields a row lacks go in one update. A
    // second put, or a write to any other store, changes these counts.
    const v11 = await openLegacyV11();
    await v11.put("books", v11Book("b1"));
    await v11.put("books", { ...v11Book("b2"), licence: null });
    await v11.put("chapters", v11Chapter("ch1", 1));
    await v11.put("segments", v11Segment("s1"));
    await v11.put("segments", { ...v11Segment("s2"), templateKey: null });
    v11.close();

    const writes = countWrites();
    await getDb();
    // Segments: one v12 write and one v13 write each, never more.
    expect(writes).toEqual({ books: 2, chapters: 1, segments: 4 });
  });

  it("reads no clock: every backfilled timestamp is null under a finite fake clock", async () => {
    // M13: `modifiedAt: Date.now()` (or any per-row clock read) would put an
    // upgrade time in a row that a merger reads as a real user write.
    const v11 = await openLegacyV11();
    await v11.put("books", v11Book("b1"));
    await v11.put("chapters", v11Chapter("ch1", 1));
    await v11.put("segments", v11Segment("s1"));
    v11.close();

    // Whether `Date.now` is called at all cannot be asserted: fake-indexeddb
    // reads it itself. The values are what the clock would leak into.
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    const db = await getDb();
    expect((await db.get("books", "b1" as never))?.modifiedAt).toBeNull();
    for (const store of ["chapters", "segments"] as const) {
      for (const row of await db.getAll(store)) {
        expect(row.createdAt).toBeNull();
        expect(row.modifiedAt).toBeNull();
      }
    }
  });

  it("creates both new stores, empty, on a fresh install: ten stores in all with v13's", async () => {
    const db = await getDb();
    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      "books",
      "chapters",
      "clipData",
      "clipMeta",
      "failures",
      "pendingTakes",
      "segments",
      "takeDispositions",
      "takes",
      "tombstones",
    ]);
    expect(await db.count("tombstones")).toBe(0);
    expect(await db.count("pendingTakes")).toBe(0);
  });

  it("pendingTakes is keyed by segment: two puts for one segment leave one row", async () => {
    // M8: a `clipId` keyPath keeps both rows.
    const db = await getDb();
    const row = (clipId: string) => ({
      segmentId: "s1",
      ordinal: 1,
      clipId,
      base: { kind: "inline", samples: new ArrayBuffer(0) },
      recorded: new ArrayBuffer(4),
      sampleRate: 48000,
      offset: 0,
      finished: false,
      editOnly: false,
      createdAt: 1,
    });
    await db.put("pendingTakes", row("c1") as never);
    await db.put("pendingTakes", row("c2") as never);
    const rows = await db.getAll("pendingTakes");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clipId).toBe("c2");
  });

  it("tombstones is a log: two deletions of one id are two rows, in order", async () => {
    // An entity-id key would let the second delete overwrite the first.
    const db = await getDb();
    const stone = (deletedAt: number) => ({
      entity: "segment",
      entityId: "s1",
      parentId: "ch1",
      deletedAt,
    });
    await db.add("tombstones", stone(1) as never);
    await db.add("tombstones", stone(2) as never);
    expect(await db.getAll("tombstones")).toEqual([stone(1), stone(2)]);
  });
});

// ---------------------------------------------------------------------------
// v13 (#38): the audio revision, the disposition store, the base-clip index
// (docs/design/pending-take-lifecycle.md §2)
// ---------------------------------------------------------------------------

/** Stand up the v12 schema: v11's stores plus `tombstones` and `pendingTakes`. */
async function openLegacyV12() {
  const legacy = await openLegacyV11();
  legacy.close();
  return openDB(DB_NAME, 12, {
    upgrade(db) {
      db.createObjectStore("tombstones", { autoIncrement: true });
      db.createObjectStore("pendingTakes", { keyPath: "segmentId" });
    },
  });
}

const v12Segment = (id: string, extra: Record<string, unknown> = {}) => ({
  ...v11Segment(id),
  ...V12_ROW,
  ...extra,
});

/** A pending row as a v12 build wrote it: no `baseRevision`. */
const v12PendingRow = (
  segmentId: string,
  clipId: string,
  base: Record<string, unknown>
) => ({
  segmentId,
  ordinal: 1,
  clipId,
  base,
  recorded: Int16Array.from([5, 6, 7]).buffer,
  sampleRate: 48000,
  offset: 0,
  finished: false,
  editOnly: false,
  createdAt: 9,
});

/** Every row of every store, and the clip bytes as plain arrays. */
async function snapshotAll(db: IDBPDatabase<TcMobileDb>) {
  const stores = [
    "books",
    "chapters",
    "segments",
    "takes",
    "clipMeta",
    "tombstones",
    "pendingTakes",
    "failures",
  ] as const;
  const rows = Object.fromEntries(
    await Promise.all(stores.map(async (s) => [s, await db.getAll(s)] as const))
  ) as Record<(typeof stores)[number], unknown[]>;
  const keys = (await db.getAllKeys("clipData")) as string[];
  const data: Record<string, number[]> = {};
  for (const k of keys) {
    data[k] = Array.from(
      new Uint8Array((await db.get("clipData", k as never)) as ArrayBuffer)
    );
  }
  return { rows, data };
}

describe("the v12 → v13 schema (#38)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps every row of a seeded v12 shelf: segments gain only audioRevision 0, every other row and clip byte is identical", async () => {
    // R4, and the device case: a phone holding v12 data upgrades without
    // losing a row. A whole shelf with v12 fields, a stored and an inline
    // pending row, a tombstone and a failure-log row.
    const v12 = await openLegacyV12();
    const clips = await seedShelf(v12, SHELF_V11);
    for (const store of ["books", "chapters", "segments"] as const) {
      const fill = store === "books" ? V12_BOOK : V12_ROW;
      for (const row of await v12.getAll(store)) {
        await v12.put(store, { ...row, ...fill });
      }
    }
    const pcm = clips.find((c) => c.encoding === "pcm")!;
    await v12.put(
      "pendingTakes",
      v12PendingRow(pcm.segmentId, "pending-stored", {
        kind: "stored",
        sourceClipId: pcm.clipId,
        generation: 0,
        frameCount: 4,
      })
    );
    await v12.put(
      "pendingTakes",
      v12PendingRow("b1-ch1-s3", "pending-inline", {
        kind: "inline",
        samples: Int16Array.from([1, 2]).buffer,
      })
    );
    await v12.add("tombstones", {
      entity: "segment",
      entityId: "gone",
      parentId: "b1-ch1",
      deletedAt: 3,
    });
    await v12.add("failures", { at: 1, context: "save-take", name: "E" });
    const before = await snapshotAll(
      v12 as unknown as IDBPDatabase<TcMobileDb>
    );
    expect(before.rows.segments).toHaveLength(36);
    expect(before.rows.pendingTakes).toHaveLength(2);
    v12.close();

    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    const after = await snapshotAll(db);
    expect(after.data).toEqual(before.data);
    for (const store of Object.keys(before.rows) as Array<
      keyof typeof before.rows
    >) {
      if (store === "segments" || store === "clipMeta") continue;
      expect(after.rows[store]).toEqual(before.rows[store]);
    }
    expect(after.rows.segments).toEqual(
      (before.rows.segments as object[]).map((s) => ({
        ...s,
        audioRevision: 0,
      }))
    );
    expect(after.rows.clipMeta).toEqual(
      (before.rows.clipMeta as object[]).map((c) => ({ ...c, ...V14_CLIP }))
    );
    await expectEveryRecordingResolves(clips);
    expect(await db.count("takeDispositions")).toBe(0);
  });

  it("v12 → v13 gives every segment audioRevision 0, recorded or not, and reads no clock", async () => {
    // R2 (the walk) and R3 (no clock): a backfill of `Date.now()` would carry
    // this finite value into the row.
    const v12 = await openLegacyV12();
    await v12.put("segments", v12Segment("s1"));
    await v12.put("segments", v12Segment("s2", { activeTakeId: "t2" }));
    v12.close();

    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    const db = await getDb();
    expect(await db.getAll("segments")).toEqual([
      { ...v12Segment("s1"), audioRevision: 0 },
      { ...v12Segment("s2", { activeTakeId: "t2" }), audioRevision: 0 },
    ]);
  });

  it("v13 leaves a segment that already carries audioRevision alone", async () => {
    // R1: a stamp with no absence check overwrites the 5.
    const v12 = await openLegacyV12();
    await v12.put("segments", v12Segment("s1", { audioRevision: 5 }));
    v12.close();

    const writes = countWrites();
    const db = await getDb();
    expect(writes).toEqual({});
    vi.restoreAllMocks();
    expect((await db.get("segments", "s1" as never))?.audioRevision).toBe(5);
  });

  it("v13 indexes a stored base's clip and leaves inline rows out of the index", async () => {
    // R7: without `bySourceClip` the index read throws NotFoundError.
    const v12 = await openLegacyV12();
    await v12.put(
      "pendingTakes",
      v12PendingRow("s1", "p1", {
        kind: "stored",
        sourceClipId: "base-clip",
        generation: 0,
        frameCount: 4,
      })
    );
    await v12.put(
      "pendingTakes",
      v12PendingRow("s2", "p2", { kind: "inline", samples: new ArrayBuffer(0) })
    );
    v12.close();

    const db = await getDb();
    const index = db.transaction("pendingTakes").store.index("bySourceClip");
    expect(await index.getAllKeys("base-clip" as never)).toEqual(["s1"]);
    expect(await index.count()).toBe(1);
  });

  it("v13 indexes a disposition by its segment", async () => {
    // R8: without `bySegment` the delete clean-up cannot find a segment's
    // records; the index read throws NotFoundError.
    const db = await getDb();
    const record = (clipId: string, segmentId: string) => ({
      clipId,
      segmentId,
      kind: "saved",
      at: 1,
    });
    await db.put("takeDispositions", record("c1", "s1") as never);
    await db.put("takeDispositions", record("c2", "s1") as never);
    await db.put("takeDispositions", record("c3", "s2") as never);
    expect(
      await db.getAllKeysFromIndex(
        "takeDispositions",
        "bySegment",
        "s1" as never
      )
    ).toEqual(["c1", "c2"]);
  });

  it("a fresh install opens at the current version with an empty takeDispositions, and addSegment writes audioRevision 0", async () => {
    const db = await getDb();
    expect(db.version).toBe(APP_VERSION);
    expect(await db.count("takeDispositions")).toBe(0);
    const { addChapter, addSegment, createBook } =
      await import("@/lib/storage/books");
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    expect((await addSegment(chapter.id)).audioRevision).toBe(0);
  });

  it("a database at the current version refuses an open at 12, and every row and clip byte is unchanged", async () => {
    // What a build at 12 meets: IndexedDB's VersionError, which that build's
    // `getDb` maps to DatabaseDowngradeError (tests/db-open.test.ts pins the
    // mapping). Nothing is written.
    const v12 = await openLegacyV12();
    await seedShelf(v12, SHELF_V11);
    v12.close();
    const db = await getDb();
    const before = await snapshotAll(db);
    await closeDb();

    await expect(openDB(DB_NAME, 12)).rejects.toMatchObject({
      name: "VersionError",
    });
    const raw = await openDB(DB_NAME);
    expect(raw.version).toBe(APP_VERSION);
    expect(
      await snapshotAll(raw as unknown as IDBPDatabase<TcMobileDb>)
    ).toEqual(before);
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// v14 (#1433): the clip's processing record
// ---------------------------------------------------------------------------

/** Stand up the v13 schema: v12's stores plus `takeDispositions` and the base index. */
async function openLegacyV13() {
  const legacy = await openLegacyV12();
  legacy.close();
  return openDB(DB_NAME, 13, {
    upgrade(_db, _old, _new, tx) {
      _db
        .createObjectStore("takeDispositions", { keyPath: "clipId" })
        .createIndex("bySegment", "segmentId");
      tx.objectStore("pendingTakes").createIndex(
        "bySourceClip",
        "base.sourceClipId"
      );
    },
  });
}

/** A clip row as a v13 build wrote it: no `processing`. */
const v13ClipMeta = (id: string, encoding: "pcm" | "mp3") => ({
  id,
  sampleRate: 44100,
  frameCount: 10,
  durationMs: 1,
  createdAt: 7,
  encoding,
  generation: encoding === "mp3" ? 1 : 0,
  byteLength: encoding === "mp3" ? 4 : 20,
  transcodeStallCount: 0,
  peaks: null,
});

describe("the v13 → v14 schema (#1433)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives every clip row processing null and changes nothing else, reading no clock", async () => {
    const v13 = await openLegacyV13();
    await v13.put("clipMeta", v13ClipMeta("pcm-1", "pcm"));
    await v13.put("clipMeta", v13ClipMeta("mp3-1", "mp3"));
    await v13.put("clipData", Int16Array.from([1, 2]).buffer, "pcm-1");
    await v13.put("segments", { ...v12Segment("s1"), audioRevision: 3 });
    const before = await snapshotAll(
      v13 as unknown as IDBPDatabase<TcMobileDb>
    );
    v13.close();

    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    const db = await getDb();
    expect(db.version).toBe(14);
    const after = await snapshotAll(db);
    // U6c: an already-finished clip is not back-filled with a record, only null.
    expect(after.rows.clipMeta).toEqual([
      { ...v13ClipMeta("mp3-1", "mp3"), processing: null },
      { ...v13ClipMeta("pcm-1", "pcm"), processing: null },
    ]);
    expect(after.data).toEqual(before.data);
    for (const store of Object.keys(before.rows) as Array<
      keyof typeof before.rows
    >) {
      if (store === "clipMeta") continue;
      expect(after.rows[store]).toEqual(before.rows[store]);
    }
  });

  it("leaves a clip row that already carries processing alone, and writes nothing", async () => {
    const record = {
      stages: [{ id: "hpf", version: 1 }],
      measuredLufs: -20,
      measuredTruePeakDbtp: -3,
      appliedGainDb: 1,
    };
    const v13 = await openLegacyV13();
    await v13.put("clipMeta", {
      ...v13ClipMeta("c1", "mp3"),
      processing: record,
    });
    v13.close();

    const writes = countWrites();
    const db = await getDb();
    expect(writes).toEqual({});
    vi.restoreAllMocks();
    expect((await db.get("clipMeta", "c1" as never))?.processing).toEqual(
      record
    );
  });

  it("records no stage on a Finished segment's PCM clip, so its owed transcode encodes it as it was (U6c)", async () => {
    // Frank R1 P2 on #1679: null would let the first sweep normalize it.
    const v13 = await openLegacyV13();
    const take = (id: string, clipId: string, segmentId: string) => ({
      id,
      segmentId,
      clipId,
      createdAt: 1,
      durationMs: 1,
    });
    const seg = (id: string, takeId: string, status: string) => ({
      ...v12Segment(id, { activeTakeId: takeId, status }),
      audioRevision: 0,
    });
    // Finished and still PCM: the owed transcode.
    await v13.put("segments", seg("s1", "t1", "affirmed"));
    await v13.put("takes", take("t1", "pcm-finished", "s1"));
    await v13.put("clipMeta", v13ClipMeta("pcm-finished", "pcm"));
    // Recorded, not finished: Finished after the upgrade normalizes it.
    await v13.put("segments", seg("s2", "t2", "draft"));
    await v13.put("takes", take("t2", "pcm-draft", "s2"));
    await v13.put("clipMeta", v13ClipMeta("pcm-draft", "pcm"));
    // Finished and already MP3: nothing is owed, null as before.
    await v13.put("segments", seg("s3", "t3", "affirmed"));
    await v13.put("takes", take("t3", "mp3-finished", "s3"));
    await v13.put("clipMeta", v13ClipMeta("mp3-finished", "mp3"));
    // An earlier take's clip, no longer active: not what the sweep reads.
    await v13.put("clipMeta", v13ClipMeta("pcm-orphan", "pcm"));
    v13.close();

    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    const db = await getDb();
    const processing = async (id: string) =>
      (await db.get("clipMeta", id as never))?.processing;
    expect(await processing("pcm-finished")).toEqual({
      stages: [],
      measuredLufs: null,
      measuredTruePeakDbtp: null,
      appliedGainDb: 0,
    });
    expect(await processing("pcm-draft")).toBeNull();
    expect(await processing("mp3-finished")).toBeNull();
    expect(await processing("pcm-orphan")).toBeNull();
  });

  it("a fresh clip is written with processing null", async () => {
    const { buildClipMeta } = await import("@/lib/storage/clips");
    expect(
      buildClipMeta("c" as never, Int16Array.of(1), 44100, 0).processing
    ).toBeNull();
  });
});
