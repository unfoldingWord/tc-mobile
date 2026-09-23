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
 *
 * ── v6 (#205): the durable failure log — append-only ──
 *
 * A `failures` store, so the one failure sink has a destination that survives
 * the page (AGENTS.md: "`console.error` is not a channel on a phone in a
 * village"). Additive in the strongest sense: a NEW store, so there is no
 * backfill to run and not one existing row is read or rewritten. A v5 device's
 * recordings come through untouched, and a build that predates v6 simply has no
 * log — it does not fail to open, because the store it never heard of is not
 * one it asks for.
 *
 * Out-of-line auto-increment keys, so insertion order is key order and the ring
 * in `failures.ts` can prune the oldest from the front of a cursor without
 * trusting a phone's clock.
 *
 * ── v7 (#404): durable transcode-stall accounting — append-only ──
 *
 * `ClipMeta` gained `transcodeStallCount`, stamped to 0 for existing clips. The
 * Finished transcode sweep increments it when a clip wedges the encoder and
 * orders future owed clips by the count, so poison clips near the head of a
 * stable IndexedDB walk cannot starve healthy clips after a reload. The PCM is
 * still kept; this is scheduling metadata only.
 *
 * ── v8 (#591): segment labels — append-only ──
 *
 * `Segment` gained an optional `label` ("verses 3–4"), the segment twin of v5's
 * chapter name. The v8 step stamps `label: null` on every pre-existing segment
 * row, so a reader never meets `undefined`. Additive like v5: no store dropped,
 * no other field touched, and the takes and clips behind a segment are never
 * read.
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
import type { StoredFailure } from "@/types/failure";

const DB_NAME = "tc-mobile";
const DB_VERSION = 8;

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
  /**
   * The durable failure log (#205), newest at the highest key. Keyed by an
   * out-of-line auto-increment — no `keyPath` — so a row is plain data with no
   * key field baked into it and insertion order is key order.
   */
  failures: { key: number; value: StoredFailure };
}

/**
 * The stored database is NEWER than this build asks for — an older app opening
 * data a newer one already wrote (the `autoUpdate` service worker can leave the
 * two running side by side). IndexedDB refuses the open with a `VersionError`;
 * "recovering" by deleting would destroy the newer build's recordings, so this
 * surfaces as a deliberate failure instead.
 *
 * **Not retryable, and no caller should offer a retry for it (#221).** Nothing
 * this copy does can clear it: the data has moved past this build's
 * `DB_VERSION`, and after a yield `getDb()` refuses before it even opens, so
 * every attempt fails identically for the rest of the page's life. A restart is
 * the only exit, because it is what picks up the newer build the service worker
 * has already activated.
 *
 * The product paths are `DatabasePanel` (`useDatabaseStatus` reports
 * `reloadNeeded` through `onYielded`) and `SaveFailed` with
 * `kind === "downgrade"`, both of which offer that restart and no retry, and
 * `failureExit` in `lib/takes` for the recorder's own failure sites. This
 * comment used to say the opposite — "retryable", surfaced through the
 * Books-screen Notice — which was true before those existed and would now
 * invite a "try again" onto a condition that is already decided (George R6 P3).
 *
 * `message` is still written for a person rather than a log: the unchanged
 * Notice paths in `use-books.ts` and `use-chapter-segments.ts` still show it,
 * and removing that is #437's business, not this class's.
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

/**
 * Is a refusal from this module one that NOTHING on this page can clear?
 *
 * The two above are opposites, and a caller that treats them alike gets one of
 * them wrong. `DatabaseBlockedError` clears the moment the other copy closes —
 * which is exactly what the screens showing it ask the person to do, so a retry
 * there is a real offer. `DatabaseDowngradeError` is the yield latch
 * ({@link getDb}, and see that class's own docblock): once this copy has given
 * its connection away, every open for the rest of the page's life fails
 * identically, and a retry is a promise the code cannot keep.
 *
 * Lives here, beside the two classes, so the strings cannot drift away from the
 * definitions they name. Takes the `name` rather than the error so a caller that
 * only kept the name — the failure log swallows the error itself, by design —
 * can still ask. A `null` name is "no refusal recorded", never "terminal":
 * nothing is more retryable than a write that was never refused.
 *
 * **Compared as a literal on purpose.** `DatabaseDowngradeError.name` would be
 * the CLASS's name, which a minified production build is free to mangle; the
 * constructors above assign `this.name` as a literal precisely so the instance's
 * name survives that. Matching the literal is what makes this work in the build
 * that ships, and it is the same reason `isVersionError` above matches by name.
 *
 * First caller: the crash screen's Restart (`components/error-boundary.tsx`),
 * which must not hold a reload on a refusal that can never clear (George R7
 * P2-1). Failure-log prepare and clear also use this classification (#455):
 * they show the restart sentence instead of inviting a retry of a terminal
 * refusal. The controls remain share/clear actions, not reload actions.
 */
export function isTerminalOpenRefusal(name: string | null): boolean {
  return name === "DatabaseDowngradeError";
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
  /**
   * A blocked open has since come through: the other copy closed and the
   * database is reachable again.
   *
   * This exists because `blocked` is a one-shot event on the open being
   * processed — opening again queues behind it and is told nothing — so an app
   * that is still showing "another copy is open" has no way to find out that it
   * no longer is. Without this the only honest screen would be one that cannot
   * take itself down.
   */
  onUnblocked: () => void;
}

let coordinator: UpgradeCoordinator | null = null;

/**
 * A `versionchange` this copy refused because work was held, kept so it can
 * still be honoured once that work is gone.
 *
 * `versionchange` fires once per upgrade attempt. The other copy does not ask
 * again — it simply sits on its blocked screen — so a refusal with nothing to
 * replay it is permanent, and "wait while a take is in hand" quietly becomes
 * "wait until this tab is closed".
 *
 * A stale one is left in the slot rather than cleared from every path a
 * connection can die on: it checks for itself that the connection it captured
 * is still the app's, does nothing if it is not, and is replaced by the next
 * refusal.
 *
 * `owner` is who may SPEAK for it. Running a stale refusal is harmless — it
 * returns on its own identity check — but `terminated` reads the slot the other
 * way round, as proof that the connection now dying is the one that refused, and
 * that reading has to be true. A later connection's abnormal death would
 * otherwise be reported as this copy giving way, and the report latches: the
 * panel says "out of date" and every subsequent `getDb()` is refused, on a copy
 * that never yielded anything (Frank R6 P2).
 */
interface DeferredUpgrade {
  /** The open that installed it — an identity, never dereferenced. */
  readonly owner: object;
  readonly run: () => void;
}

let deferredUpgrade: DeferredUpgrade | null = null;

/**
 * This copy has GIVEN UP its connection for another copy's upgrade, so it must
 * never open one again.
 *
 * Closing the connection is only half of yielding. Nothing about `dbPromise`
 * being null stops the next `getDb()` from opening a fresh connection at this
 * build's older `DB_VERSION` — and if the other copy's upgrade has not committed
 * yet, that open SUCCEEDS and stands in its way all over again, from a
 * connection it never saw (George R3 P2-2).
 *
 * The caller that does this is not a screen the panel can unmount: the
 * transcode sweep is module-scoped, survives the tree being replaced, and calls
 * `getDb()` again in `commitTranscode` after an encode that takes seconds — a
 * live open on the far side of a yield.
 *
 * Set only where this copy actually gave something up. NOT set when it merely
 * MEETS newer data on an open: that open holds no connection and blocks nobody,
 * and latching there would break the recovery `getDb` is documented and tested
 * to have — "once the newer data is gone, getDb reopens" — for no gain.
 */
let yielded = false;

/**
 * Give up, and remember it. The latch and the notification always move together;
 * every path that tells the app it is out of date because THIS copy let go goes
 * through here.
 */
function markYielded(): void {
  yielded = true;
  coordinator?.onYielded();
}

/**
 * Honour a `versionchange` this copy refused earlier, now that the work it was
 * refused to protect has been let go.
 *
 * Called by the app, because only the app knows when that is (`use-database-
 * status.ts`, as the answer changes). Does nothing if no upgrade was refused,
 * which is the ordinary case.
 */
export function yieldDeferredUpgrade(): void {
  const pending = deferredUpgrade;
  deferredUpgrade = null;
  pending?.run();
}

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
   * Whether this open was told it was blocked.
   *
   * It is what makes the recovery reportable. A `blocked` event fires once, for
   * the open being processed; a second open queues BEHIND that one and is told
   * nothing at all, so an app cannot learn "is it still blocked?" by opening
   * again. The answer has to come from this open when it finally settles.
   */
  let wasBlocked = false;

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

  /**
   * This attempt's identity in the `deferredUpgrade` slot. `handle` cannot serve:
   * it is reassigned as the open settles, and `invalidate()` has already run by
   * the time `terminated` asks, so a comparison against it can no longer tell
   * "this connection's refusal" from "somebody else's".
   */
  const openToken = {};

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

        // v6 (#205): the durable failure log. A new store and nothing else —
        // no row anywhere is read, stamped or moved, so this is the cheapest
        // shape an upgrade has. Guarded on `oldVersion < 6` like its siblings
        // so a fresh install creates it once and a v5 device gains it once.
        //
        // ORDER IS LOAD-BEARING: this runs BEFORE every backfill below, and
        // therefore before the upgrade has awaited anything (George #2, round
        // 1). A `versionchange` transaction stays alive across awaited IDB
        // requests — idb's documented pattern, and what the backfills rely on —
        // but a STRUCTURE change after the handler has yielded is a different
        // thing, and some WebKit versions refuse it with `InvalidStateError`,
        // aborting the whole upgrade. On a fresh install every backfill below
        // opens a cursor unconditionally, so a v6 create placed after them sits
        // behind those awaits on every new phone — and iOS is the October
        // target. Keep it first as backfills are added; do not count them here.
        // The create depends on no awaited result, so keeping it up here costs
        // nothing and removes the question. Pinned by
        // `tests/db-migration.test.ts`, which fails the upgrade if a structure
        // change is attempted after a yield.
        if (oldVersion < 6) {
          db.createObjectStore("failures", { autoIncrement: true });
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
                transcodeStallCount: 0,
                peaks: null,
              };
              await cursor.update(stamped);
            }
            cursor = await cursor.continue();
          }
        }

        // v7 (#404): every pre-existing clip starts with no recorded encoder
        // stalls. Additive — only the missing field is added, and only to the
        // metadata row. A fresh install has no clip rows; clips stamped by the
        // v4 step above already carry the field and are left alone.
        if (oldVersion < 7) {
          const store = tx.objectStore("clipMeta");
          let cursor = await store.openCursor();
          while (cursor) {
            const legacy = cursor.value as ClipMeta & {
              transcodeStallCount?: number;
            };
            if (legacy.transcodeStallCount === undefined) {
              await cursor.update({ ...legacy, transcodeStallCount: 0 });
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

        // v8 (#591): stamp every pre-existing segment with `label: null`. The
        // same shape as v5 above, for the same reasons: only the missing field
        // is added, and keying on it being ABSENT leaves a row a newer build
        // already labelled alone.
        if (oldVersion < 8) {
          const store = tx.objectStore("segments");
          let cursor = await store.openCursor();
          while (cursor) {
            const legacy = cursor.value as Segment & { label?: string | null };
            if (legacy.label === undefined) {
              await cursor.update({ ...legacy, label: null });
            }
            cursor = await cursor.continue();
          }
        }
      },
      blocked() {
        if (settled) return;
        settled = true;
        wasBlocked = true;
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
        // work they cannot record again.
        //
        // If the guard throws, the close below is never reached — the safe way
        // round, and deliberately not caught. The throw is left to escape the
        // handler rather than swallowed: this layer may not import the failure
        // sink (it lives in `hooks/`, and the onion rule forbids the upward
        // import), and a browser turns an exception thrown from an event
        // listener into a window `error`, which `app/install-failure-listeners`
        // reports. Escaping IS the channel here.
        const held = connection;
        const yieldNow = (): void => {
          invalidate();
          held.close();
          // Said last, and only after the close: this build asks for a version
          // the database no longer has, so it cannot reopen. The app's only
          // honest exit from here is a restart — and the latch is what makes
          // "cannot reopen" true rather than merely intended.
          markYielded();
        };

        if (coordinator?.holdsUnsavedWork() === true) {
          // Refused, NOT forgotten. `versionchange` fires once: dropping it here
          // would turn "the other copy waits while a take is in hand" into "the
          // other copy is stuck for the rest of this tab's life", long after the
          // take was saved and this connection stopped being worth protecting.
          // `yieldDeferredUpgrade()` runs this the moment the app says the work
          // is gone.
          deferredUpgrade = {
            owner: openToken,
            run: () => {
              // Unless the connection went in the meantime — a `closeDb()`, or
              // the browser terminating it. There is nothing left to give up
              // then, and nothing to tell the app: it is not out of date because
              // of a connection nothing holds any more.
              if (dbPromise !== handle) return;
              yieldNow();
            },
          };
          return;
        }

        yieldNow();
      },
      terminated() {
        // The browser abnormally closed the connection (resource pressure, a
        // discarded tab). Drop the handle so the next getDb reopens a live one —
        // recoverable without a page reload. Identity-checked: a `terminated`
        // from a superseded connection must not drop the live one.
        invalidate();

        // If an upgrade was being refused on THIS connection, the refusal has
        // just been overruled by the browser: the connection is gone, so the
        // other copy is free to upgrade and will. Nothing is left to close, but
        // the app still has to be told, and the deferred closure cannot do it —
        // it checks `dbPromise !== handle`, which `invalidate()` has just made
        // true, and would return silently (George R1 P2-1).
        //
        // Saying nothing here is not neutral. This copy goes on believing it is
        // fine while the disk version moves past its `DB_VERSION`, and the next
        // save of a held take fails `VersionError` → `DatabaseDowngradeError`
        // forever, with the panel never raised because the status is still "ok".
        // Only THIS connection's refusal, which is the whole of the claim being
        // made: a refusal parked by some earlier connection says nothing about
        // the one dying now, and reporting it would latch the app out of date
        // over a death that cost the other copy nothing (Frank R6 P2).
        if (deferredUpgrade?.owner === openToken) {
          deferredUpgrade = null;
          // Latched like any other yield: the connection is gone and the other
          // copy will upgrade, so a reopen here would block it exactly as one
          // after a deliberate yield would.
          markYielded();
        }
      },
    });

    pendingOpen = opening;

    void opening.then(
      (db) => {
        if (pendingOpen === opening) pendingOpen = null;
        // This open was told it was blocked and has now come through, so the
        // other copy has closed and the database is reachable again. Said
        // whichever branch below takes the connection: in both of them the
        // block is over, and an app still showing "another copy is open" is
        // showing something that stopped being true.
        if (wasBlocked) {
          wasBlocked = false;
          coordinator?.onUnblocked();
        }
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
        // Deliberately no `onUnblocked` here: an open that was blocked and then
        // FAILED leaves the database no more reachable than it was.
        wasBlocked = false;
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
    if (!isVersionError(cause)) throw cause;

    // The stored data is newer than this build asks for, which is the same
    // condition the "this copy is out of date" panel exists for — reached the
    // other way round. `blocking()` gets there when this copy gives its
    // connection up; this is what happens when the upgrade went through without
    // it, because the connection had already gone (`terminated`, a discarded
    // tab) or because this copy was started after the newer one had written.
    //
    // Told to the app as a whole, not just to whoever called `getDb()`: every
    // unchanged caller — `saveTake`, `use-books`, `use-chapter-segments` — meets
    // this as a rejection it can only turn into its own local failure, and none
    // of them can say the one true thing, which is that no read or write from
    // this copy will ever succeed again (George R1 P2-1).
    coordinator?.onYielded();
    throw new DatabaseDowngradeError();
  });
  return handle;
}

export function getDb(): Promise<IDBPDatabase<TcMobileDb>> {
  // Refused BEFORE `indexedDB.open` — the point is not to fail, it is not to
  // hold a connection. A caller that reaches here after this copy yielded is
  // one the panel could not stop (the module-scoped transcode sweep finishing
  // an encode), and an open at this build's version would stand in the way of
  // the upgrade this copy just stepped aside for. A fresh rejection each time,
  // never a cached one, so nothing is poisoned for a build that reloads.
  if (yielded) return Promise.reject(new DatabaseDowngradeError());
  dbPromise ??= openDatabase();
  return dbPromise;
}

/**
 * How long {@link closeDb} waits for an open still in flight before it stops
 * waiting. The same order as the recorder's resume bound
 * (`hooks/use-recorder.ts`): long enough that an ordinary open, upgrade
 * included, finishes inside it; short enough that a person on a control is not
 * left wondering whether it heard them.
 */
const CLOSE_TIMEOUT_MS = 1_000;

/**
 * Close the connection and drop the cached handle.
 *
 * Closing matters: an open connection blocks `indexedDB.deleteDatabase`
 * indefinitely, so clearing the cached promise alone is not enough to let a
 * test (or a future "delete all data" action) actually remove the database.
 *
 * An open that is still in flight is waited for, because an IndexedDB open
 * request cannot be cancelled: returning at once would leave the connection it
 * eventually receives open with nothing holding it. An open blocked by another
 * copy of the app settles only once that copy closes, so the wait is BOUNDED
 * (#438): after `timeoutMs` this resolves `"abandoned"` instead of `"closed"`.
 *
 * Abandoning stops the WAITING, never the closing. The close stays chained on
 * the open it gave up on and runs the moment that open delivers, so the bound
 * changes when this returns, not what it closes or when. That is the whole of
 * the data-loss argument: `close()` never aborts a transaction (a connection
 * closes only after every transaction made on it has finished), and the set of
 * connections closed, and the moment each is closed, are what they were before
 * the bound existed.
 *
 * `"abandoned"` means the database may still be held — by the other copy, and
 * by this open until that copy lets go — so a `deleteDatabase` straight after
 * it queues behind that open rather than running. A caller must not present
 * `"abandoned"` as done.
 *
 * It closes exactly what existed when it was called — the cached handle and the
 * open already in flight, both snapshotted before that wait. A `getDb()` during
 * the wait installs a connection of its own, and closing THAT would hand the app
 * a dead handle it has no reason to expect.
 *
 * **Nothing in `src/` calls this: the only callers are tests.** A product
 * caller — the "delete all data" this function was written for — lives in
 * `hooks/` and must report `"abandoned"` through `hooks/report-failure.ts`:
 * this layer cannot import the funnel (the onion rule), so the outcome is
 * returned for that caller to report rather than reported here.
 */
export async function closeDb(
  timeoutMs: number = CLOSE_TIMEOUT_MS
): Promise<"closed" | "abandoned"> {
  closeGeneration += 1;
  // Back to a build that has not given anything up. There is no product caller
  // (see above), and a test that tore the connection down only to find every
  // later `getDb()` refused by a latch from a previous case would be debugging
  // the harness rather than the code.
  yielded = false;
  // A refusal this call's connections made is deliberately NOT cleared here.
  // `deferredUpgrade` carries its owner, so the two ways it is read both handle a
  // stale one already: running it is a no-op (its own `dbPromise !== handle`
  // check) and `terminated` speaks only for the connection that installed it.
  // Clearing as well would be defensiveness no test can distinguish from its
  // absence, on the one path where an extra reset is easy to get subtly wrong —
  // a `getDb()` during the wait below installs a refusal this call has no
  // business retiring (Frank R6 P2, the half of the fix that is not needed).

  // Snapshot both before awaiting anything, and free the cache slot now: what
  // arrives during the wait belongs to whoever asked for it, not to this call.
  const cached = dbPromise;
  const opening = pendingOpen;
  dbPromise = null;

  // A failed open is the caller's to see through `getDb()`, not this
  // function's: closeDb closes what exists and reports nothing.
  //
  // Chained rather than awaited inline: this is what closes the connections,
  // and it runs to the end whether or not the bound below gives up on it.
  const closed = Promise.all([
    cached?.catch(() => null) ?? null,
    opening?.catch(() => null) ?? null,
  ]).then((connections): "closed" => {
    // The two are the same connection on the ordinary path (the cached handle
    // IS this open's), and two different ones after a blocked open. `close()`
    // is idempotent, so closing both needs no bookkeeping to tell those apart.
    for (const db of connections) db?.close();
    return "closed";
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<"abandoned">((resolve) => {
    timer = setTimeout(() => resolve("abandoned"), timeoutMs);
  });
  try {
    return await Promise.race([closed, bound]);
  } finally {
    clearTimeout(timer);
  }
}
