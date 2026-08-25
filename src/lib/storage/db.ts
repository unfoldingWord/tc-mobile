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
const DB_VERSION = 3;

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
  /** Raw mono 16-bit PCM, stored as an ArrayBuffer keyed by ClipId. */
  clipData: { key: ClipId; value: ArrayBuffer };
}

let dbPromise: Promise<IDBPDatabase<TcMobileDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<TcMobileDb>> {
  dbPromise ??= openDB<TcMobileDb>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
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
    },
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
  const pending = dbPromise;
  if (!pending) return;
  dbPromise = null;
  const db = await pending.catch(() => null);
  db?.close();
}
