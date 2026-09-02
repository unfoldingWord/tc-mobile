/**
 * Clip persistence — metadata and stored bytes (PCM, or MP3 once finished).
 */

import { framesToMs } from "@/lib/audio/format";
import { getDb } from "./db";
import type { Clip, ClipMeta } from "@/types/audio";
import type { ClipId } from "@/types/domain";

export function newClipId(): ClipId {
  return crypto.randomUUID() as ClipId;
}

/**
 * Build a PCM clip's metadata, rejecting a 0-frame clip.
 *
 * Pure and exported so the clip-write invariant lives in one place: `putClip`
 * writes clip+meta on its own, and `saveTake` (books.ts) writes them inside the
 * take's transaction for atomicity (#38) — both must reject a 0-frame clip and
 * compute duration the same way. A 0-frame clip is not a recording: it resolves
 * as playable, silent audio and can be counted finished (the ghost take
 * `clearSegmentTake` exists to avoid). Rejecting it here makes the store, not
 * just the hook, the authority, the same way `setSegmentFinished` enforces its
 * own empty invariant rather than trusting a disabled control.
 *
 * `generation` is the lossy-pass count the audio arrives with (see `ClipMeta`):
 * 0 for a fresh recording, the prior clip's count when an edit re-saves audio
 * that was decoded from an MP3. Every clip written here is PCM — the MP3 form is
 * only ever produced by `commitTranscode`, never written directly.
 */
export function buildClipMeta(
  id: ClipId,
  samples: Int16Array,
  sampleRate: number,
  createdAt: number = Date.now(),
  generation = 0
): ClipMeta {
  if (samples.length === 0) {
    throw new Error("Refusing to store a 0-frame clip");
  }
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error(`Invalid clip generation: ${generation}`);
  }
  return {
    id,
    sampleRate,
    frameCount: samples.length,
    durationMs: framesToMs(samples.length, sampleRate),
    createdAt,
    encoding: "pcm",
    generation,
    byteLength: samples.length * 2,
    peaks: null,
  };
}

/**
 * Pair a metadata row with its stored bytes as a `Clip`, reading the bytes the
 * way the row says they are encoded. Shared by `getClip` and the segment walk in
 * `segment-audio.ts`, so the two readers cannot disagree about what an
 * `ArrayBuffer` under a clip id means.
 */
export function clipFromRecord(meta: ClipMeta, data: ArrayBuffer): Clip {
  return meta.encoding === "mp3"
    ? { encoding: "mp3", meta, mp3: new Uint8Array(data) }
    : { encoding: "pcm", meta, samples: new Int16Array(data) };
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
  const meta = buildClipMeta(id, samples, sampleRate, createdAt);

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
  return clipFromRecord(meta, data);
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

/**
 * Total bytes of audio held on the device — surfaced so storage pressure is
 * visible. Summed from metadata (`byteLength`) rather than the data store, so the
 * read never pulls audio into memory; a transcoded clip counts its MP3 size,
 * which is the saving D3 exists to make.
 */
export async function totalClipBytes(): Promise<number> {
  const db = await getDb();
  const all = await db.getAll("clipMeta");
  return all.reduce((sum, m) => sum + m.byteLength, 0);
}
