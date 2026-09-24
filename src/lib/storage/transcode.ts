/**
 * Transcode on Finished (B8, D3) — the storage half.
 *
 * A segment's audio is PCM while it is being worked on and MP3 once the
 * translator marks it Finished: 64 kbps mono is ~10x smaller, and all 50 OBS
 * stories go from roughly 660 MB of PCM to roughly 66 MB (#12). The encode
 * itself is CPU-bound and runs in a Web Worker at the browser boundary
 * (`hooks/finish-transcode.ts`); this module is the two pure ends of that job —
 * WHICH segments still owe a transcode, and the atomic write that lands one.
 *
 * The write is the T1 part. It replaces the only copy of a translator's audio
 * with a lossy transcode, so:
 *
 *   - It is ONE transaction over the clip's bytes and metadata: the MP3 lands
 *     and the PCM goes together, or neither happens. There is no state in which
 *     the PCM has been dropped and the MP3 has not been written.
 *   - It re-checks, inside that transaction, that the world it was encoded from
 *     still holds: the segment is still Finished, still points at the same take
 *     and clip, and that clip is still PCM. Anything else is `stale` — the
 *     translator un-finished, re-recorded, edited or erased while the worker was
 *     encoding — and NOTHING is written. Idempotency by re-checking rather than
 *     by locking: a sweep can be re-run at any time, and two overlapping sweeps
 *     converge on the same end state.
 *   - It asks for strict durability, so "the PCM is dropped only after the MP3
 *     is durably written" (#34) is what the transaction promises, not a hope.
 */

import { isFinished } from "./takes";
import { getDb } from "./db";
import type { Peaks } from "@/types/audio";
import type { ClipId, SegmentId } from "@/types/domain";

/** The stores the commit touches — the clip's two halves, the pointers to it. */
const COMMIT_STORES = ["segments", "takes", "clipMeta", "clipData"] as const;

/**
 * What a `commitTranscode` did.
 *
 * `committed`: the MP3 is on disk and the PCM is gone. `already`: the clip was
 * already MP3 (a concurrent sweep beat us; nothing to do). `stale`: the segment
 * no longer matches what was encoded — not finished any more, a different
 * take/clip, or gone — and nothing was written; the PCM, if any, is untouched.
 */
export type TranscodeOutcome = "committed" | "already" | "stale";

/**
 * Segments whose audio still owes a transcode: Finished, with an active take
 * whose clip is PCM.
 *
 * ORDERED by `transcodeStallCount` ascending, ties broken by the order the rows
 * were read (#404): a clip that has wedged the encoder before goes behind the
 * clips that have not, on this launch and every later one. Without it a poison
 * clip at the head of a stable `getAll` walk starved every finished segment
 * behind it — the in-page `stalledSegmentIds` set could not help, because a
 * reload zeroes it. The caller still encodes them one at a time and each commit
 * re-verifies its own segment, so a segment that stops qualifying between this
 * read and its commit is simply skipped there.
 *
 * A read, not a snapshot: it runs three cheap `getAll`s rather than a walk per
 * segment, because on the first launch after the v4 upgrade EVERY finished
 * segment on the device qualifies, and that list must be cheap to produce.
 */
export async function listPcmFinishedSegments(): Promise<
  ReadonlyArray<{ segmentId: SegmentId; clipId: ClipId }>
> {
  const db = await getDb();
  const tx = db.transaction(["segments", "takes", "clipMeta"], "readonly");
  const [segments, takes, metas] = await Promise.all([
    tx.objectStore("segments").getAll(),
    tx.objectStore("takes").getAll(),
    tx.objectStore("clipMeta").getAll(),
  ]);
  await tx.done;

  const takeById = new Map(takes.map((t) => [t.id, t]));
  const metaById = new Map(metas.map((m) => [m.id, m]));
  const owed: Array<{
    segmentId: SegmentId;
    clipId: ClipId;
    stallCount: number;
    order: number;
  }> = [];
  for (const segment of segments) {
    if (!isFinished(segment.status) || segment.activeTakeId === null) continue;
    const take = takeById.get(segment.activeTakeId);
    if (!take) continue;
    const meta = metaById.get(take.clipId);
    if (!meta || meta.encoding !== "pcm") continue;
    owed.push({
      segmentId: segment.id,
      clipId: take.clipId,
      stallCount: meta.transcodeStallCount,
      order: owed.length,
    });
  }
  return owed
    .sort((a, b) => a.stallCount - b.stallCount || a.order - b.order)
    .map(({ segmentId, clipId }) => ({ segmentId, clipId }));
}

/**
 * Durably remember that this PCM clip stalled the encoder, so a later launch can
 * put healthier clips ahead of it instead of repeating a head-of-line block.
 */
export async function recordTranscodeStall(clipId: ClipId): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("clipMeta", "readwrite", { durability: "strict" });
  try {
    const meta = await tx.objectStore("clipMeta").get(clipId);
    if (!meta || meta.encoding !== "pcm") {
      await tx.done;
      return;
    }
    await tx.objectStore("clipMeta").put({
      ...meta,
      transcodeStallCount: meta.transcodeStallCount + 1,
    });
    await tx.done;
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      // Already settled — the original cause is what the caller needs.
    }
    await tx.done.catch(() => {});
    throw cause;
  }
}

/**
 * Land a finished segment's MP3 over its PCM, atomically, if the segment is
 * still the one it was encoded from. See the module header for the contract.
 *
 * `clipId` is the clip the caller READ the PCM from, so a segment whose take was
 * replaced meanwhile (a new clip id) is caught even though it is still finished.
 * `peaks` are the row-resolution waveform the list will draw from once the PCM
 * is gone — computed by the caller from the samples it encoded, before it let
 * go of them.
 *
 * An empty MP3 is refused up front: an encoder that produced nothing must not
 * be allowed to take the only copy of the audio with it.
 */
export async function commitTranscode(
  segmentId: SegmentId,
  clipId: ClipId,
  mp3: Uint8Array,
  peaks: Peaks
): Promise<TranscodeOutcome> {
  if (mp3.byteLength === 0) {
    throw new Error("Refusing to replace a clip's audio with an empty MP3");
  }
  // Copy into a fresh, right-sized ArrayBuffer BEFORE the transaction: a view
  // onto a larger buffer would serialise the whole backing store (the same
  // trap `putClip` guards), and an allocation failure here must not abort a
  // transaction that has already opened.
  const bytes = new Uint8Array(mp3);

  const db = await getDb();
  const tx = db.transaction(COMMIT_STORES, "readwrite", {
    durability: "strict",
  });
  try {
    const segment = await tx.objectStore("segments").get(segmentId);
    if (!segment || !isFinished(segment.status) || !segment.activeTakeId) {
      await tx.done;
      return "stale";
    }
    const take = await tx.objectStore("takes").get(segment.activeTakeId);
    if (!take || take.clipId !== clipId) {
      await tx.done;
      return "stale";
    }
    const meta = await tx.objectStore("clipMeta").get(clipId);
    if (!meta) {
      await tx.done;
      return "stale";
    }
    if (meta.encoding === "mp3") {
      await tx.done;
      return "already";
    }

    // The two halves in the same transaction: `put` replaces the PCM bytes
    // under the same key, so the PCM is gone exactly when the MP3 is durable.
    await tx.objectStore("clipData").put(bytes.buffer, clipId);
    await tx.objectStore("clipMeta").put({
      ...meta,
      encoding: "mp3",
      generation: meta.generation + 1,
      byteLength: bytes.byteLength,
      peaks,
    });
    await tx.done;
    return "committed";
  } catch (cause) {
    // Mirror `saveTake`: a thrown error mid-transaction does not roll back on
    // its own (IndexedDB auto-commits an inactive transaction), so abort
    // explicitly. A half-landed transcode — MP3 bytes under PCM metadata, or
    // the reverse — would be an unplayable clip standing in for the only copy.
    try {
      tx.abort();
    } catch {
      // Already settled — aborted by a request failure, or committed. Nothing
      // to undo; the original cause below is what the caller needs.
    }
    await tx.done.catch(() => {});
    throw cause;
  }
}
