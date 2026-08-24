/**
 * IndexedDB schema.
 *
 * Audio never leaves the device in Phase 1, so this is the system of record —
 * not a cache. Losing it means losing a translator's work, which is why the
 * repository functions below are unit-tested against fake-indexeddb rather
 * than left to on-device spot checks.
 *
 * Clip metadata and clip samples live in separate stores on purpose: listing
 * a chapter must not pull megabytes of PCM into memory just to show durations.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type {
  Chapter,
  ChapterId,
  ClipId,
  Project,
  ProjectId,
  Section,
  SectionId,
  Segment,
  SegmentId,
  Take,
  TakeId,
} from "@/types/domain";
import type { ClipMeta } from "@/types/audio";

const DB_NAME = "tc-mobile";
const DB_VERSION = 2;

export interface TcMobileDb extends DBSchema {
  projects: { key: ProjectId; value: Project };
  chapters: {
    key: ChapterId;
    value: Chapter;
    indexes: { projectId: ProjectId };
  };
  sections: {
    key: SectionId;
    value: Section;
    indexes: { chapterId: ChapterId };
  };
  segments: {
    key: SegmentId;
    value: Segment;
    indexes: { sectionId: SectionId };
  };
  takes: { key: TakeId; value: Take; indexes: { segmentId: SegmentId } };
  clipMeta: { key: ClipId; value: ClipMeta };
  /** Raw mono 16-bit PCM, stored as an ArrayBuffer keyed by ClipId. */
  clipData: { key: ClipId; value: ArrayBuffer };
  /**
   * OBS reference-media cache. B0 (#26) removed the accessor code
   * (`hooks/obs-media.ts`, `lib/storage/media.ts`) and the exported
   * `CachedMedia` type, but **left this store in place** — empty and unread.
   * That keeps B0 free of any IndexedDB schema change: the migration below is
   * untouched, so nothing has to migrate. The store itself is removed by B1's
   * drop-and-recreate (#27), which is where the schema change, the version
   * bump, and its migration test belong. The value type is inlined here
   * precisely so it exports no symbol that would outlive its only reader.
   */
  media: {
    key: string;
    value: {
      readonly url: string;
      readonly blob: Blob;
      readonly contentType: string;
      readonly bytes: number;
      readonly fetchedAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<TcMobileDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<TcMobileDb>> {
  dbPromise ??= openDB<TcMobileDb>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Migrations are cumulative and must stay append-only: this database is
      // the system of record for a translator's work, and a field device may
      // be several versions behind.
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

      // v2 added the `media` object store for the OBS reference-media cache.
      // B0 (#26) removed the cache's accessor code but deliberately left this
      // step and the store untouched: editing a shipped migration step is the
      // append-only violation this database's discipline exists to prevent, and
      // there is nothing to gain — the store is empty (no writer ever existed
      // outside the deleted code). B1's drop-and-recreate (#27) removes it.
      if (oldVersion < 2) {
        db.createObjectStore("media", { keyPath: "url" });
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
