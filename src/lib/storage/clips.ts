/**
 * Clip persistence — metadata and stored bytes (PCM, or MP3 once finished).
 */

import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";

import { framesToMs } from "@/lib/audio/format";
import { getDb, type TcMobileDb } from "./db";
import type { Clip, ClipMeta } from "@/types/audio";
import type { ClipId } from "@/types/domain";

export function newClipId(): ClipId {
  return crypto.randomUUID() as ClipId;
}

/**
 * Build a PCM clip's metadata, rejecting a 0-frame clip.
 *
 * Pure and exported so the clip-write invariant lives apart from the write:
 * `saveTake` (takes.ts), the only path that writes a PCM clip, builds the meta
 * here before its transaction opens, then writes clip and meta inside the
 * take's transaction for atomicity (#38). A 0-frame clip is not a recording:
 * it resolves as playable, silent audio and can be counted finished (the ghost
 * take `clearSegmentTake` exists to avoid). Rejecting it here makes the store, not
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
    transcodeStallCount: 0,
    peaks: null,
    processing: null,
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

/** The smallest transaction the clip-use check runs on. */
function openClipUseTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(
    ["takes", "pendingTakes", "clipMeta", "clipData"],
    "readwrite",
    { durability: "strict" }
  );
}

/**
 * Any readwrite transaction whose scope includes `takes`, `pendingTakes`,
 * `clipMeta` and `clipData`: what the clip-use check reads and deletes. The
 * mode is read off a real readwrite transaction, so it is the same type under
 * the DOM-free `typecheck:lib` as under the app's.
 */
export type ClipUseTx = IDBPTransaction<
  TcMobileDb,
  ArrayLike<StoreNames<TcMobileDb>>,
  ReturnType<typeof openClipUseTx>["mode"]
>;

/**
 * Whether a clip is in use: a take names it, or a pending row's `stored` base
 * does (v13, #38; the `bySourceClip` index makes the second a key count). A
 * row is a complete recipe only while its base clip exists, so a base is a use
 * exactly as a take is (docs/design/pending-take-lifecycle.md, §3).
 */
async function clipInUse(
  tx: ClipUseTx,
  clipId: ClipId,
  takeClips?: ReadonlySet<ClipId>
): Promise<boolean> {
  const named =
    takeClips ??
    new Set((await tx.objectStore("takes").getAll()).map((t) => t.clipId));
  if (named.has(clipId)) return true;
  const bases = tx.objectStore("pendingTakes").index("bySourceClip");
  return (await bases.count(clipId)) > 0;
}

/**
 * Delete a clip's metadata and bytes, unless it is in use ({@link clipInUse}).
 *
 * Every path that lets go of a clip goes through here, so the reference check
 * is written once. Call it on the caller's transaction AFTER the take row or
 * pending row that let go of the clip is deleted, so the check sees only the
 * uses that survive; the check and the delete then land in the same
 * transaction as that change.
 *
 * Nothing shares a clip between takes today (every take mints a fresh
 * `newClipId()`), but nothing in the schema forbids it either, and an
 * unconditional delete would then punch a hole in another segment:
 * unrecoverable audio loss (#68, Frank R4).
 *
 * `takeClips` is the set of clips the surviving take rows name, for a caller
 * that releases many clips in one transaction and has deleted every take row
 * it is going to (the book delete): one read of `takes` instead of one per
 * clip. The pending-row count is still made per clip.
 */
export async function deleteClipIfUnreferenced(
  tx: ClipUseTx,
  clipId: ClipId,
  takeClips?: ReadonlySet<ClipId>
): Promise<void> {
  if (await clipInUse(tx, clipId, takeClips)) return;
  await tx.objectStore("clipMeta").delete(clipId);
  await tx.objectStore("clipData").delete(clipId);
}

/**
 * Delete a clip, unless it is in use ({@link clipInUse}, v13 #38).
 *
 * Strict durability: the same bar as `saveTake`'s clip write (#179, #163) —
 * the write and the delete of a take's only copy of its audio are held to the
 * same guarantee.
 */
export async function deleteClip(id: ClipId): Promise<void> {
  const tx = openClipUseTx(await getDb());
  await deleteClipIfUnreferenced(tx, id);
  await tx.done;
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
