/**
 * Reference-media cache — OBS artwork and narration.
 *
 * Why IndexedDB rather than the Cache API: a story downloaded for offline use
 * in the field is not a cache, it is content the translator is relying on. It
 * must be durable, countable against the same storage budget as recordings
 * (ADR 0002), and removable one story at a time when the device fills up.
 */

import { getDb, type CachedMedia } from "./db";

export async function getMedia(url: string): Promise<CachedMedia | undefined> {
  return (await getDb()).get("media", url);
}

export async function hasMedia(url: string): Promise<boolean> {
  // Both awaits matter: `getKey` returns a promise, and comparing that promise
  // to `undefined` is always true — which silently reports every URL as
  // already cached and skips every download.
  const db = await getDb();
  const key = await db.getKey("media", url);
  return key !== undefined;
}

export async function putMedia(
  url: string,
  blob: Blob,
  fetchedAt: number = Date.now()
): Promise<CachedMedia> {
  const entry: CachedMedia = {
    url,
    blob,
    contentType: blob.type,
    bytes: blob.size,
    fetchedAt,
  };
  await (await getDb()).put("media", entry);
  return entry;
}

export async function deleteMedia(url: string): Promise<void> {
  await (await getDb()).delete("media", url);
}

/** Total bytes of cached reference media, for the storage budget display. */
export async function totalMediaBytes(): Promise<number> {
  const all = await (await getDb()).getAll("media");
  return all.reduce((sum, m) => sum + m.bytes, 0);
}

export async function listMediaUrls(): Promise<string[]> {
  return (await getDb()).getAllKeys("media");
}
