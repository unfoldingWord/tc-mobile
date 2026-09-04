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
 *
 * ── v5 (#264): chapter names — append-only ──
 *
 * `Chapter` gained an optional `name` (a passage label like "Mark 6"). The v5
 * step stamps `name: null` on every pre-existing chapter row, so a reader never
 * meets `undefined` and the display fallback keys on one shape. Additive, like
 * v4: no store dropped, no other field touched.
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
const DB_VERSION = 5;

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

/** A `VersionError` is how IndexedDB reports a downgrade. Matched by name to
 * avoid referencing the DOM's `DOMException` from this DOM-free layer. */
function isVersionError(cause: unknown): boolean {
  return (cause as { name?: string } | null)?.name === "VersionError";
}

let dbPromise: Promise<IDBPDatabase<TcMobileDb>> | null = null;

/**
 * The `openDB` call that is still in flight, or null when none is.
 *
 * `getDb()`'s promise is NOT this one: a blocked open rejects there while the
 * open itself stays queued, and settles only when the other copy closes. So
 * this is the only handle on the connection that open will eventually receive,
 * and `closeDb()` needs it — without it that connection is orphaned, open, and
 * holding the database against the next upgrade or delete.
 */
let pendingOpen: Promise<IDBPDatabase<TcMobileDb>> | null = null;

/**
 * How many `closeDb()` calls have begun.
 *
 * An open that was already in flight when one began hands its connection to
 * that close, not to the cache: `closeDb` frees the cache slot before it waits,
 * and a connection dropping itself into that freed slot would be a connection
 * the close is about to close — dead the moment the next read is handed it.
 */
let closeGeneration = 0;

/**
 * What the app registers so this layer can ask, at the one instant it matters,
 * whether giving up the connection would cost a translator work — and can say
 * afterwards what it did.
 *
 * The judgement lives in the app, not here: only the screens know whether a
 * take is held or a recording is running. This layer knows only when the
 * question has to be answered, which is inside a `versionchange` handler — so
 * `holdsUnsavedWork` must answer synchronously.
 */
export interface UpgradeCoordinator {
  /**
   * True while closing the connection would strand work that exists only in
   * memory. Called from inside the `versionchange` handler: synchronous, and
   * cheap. If it throws, the connection is NOT given up — the throw leaves the
   * close below unreached, which is the safe way round.
   */
  holdsUnsavedWork: () => boolean;
  /** The connection has been closed for another copy's upgrade. This build
   * cannot reopen the database (its version is now the older one), so the app
   * has to say so and offer a restart. */
  onYielded: () => void;
  /** An open failed because another copy holds an older connection open. */
  onBlocked: () => void;
}

let coordinator: UpgradeCoordinator | null = null;

/**
 * Register the app's coordinator, or `null` to unregister.
 *
 * With none registered the connection is given up on request: nothing is
 * mounted that could be holding a recording, and refusing would block another
 * copy of the app with no screen anywhere to explain why.
 *
 * That default is only ever reached before the app has mounted or after it has
 * unmounted, and it is on the caller to keep it that way: the registration is
 * made ONCE and torn down only on unmount (`hooks/use-database-status.ts`).
 * Re-registering as the app's answer changes would leave a window with no
 * coordinator — and the window would open exactly when a take became held,
 * which is when yielding costs the most. The registered `holdsUnsavedWork` is
 * expected to read the current answer at call time rather than close over one.
 */
export function setUpgradeCoordinator(next: UpgradeCoordinator | null): void {
  coordinator = next;
}

/**
 * Open the database, wiring the four lifecycle callbacks `idb` only attaches
 * when supplied, and settling on the FIRST of {open resolves, open rejects,
 * `blocked` fires}. `blocked` is the reason for the manual race: `idb`'s open
 * promise never settles while an older connection blocks it, so the callback is
 * the only signal that the open cannot proceed.
 */
function openDatabase(): Promise<IDBPDatabase<TcMobileDb>> {
  let settled = false;

  /**
   * The connection THIS open produced, once it has — the synchronous handle
   * `blocking()` closes.
   *
   * It has to be readable without awaiting: `idb` attaches `blocking` as a
   * `versionchange` listener, and a close deferred to a microtask lands after
   * the handler returns, by which time the copy that wants to upgrade has
   * already been told it is blocked (#221). `dbPromise` cannot answer
   * synchronously; this can, and it is per-open, so a callback still attached
   * to a superseded connection acts on that one and not on whatever is current.
   */
  let connection: IDBPDatabase<TcMobileDb> | null = null;

  // Which close this open began under. `pendingOpen` is set below without an
  // await in between, so a later `closeDb()` is guaranteed to have snapshotted
  // this open — and to be waiting to close whatever it produces.
  const bornAt = closeGeneration;

  /**
   * The promise THIS attempt owns in `dbPromise`, and the identity every
   * invalidation below is checked against. A later `getDb()` may already have
   * installed its own live connection there; clearing the cache unconditionally
   * would drop it and leave that connection open with nothing holding it.
   */
  let handle: Promise<IDBPDatabase<TcMobileDb>>;
  const invalidate = (): void => {
    if (dbPromise === handle) dbPromise = null;
  };

  const raced = new Promise<IDBPDatabase<TcMobileDb>>((resolve, reject) => {
    const opening = openDB<TcMobileDb>(DB_NAME, DB_VERSION, {
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

        // v5 (#264): stamp every pre-existing chapter with `name: null`.
        // Additive — only the missing field is added, nothing else is touched.
        // On a fresh install, or straight after the v3 recreate, the store is
        // empty and this loops zero times. Keys on the field being ABSENT, so a
        // row already carrying a name (from a newer build) is left alone.
        if (oldVersion < 5) {
          const store = tx.objectStore("chapters");
          let cursor = await store.openCursor();
          while (cursor) {
            const legacy = cursor.value as Chapter & { name?: string | null };
            if (legacy.name === undefined) {
              await cursor.update({ ...legacy, name: null });
            }
            cursor = await cursor.continue();
          }
        }
      },
      blocked() {
        if (settled) return;
        settled = true;
        reject(new DatabaseBlockedError());
        // The rejection reaches whoever called `getDb()`; this reaches the app
        // as a whole, which is what puts the "close the other copy" screen up
        // wherever the person happens to be standing.
        coordinator?.onBlocked();
      },
      blocking() {
        // Another copy of the app is upgrading the database and THIS connection
        // is what stands in its way.
        //
        // Everything here is synchronous on purpose. `idb` attaches this as a
        // `versionchange` listener, so a close deferred to a microtask lands
        // after the handler has returned — and the other copy has already been
        // told it is blocked by then, which is the bug this shape exists to
        // avoid (#221).
        if (connection === null) return;

        // The decision this implements: unsaved audio outranks the upgrade.
        // Refusing leaves the other copy waiting on its blocked screen, which
        // costs a person time; yielding closes the only connection that could
        // ever store the take this copy is holding, which costs a translator
        // work they cannot record again. If the guard throws, the close below
        // is never reached — the safe way round, and deliberately not caught.
        if (coordinator?.holdsUnsavedWork() === true) return;

        invalidate();
        connection.close();
        // Said last, and only after the close: this build asks for a version
        // the database no longer has, so it cannot reopen. The app's only
        // honest exit from here is a restart.
        coordinator?.onYielded();
      },
      terminated() {
        // The browser abnormally closed the connection (resource pressure, a
        // discarded tab). Drop the handle so the next getDb reopens a live one —
        // recoverable without a page reload. Identity-checked: a `terminated`
        // from a superseded connection must not drop the live one.
        invalidate();
      },
    });

    pendingOpen = opening;

    void opening.then(
      (db) => {
        if (pendingOpen === opening) pendingOpen = null;
        if (settled) {
          // `blocked` already rejected this open; the connection finally came
          // through once the other copy closed. Keep it if nothing has taken
          // the cache in the meantime — recovery then costs the one Try again
          // the person already made, not a second one. If a later attempt got
          // there first, or a `closeDb()` began after this open did and is
          // waiting to close what it produces, close this one rather than leave
          // it an orphan holding the database open.
          if (dbPromise === null && closeGeneration === bornAt) {
            connection = db;
            handle = Promise.resolve(db);
            dbPromise = handle;
          } else {
            db.close();
          }
          return;
        }
        settled = true;
        connection = db;
        resolve(db);
      },
      (cause) => {
        if (pendingOpen === opening) pendingOpen = null;
        if (settled) return;
        settled = true;
        reject(cause);
      }
    );
  });

  handle = raced.catch((cause: unknown) => {
    // Never cache a rejected open: one failed attempt must not poison every
    // later call. Clear the handle — identity-checked, so a concurrent getDb
    // that already installed a live connection keeps it — so the next call, a
    // Notice's Try again or the next storage read, reopens from scratch.
    invalidate();
    throw isVersionError(cause) ? new DatabaseDowngradeError() : cause;
  });
  return handle;
}

export function getDb(): Promise<IDBPDatabase<TcMobileDb>> {
  dbPromise ??= openDatabase();
  return dbPromise;
}

/**
 * Close the connection and drop the cached handle.
 *
 * Closing matters: an open connection blocks `indexedDB.deleteDatabase`
 * indefinitely, so clearing the cached promise alone is not enough to let a
 * test (or a future "delete all data" action) actually remove the database.
 *
 * An open that is still in flight is awaited first. An IndexedDB open request
 * cannot be cancelled, so the alternative is to return while a connection is
 * still on its way and leave it open with nothing holding it. The cost is that
 * this waits as long as that open does: an open blocked by another copy of the
 * app settles only once that copy closes.
 *
 * It closes exactly what existed when it was called — the cached handle and the
 * open already in flight, both snapshotted before that wait. A `getDb()` during
 * the wait installs a connection of its own, and closing THAT would hand the app
 * a dead handle it has no reason to expect.
 */
export async function closeDb(): Promise<void> {
  closeGeneration += 1;

  // Snapshot both before awaiting anything, and free the cache slot now: what
  // arrives during the wait belongs to whoever asked for it, not to this call.
  const cached = dbPromise;
  const opening = pendingOpen;
  dbPromise = null;

  // A failed open is the caller's to see through `getDb()`, not this
  // function's: closeDb closes what exists and reports nothing.
  const connections = await Promise.all([
    cached?.catch(() => null) ?? null,
    opening?.catch(() => null) ?? null,
  ]);
  // The two are the same connection on the ordinary path (the cached handle IS
  // this open's), and two different ones after a blocked open. `close()` is
  // idempotent, so closing both needs no bookkeeping to tell those apart.
  for (const db of connections) db?.close();
}
