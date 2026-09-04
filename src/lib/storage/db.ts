/**
 * IndexedDB schema.
 *
 * Audio never leaves the device in Phase 1, so this is the system of record —
 * not a cache. Losing it means losing a translator's work, which is why the
 * repository functions are unit-tested against fake-indexeddb rather than left
 * to on-device spot checks.
 *
 * Clip metadata and clip samples live in separate stores on purpose: listing
 * a chapter must not pull megabytes of PCM into memory just to show durations.
 *
 * ── Append-only migration is deliberately WAIVED for the pivot (v3) ──
 *
 * Recorded as a DRI decision in docs/decisions/0008-pivot-destructive-recreate.md
 * (a code comment cannot waive a repository rule; that ADR is the authority).
 *
 * Append-only migration is the discipline this database normally holds to,
 * because a field device may be several versions behind and its recordings are
 * unrecoverable. The v3 upgrade breaks it once, on purpose. This is pre-alpha
 * software with no field data — the cheapest moment a destructive schema
 * change will ever cost. The v3 upgrade drops EVERY existing store (including
 * any recorded clips on a dev device) and recreates the pivot schema from
 * scratch: `sections` and the never-written `media` store are gone, `segments`
 * are re-indexed by `chapterId` (segments hang off the chapter directly, no
 * Section), `chapters` by `bookId`, and `projects` is renamed to `books`.
 *
 * This is a ONE-TIME destructive recreate. Append-only discipline resumes from
 * v3 onward — the recreate is gated on `oldVersion < 3`, so a future v4 runs
 * only its own additive step and never re-wipes real translator data.
 *
 * `DB_VERSION` must never be reset to 1: dev devices hold v2, and IndexedDB
 * refuses to open at a lower version than the one on disk.
 *
 * ── v4 (B8, D3): clip encoding — append-only, as promised ──
 *
 * `ClipMeta` gained `encoding`, `generation`, `byteLength` and `peaks` so a
 * finished segment's audio can be stored as MP3 with the PCM dropped. The v4
 * step is a BACKFILL, not a recreate: every existing `clipMeta` row is stamped
 * as the PCM it already is. No store is dropped, no bytes are touched, and a
 * v3 device's recordings come through intact — which `tests/db-migration.test.ts`
 * asserts alongside the v2→v3 wipe it also pins.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type {
  Book,
  BookId,
  Chapter,
  ChapterId,
  ClipId,
  Segment,
  SegmentId,
  Take,
  TakeId,
} from "@/types/domain";
import type { ClipMeta } from "@/types/audio";

const DB_NAME = "tc-mobile";
const DB_VERSION = 4;

/**
 * The v3 shape of a `clipMeta` row, before the B8 fields existed. Only the v4
 * backfill reads it; the typed store below already speaks the v4 shape, so the
 * rows are read back through this narrower type to be stamped.
 */
type ClipMetaV3 = Pick<
  ClipMeta,
  "id" | "sampleRate" | "frameCount" | "durationMs" | "createdAt"
> &
  Partial<ClipMeta>;

export interface TcMobileDb extends DBSchema {
  books: { key: BookId; value: Book };
  chapters: {
    key: ChapterId;
    value: Chapter;
    indexes: { bookId: BookId };
  };
  segments: {
    key: SegmentId;
    value: Segment;
    indexes: { chapterId: ChapterId };
  };
  takes: { key: TakeId; value: Take; indexes: { segmentId: SegmentId } };
  clipMeta: { key: ClipId; value: ClipMeta };
  /**
   * The clip's bytes as an ArrayBuffer keyed by ClipId: raw mono 16-bit PCM
   * while the segment is being worked on, the MP3 once it is Finished (B8/D3).
   * `clipMeta.encoding` says which; read them through `clipFromRecord`.
   */
  clipData: { key: ClipId; value: ArrayBuffer };
}

/**
 * The stored database is NEWER than this build asks for — an older app opening
 * data a newer one already wrote (the `autoUpdate` service worker can leave the
 * two running side by side). IndexedDB refuses the open with a `VersionError`;
 * "recovering" by deleting would destroy the newer build's recordings, so this
 * surfaces as a deliberate, retryable failure instead. Its `message` is what the
 * Books-screen Notice shows, so it is written for a person, not a log.
 */
class DatabaseDowngradeError extends Error {
  constructor() {
    super(
      "This app is older than the data on this device. Update the app, then try again."
    );
    this.name = "DatabaseDowngradeError";
  }
}

/**
 * Another copy of this app holds an older connection open (a second tab, or the
 * pre-update page still alive after an `autoUpdate` swap), so this version's
 * upgrade cannot proceed. Without a signal, `idb`'s open pends forever and the
 * Books screen sits on "Loading your books." with no way out. This turns that
 * silent hang into a retryable failure: close the other copy, then try again.
 */
class DatabaseBlockedError extends Error {
  constructor() {
    super(
      "Another copy of this app is open. Close the other tabs or windows, then try again."
    );
    this.name = "DatabaseBlockedError";
  }
}

/**
 * This page instance has yielded to a newer version opening elsewhere (see
 * `blocking`) and must not reopen the database. Because `getDb` always requests
 * the fixed `DB_VERSION`, reopening would re-block at the SAME version the page
 * just yielded from — the still-alive page's next `getDb` (a launch sweep, a
 * transcode commit, any tap) would re-block the newer tab's upgrade indefinitely.
 * Only a page reload — which discards this instance and its flag — recovers.
 */
class DatabaseSupersededError extends Error {
  constructor() {
    super(
      "A newer version of this app is now active. Reload this page to continue."
    );
    this.name = "DatabaseSupersededError";
  }
}

/** A `VersionError` is how IndexedDB reports a downgrade. Matched by name to
 * avoid referencing the DOM's `DOMException` from this DOM-free layer. */
function isVersionError(cause: unknown): boolean {
  return (cause as { name?: string } | null)?.name === "VersionError";
}

let dbPromise: Promise<IDBPDatabase<TcMobileDb>> | null = null;

/**
 * Latched true when this page yields to a newer version (`blocking`). Once set,
 * `getDb` rejects with `DatabaseSupersededError` instead of reopening — the only
 * exit is a reload. Cleared only by `closeDb` (a full teardown: a test reset, or
 * a future "delete all data"), never on the runtime path.
 */
let superseded = false;

/**
 * Open the database, wiring the three lifecycle callbacks `idb` only attaches
 * when supplied, and settling on the FIRST of {open resolves, open rejects,
 * `blocked` fires}. `blocked` is the reason for the manual race: `idb`'s open
 * promise never settles while an older connection blocks it, so the callback is
 * the only signal that the open cannot proceed.
 */
function openDatabase(): Promise<IDBPDatabase<TcMobileDb>> {
  let settled = false;
  return new Promise<IDBPDatabase<TcMobileDb>>((resolve, reject) => {
    void openDB<TcMobileDb>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        // One-time destructive recreate to the pivot schema (v3). See the header
        // for why append-only is waived here. Gated on `oldVersion < 3` so this
        // runs on a fresh install (0) and on the v2 dev schema, but a future
        // v3→v4 upgrade skips it and runs only its own additive step — the
        // append-only discipline the header promises resumes from v3.
        if (oldVersion < 3) {
          // Drop everything first. On a fresh install this list is empty and the
          // loop no-ops; on a v2 device it clears the pre-pivot tree, the empty
          // `media` store, and any dev clips (orphans once the tree is rebuilt).
          for (const name of Array.from(db.objectStoreNames)) {
            db.deleteObjectStore(name);
          }

          db.createObjectStore("books", { keyPath: "id" });

          const chapters = db.createObjectStore("chapters", { keyPath: "id" });
          chapters.createIndex("bookId", "bookId");

          const segments = db.createObjectStore("segments", { keyPath: "id" });
          segments.createIndex("chapterId", "chapterId");

          const takes = db.createObjectStore("takes", { keyPath: "id" });
          takes.createIndex("segmentId", "segmentId");

          db.createObjectStore("clipMeta", { keyPath: "id" });
          db.createObjectStore("clipData");
        }

        // v4 (B8): stamp every pre-existing clip as the PCM it is. Additive — the
        // rows and the audio behind them are kept. On a fresh install, or straight
        // after the v3 recreate above, the store is empty and this loops zero
        // times. Awaiting IDB requests inside the upgrade transaction is idb's
        // documented pattern: the transaction stays alive across them.
        if (oldVersion < 4) {
          const store = tx.objectStore("clipMeta");
          let cursor = await store.openCursor();
          while (cursor) {
            const legacy = cursor.value as ClipMetaV3;
            if (legacy.encoding === undefined) {
              const stamped: ClipMeta = {
                id: legacy.id,
                sampleRate: legacy.sampleRate,
                frameCount: legacy.frameCount,
                durationMs: legacy.durationMs,
                createdAt: legacy.createdAt,
                encoding: "pcm",
                generation: 0,
                byteLength: legacy.frameCount * 2,
                peaks: null,
              };
              await cursor.update(stamped);
            }
            cursor = await cursor.continue();
          }
        }
      },
      blocked() {
        if (settled) return;
        settled = true;
        reject(new DatabaseBlockedError());
      },
      blocking() {
        // A newer version is opening elsewhere and this connection is holding it
        // back. Yield: latch `superseded` so a later getDb rejects (reload
        // needed) rather than reopen at this same v4 and re-block the upgrade,
        // then close and drop the handle so the newer open can proceed. `close`
        // does not abort in-flight transactions — a committing take finishes.
        superseded = true;
        const pending = dbPromise;
        dbPromise = null;
        void pending
          ?.then((db) => db.close())
          .catch(() => {
            // Best-effort close of a connection we are abandoning anyway: the open
            // may have already rejected, or the handle already be closed. There is
            // nothing to recover — the newer version proceeds regardless.
          });
      },
      terminated() {
        // The browser abnormally closed the connection (resource pressure, a
        // discarded tab). Drop the handle so the next getDb reopens a live one —
        // recoverable without a page reload.
        dbPromise = null;
      },
    }).then(
      (db) => {
        if (settled) {
          // `blocked` already rejected this open; the connection finally came
          // through once the other copy closed. Close it so it does not linger
          // as an orphan holding the database open.
          db.close();
          return;
        }
        settled = true;
        resolve(db);
      },
      (cause) => {
        if (settled) return;
        settled = true;
        reject(cause);
      }
    );
  });
}

export function getDb(): Promise<IDBPDatabase<TcMobileDb>> {
  // This page yielded to a newer version. Reopening at v4 would re-block that
  // upgrade, so fail stickily until a reload clears this instance.
  if (superseded) return Promise.reject(new DatabaseSupersededError());
  dbPromise ??= openDatabase().catch((cause: unknown) => {
    // Never cache a rejected open: one failed attempt must not poison every
    // later call. Clear the handle so the next call — a Notice's Try again, or
    // the next storage read — reopens from scratch.
    dbPromise = null;
    throw isVersionError(cause) ? new DatabaseDowngradeError() : cause;
  });
  return dbPromise;
}

/**
 * Close the connection and drop the cached handle.
 *
 * Closing matters: an open connection blocks `indexedDB.deleteDatabase`
 * indefinitely, so clearing the cached promise alone is not enough to let a
 * test (or a future "delete all data" action) actually remove the database.
 */
export async function closeDb(): Promise<void> {
  // A full teardown is a genuinely fresh start, so clear the superseded latch —
  // unconditionally, before the early return below, since a yielded page has
  // already nulled `dbPromise`. Runtime code never calls this, so it does not
  // weaken the sticky-fail; it exists for tests and a future "delete all data".
  superseded = false;
  const pending = dbPromise;
  if (!pending) return;
  dbPromise = null;
  const db = await pending.catch(() => null);
  db?.close();
}
