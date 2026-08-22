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

export const DB_NAME = "tc-mobile";
export const DB_VERSION = 1;

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
}

let dbPromise: Promise<IDBPDatabase<TcMobileDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<TcMobileDb>> {
  dbPromise ??= openDB<TcMobileDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
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
