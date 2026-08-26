/**
 * Clip persistence — metadata and PCM samples.
 */

import { framesToMs } from "@/lib/audio/format";
import { getDb } from "./db";
import type { Clip, ClipMeta } from "@/types/audio";
import type { ClipId } from "@/types/domain";

export function newClipId(): ClipId {
  return crypto.randomUUID() as ClipId;
}

/**
 * Persist samples and their metadata in a single transaction spanning both
 * stores, so a failure can never leave metadata pointing at absent audio.
 */
export async function putClip(
  id: ClipId,
  samples: Int16Array,
  sampleRate: number,
  createdAt: number = Date.now()
): Promise<ClipMeta> {
  // A 0-frame clip is not a recording — it resolves as playable, silent audio
  // and can be counted finished (the ghost take `clearSegmentTake` exists to
  // avoid). No caller writes one today; rejecting it here makes the store, not
  // just the hook, the authority, the same way `setSegmentFinished` enforces its
  // own empty invariant rather than trusting a disabled control.
  if (samples.length === 0) {
    throw new Error("Refusing to store a 0-frame clip");
  }
  const meta: ClipMeta = {
    id,
    sampleRate,
    frameCount: samples.length,
    durationMs: framesToMs(samples.length, sampleRate),
    createdAt,
  };

  const db = await getDb();
  const tx = db.transaction(["clipMeta", "clipData"], "readwrite");
  // Copy through a fresh ArrayBuffer: a subarray view would serialise the
  // entire backing buffer, which for a trimmed clip can be far larger than
  // the audio it represents.
  const bytes = new Int16Array(samples);
  await Promise.all([
    tx.objectStore("clipMeta").put(meta),
    tx.objectStore("clipData").put(bytes.buffer, id),
    tx.done,
  ]);
  return meta;
}

export async function getClipMeta(id: ClipId): Promise<ClipMeta | undefined> {
  return (await getDb()).get("clipMeta", id);
}

export async function getClip(id: ClipId): Promise<Clip | undefined> {
  const db = await getDb();
  const tx = db.transaction(["clipMeta", "clipData"], "readonly");
  const [meta, data] = await Promise.all([
    tx.objectStore("clipMeta").get(id),
    tx.objectStore("clipData").get(id),
  ]);
  await tx.done;
  if (!meta || !data) return undefined;
  return { meta, samples: new Int16Array(data) };
}

export async function deleteClip(id: ClipId): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["clipMeta", "clipData"], "readwrite");
  await Promise.all([
    tx.objectStore("clipMeta").delete(id),
    tx.objectStore("clipData").delete(id),
    tx.done,
  ]);
}

/** Total bytes of PCM held on the device — surfaced so storage pressure is visible. */
export async function totalClipBytes(): Promise<number> {
  const db = await getDb();
  const all = await db.getAll("clipMeta");
  return all.reduce((sum, m) => sum + m.frameCount * 2, 0);
}
