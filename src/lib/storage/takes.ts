/**
 * Take writes — the one recording behind a segment, and the finished flag.
 *
 * Split out of `books.ts` (#160, L-16), which had grown to hold the whole tree
 * plus every write that touches audio. What lives here is one cohesive thing:
 * the transaction shape a take write needs, the 1:1 replace itself, and the
 * one write path over it — `saveTake`, the clip and the take in one
 * transaction (the #38 atomicity fix) — plus the clear and the finished mark.
 *
 * The finished flag comes with them, and that is the point of the seam rather
 * than an accident of where the lines fell: the binary "finished" UI is one
 * edge over the 5-value `RecordingStatus` enum, and every write that moves a
 * segment ALONG the take lifecycle (`writeTakeInTx`, `clearSegmentTake`,
 * `setSegmentFinished`) together with the read the view layer calls
 * (`isFinished`) are now in ONE module. They could not drift before because
 * they shared a file; they cannot drift now because they share the smaller one.
 *
 * Not every `RecordingStatus` write in the tree, and the difference is worth
 * naming: `addSegment` writes the initial `"not-started"` in `books.ts`, with
 * the segment it is creating, because that is the tree's own write and not a
 * take transition. The two module-local anchors here,
 * `FINISHED_STATUS`/`UNFINISHED_STATUS`, keep the finished EDGE in one place;
 * they do not make a raw status unwritable, and the literal `"not-started"` in
 * `clearSegmentTake` and `setSegmentFinished` below is the proof.
 *
 * Depends on `books.ts` for nothing — it reaches the stores through the
 * transaction directly — so the dependency runs one way, `books → takes`, and
 * `chapterProgress` is the single edge.
 */

import type { IDBPDatabase } from "idb";

import { clipBytes, ownedClipBytes, withClipBytes } from "./clip-bytes";
import { buildClipMeta, deleteClipIfUnreferenced } from "./clips";
import { getDb, type TcMobileDb } from "./db";
import { baseClipIntact, encodePendingBase } from "./pending-takes";
import { judgePending } from "@/lib/takes/judge-pending";
import type { NewTake } from "@/lib/takes/pending-take";
import type {
  ClipId,
  PendingRefusal,
  RecordingStatus,
  SegmentId,
  StoredPendingTake,
  Take,
  TakeDisposition,
  TakeId,
} from "@/types/domain";

const uuid = (): string => crypto.randomUUID();

/**
 * Open the transaction a take write needs: the take row and segment pointer, the
 * clip both `saveTake` writes and a superseded take's clip is deleted from, and
 * the book/chapter parents read to bump the book's `updatedAt`. `saveTake` and
 * `clearSegmentTake` both open it, so the clip reference check they share runs
 * on one transaction type. `TakeTx` is derived from this call's return so the
 * helper's parameter type cannot drift from what actually opens.
 *
 * v13 (#38): it also names `pendingTakes` and `takeDispositions`, so it is the
 * one owning transaction for a pending row's end: the commit, a Discard and a
 * give-up each delete their own row and record why here, together
 * (docs/design/pending-take-lifecycle.md, §3).
 */
function openTakeTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(
    withClipBytes([
      "segments",
      "takes",
      "clipMeta",
      "chapters",
      "books",
      "pendingTakes",
      "takeDispositions",
    ]),
    "readwrite",
    // Strict durability: this transaction creates the ONLY copy of a recording,
    // and under the browser default (relaxed on Chromium) it can report success
    // before the bytes are flushed — so a crash or a power loss just after Stop
    // loses the take. Same bar `commitTranscode` holds (#179, ADR 0009).
    { durability: "strict" }
  );
}

type TakeTx = ReturnType<typeof openTakeTx>;

// ── The finished flag — binary UI over the 5-value enum (D-FIN) ────────────

// The binary "finished" UI is one edge over the 5-value enum, and both sides of
// it live in this module — the writes below and the `isFinished` read the view
// layer calls. So these two anchors stay module-local: exporting them would be
// surface nothing outside consumes (the UI toggles through `setSegmentFinished`
// and reads through `isFinished`, never the raw status).
/** The one status the binary "finished" UI writes and reads as complete. */
const FINISHED_STATUS = "affirmed" satisfies RecordingStatus;
/** What "finished" turns OFF to: recorded but not complete. */
const UNFINISHED_STATUS = "draft" satisfies RecordingStatus;

/** Binary read of the enum. Any non-"affirmed" value is "not finished". */
export function isFinished(status: RecordingStatus): boolean {
  return status === FINISHED_STATUS;
}

// ── The take writes ────────────────────────────────────────────────────────

/**
 * The take write itself, on a caller-provided transaction.
 *
 * Record the take for a segment, REPLACING any prior one (1:1, D1/A2).
 *
 * A segment has at most one take: re-recording is an in-place edit, not a new
 * entry on a stack (A2 removed the many-takes model; the switcher is gone with
 * `setActiveTake`). So this creates the new take, points the segment at it,
 * demotes an "affirmed" segment back to draft — the audio a reviewer approved
 * is no longer the audio that would be exported — and then deletes the
 * superseded take row and its clip.
 *
 * The caller's transaction spans the take, segment, and clip stores, so the
 * delete of the old audio cannot land without the new audio and pointer
 * landing too: an interrupted replace never strands the new recording. That
 * atomicity is a property of the transaction `saveTake` opens around
 * this call, not of this helper alone — see the "Does NOT open or close the
 * transaction" note below.
 *
 * The prior clip is deleted only when no take still names it
 * (`deleteClipIfUnreferenced`, the same check `clearSegmentTake` makes, #68).
 * The new take row is written first, so a retry that reuses a clip id (the
 * pending-take upsert path) finds its own clip still named and keeps it.
 *
 * `finished` sets the segment's final status in this same transaction. It
 * defaults to false — a new recording is draft, which is what demotes an
 * approved segment — so `true` is only ever the recorder carrying an explicit
 * Finished mark for THIS take. Writing it here, atomically with the take, is
 * what lets the mark survive a save-failure retry (which re-runs this) instead
 * of being lost to a separate write the recovery path never reaches.
 *
 * Its one caller is `saveTake`. Does NOT open or close the transaction: the
 * caller owns its lifetime, which is what lets `saveTake` make the clip write
 * and this take write atomic together.
 */
async function writeTakeInTx(
  tx: TakeTx,
  segmentId: SegmentId,
  clipId: ClipId,
  durationMs: number,
  opts: { finished?: boolean; now?: number } = {}
): Promise<Take> {
  const { finished = false, now = Date.now() } = opts;
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  const priorTakeId = segment.activeTakeId;
  const priorTake = priorTakeId
    ? await tx.objectStore("takes").get(priorTakeId)
    : undefined;

  const take: Take = {
    id: uuid() as TakeId,
    segmentId,
    clipId,
    createdAt: now,
    durationMs,
  };
  await tx.objectStore("takes").put(take);
  await tx.objectStore("segments").put({
    ...segment,
    activeTakeId: take.id,
    // The active take changed (v13, #38): a pending row made against the old
    // revision can see that, whatever `activeTakeId` reads.
    audioRevision: segment.audioRevision + 1,
    // A new recording is draft unless the recorder carried an explicit Finished
    // mark for it: a fresh take demotes an approved segment and moves a first
    // take off "not-started", while an explicit mark lands finished atomically
    // with the take (so a retry re-applies it, never a separate lost write).
    status: finished ? FINISHED_STATUS : UNFINISHED_STATUS,
    modifiedAt: now,
  });

  if (priorTake && priorTake.id !== take.id) {
    await tx.objectStore("takes").delete(priorTake.id);
    // The new take row is already in the store, so a retry with the same
    // clipId counts as a reference and keeps the audio it now points at; so
    // does another segment's take that shares the clip.
    await deleteClipIfUnreferenced(tx, priorTake.clipId);
  }

  // Recording is activity: bump the book's `updatedAt`, in the SAME
  // transaction so the take and the timestamp land together. The book keeps
  // its place on the shelf (listBooks orders by shelfPosition, #338). A dangling chapter/book parent is skipped rather than
  // failing a save that otherwise succeeded.
  const chapter = await tx.objectStore("chapters").get(segment.chapterId);
  const book = chapter
    ? await tx.objectStore("books").get(chapter.bookId)
    : undefined;
  if (book) {
    await tx
      .objectStore("books")
      .put({ ...book, updatedAt: now, modifiedAt: now });
  }

  return take;
}

/**
 * Delete a segment's pending row if it is this take's, then let its `stored`
 * base clip go if nothing else uses it. A row for another clip is left alone.
 */
async function endOwnRow(
  tx: TakeTx,
  segmentId: SegmentId,
  clipId: ClipId
): Promise<boolean> {
  const row = await tx.objectStore("pendingTakes").get(segmentId);
  if (row?.clipId !== clipId) return false;
  await tx.objectStore("pendingTakes").delete(segmentId);
  if (row.base.kind === "stored") {
    await deleteClipIfUnreferenced(tx, row.base.sourceClipId);
  }
  return true;
}

/**
 * Abort a transaction that has not committed yet. `false` when it already
 * settled, so whatever it staged did land and the caller reports that.
 */
function abortNow(tx: TakeTx): boolean {
  try {
    tx.abort();
    return true;
  } catch {
    return false;
  }
}

/** Whether every dependency of a row's recipe is on disk in this transaction. */
async function recipeWhole(
  tx: TakeTx,
  row: StoredPendingTake
): Promise<boolean> {
  if (row.base.kind === "inline") return true;
  return baseClipIntact(
    await tx.objectStore("clipMeta").get(row.base.sourceClipId),
    await clipBytes.read(tx, row.base.sourceClipId),
    row.base
  );
}

/**
 * Record why a take stopped being pending. Monotone: `saved` and `discarded`
 * are final, and `given-up` may only be replaced by one of them, so a late or
 * repeated settle never weakens what is stored.
 */
async function recordDisposition(
  tx: TakeTx,
  segmentId: SegmentId,
  clipId: ClipId,
  kind: TakeDisposition["kind"]
): Promise<void> {
  const store = tx.objectStore("takeDispositions");
  const held = await store.get(clipId);
  if (held && (held.kind !== "given-up" || kind === "given-up")) return;
  await store.put({ clipId, segmentId, kind, at: Date.now() });
}

/**
 * The generation of the clip behind a segment's current take, or 0 when there is
 * none (never recorded, or a dangling take/clip — an edit of audio the database
 * could not produce is not a lossy pass over anything). Read on the caller's
 * transaction so `saveTake` stamps its new clip from the same state it replaces.
 */
async function priorClipGeneration(
  tx: TakeTx,
  segmentId: SegmentId
): Promise<number> {
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment?.activeTakeId) return 0;
  const take = await tx.objectStore("takes").get(segment.activeTakeId);
  if (!take) return 0;
  const meta = await tx.objectStore("clipMeta").get(take.clipId);
  return meta?.generation ?? 0;
}

/**
 * What an ordinary commit did. `discarded`: this take was discarded (a
 * request in this copy, or a record from any copy) and nothing was written.
 * `already-saved`: another copy saved it; nothing was written.
 */
export type CommitResult =
  | { readonly outcome: "saved"; readonly take: Take }
  | { readonly outcome: "discarded" | "already-saved" };

/**
 * Persist a recording — the clip AND the take — in ONE transaction.
 *
 * This is the commit path's write, and its atomicity is the #38 fix. The old
 * flow was a clip write (transaction A) then a take write (transaction B): if
 * the second failed — quota on the take/segment write, or the clip write itself
 * succeeding and then the process dying — the clip was already durable with no
 * take referencing it. That orphan consumed the very space the recovery screen
 * tells the translator to free, so freeing space and retrying failed again: the
 * quota death spiral. One transaction removes the half-written state entirely —
 * a quota failure rolls back the clip too, so there is nothing to reap.
 *
 * The clip write builds its meta with `buildClipMeta` (which rejects a 0-frame
 * clip) and copies through a fresh ArrayBuffer so a trimmed view does not
 * serialise its whole backing buffer; the take write is `writeTakeInTx`. The
 * clip write is an upsert on `clipId`, so a retry with the same id overwrites
 * rather than duplicating.
 */
export async function saveTake(
  segmentId: SegmentId,
  clipId: ClipId,
  samples: Int16Array,
  sampleRate: number,
  opts: {
    finished?: boolean;
    now?: number;
    isDiscardRequested?: (clipId: ClipId) => boolean;
    /** The generation the saved buffer was cut from; see the stamp below. */
    baseGeneration?: number | null;
  } = {}
): Promise<CommitResult> {
  const now = opts.now ?? Date.now();
  // Built before the transaction opens, so a 0-frame clip is rejected without
  // ever starting a write. The generation is stamped below, inside the
  // transaction, once the prior clip has been read.
  const base = buildClipMeta(clipId, samples, sampleRate, now);
  const bytes = ownedClipBytes(samples);

  const db = await getDb();
  const tx = openTakeTx(db);
  try {
    // v13 (#38): a take discarded in this copy, or recorded as discarded or
    // saved by any copy, is not written again (the writer rule,
    // docs/design/pending-take-lifecycle.md §3). The request first, so a
    // `given-up` record never hides it.
    const record = await tx.objectStore("takeDispositions").get(clipId);
    if (opts.isDiscardRequested?.(clipId) || record?.kind === "discarded") {
      await tx.done;
      return { outcome: "discarded" };
    }
    if (record?.kind === "saved") {
      await tx.done;
      return { outcome: "already-saved" };
    }
    // The lossy-pass count carries over from the clip this take REPLACES (B8,
    // Q5). The only way a segment has a prior take at save time is that the
    // recorder opened it and edited or inserted into its audio — and if that
    // audio was an MP3 (a finished segment being fixed), the buffer being saved
    // was decoded from it and has been through that many lossy passes already.
    // An erase clears the take first, so a genuinely fresh recording starts at
    // 0. Read inside the transaction so the count and the take it describes
    // come from the same state.
    //
    // When the caller knows the generation of the audio it loaded, that is
    // the count, not this re-read (#163 A-14): the sweep is not paused while
    // the recorder is open, so a Finished segment's PCM can be transcoded
    // under it, same clip id, generation + 1, while the buffer being saved
    // was cut from the PCM. `null` (not known) keeps the re-read.
    const generation =
      opts.baseGeneration ?? (await priorClipGeneration(tx, segmentId));
    const meta = { ...base, generation };
    await tx.objectStore("clipMeta").put(meta);
    await clipBytes.write(tx, clipId, bytes);
    // The row goes before the take write, so a prior clip only its base named
    // is released by the take write's own clean-up.
    await endOwnRow(tx, segmentId, clipId);
    const take = await writeTakeInTx(tx, segmentId, clipId, meta.durationMs, {
      finished: opts.finished,
      now,
    });
    await recordDisposition(tx, segmentId, clipId, "saved");
    await tx.done;
    return { outcome: "saved", take };
  } catch (cause) {
    // A THROWN error mid-transaction (e.g. `writeTakeInTx` finding no such
    // segment) does not roll the clip write back on its own: IndexedDB
    // auto-commits an inactive transaction unless it is aborted. Abort so the
    // clip rolls back WITH the failed take — the single-transaction atomicity
    // #38 depends on, and without which the clip would be the very orphan this
    // rewrite exists to prevent. (A failed *request* — quota on the clip write —
    // already aborts the transaction on its own; this covers the thrown case.)
    try {
      tx.abort();
    } catch {
      // Already settled — aborted by a request failure, or committed. Nothing
      // to undo; the original cause below is what the caller needs.
    }
    // Observe the aborted transaction's `done` (idb creates it eagerly and it
    // rejects with AbortError on abort), so it is not an unhandled rejection.
    // The original cause is what the caller acts on.
    await tx.done.catch(() => {});
    throw cause;
  }
}

/**
 * What a replay's conditional commit did, one outcome per verdict of
 * `judgePending` (docs/design/pending-take-lifecycle.md §4):
 *
 *   - `saved` (`free`): the take is the active take now;
 *   - `already-saved` (`done`): it already was, or another copy saved it; no
 *     second clip or take; a missing `saved` record is backfilled and this
 *     take's own row is dropped;
 *   - `discarded`: it was discarded here or in another copy, or this copy
 *     asked to discard it during the commit's writes; nothing written;
 *   - `gone`: its segment was deleted; only a row left behind was dropped;
 *   - `kept` (`moved`, `unexplained`): nothing was saved over the segment, and
 *     the take is on disk as a marked row, so the slot may let it go;
 *   - `held` (the same two): the segment's row key holds another clip's row,
 *     so nothing was written and the take is still only in the slot.
 */
export type ReplayResult =
  | { readonly outcome: "saved"; readonly take: Take }
  | { readonly outcome: "already-saved" | "discarded" | "gone" }
  | {
      readonly outcome: "kept" | "held";
      readonly verdict: "moved" | "unexplained";
    };

/**
 * The launch replay's conditional commit (#38 rebuild PR 3; #1557), also the
 * commit of every Retry of a replayed take. One owning transaction reads the
 * segment, its active take, the segment's row and the take's record, asks
 * `judgePending` once, and writes only what that verdict allows. Nothing is
 * written before the verdict.
 *
 * `merged` is the take's audio as the slot merged it; `take` is the recipe
 * itself, which `kept` writes back as an `inline` row when the take has no
 * whole row of its own. Rejects on a failed write (a quota failure included),
 * with nothing written: the caller keeps the take in the slot.
 */
export async function saveReplayedTake(
  take: NewTake & { readonly baseRevision: number },
  merged: Int16Array,
  sampleRate: number,
  opts: {
    now?: number;
    isDiscardRequested?: (clipId: ClipId) => boolean;
  } = {}
): Promise<ReplayResult> {
  const now = opts.now ?? Date.now();
  const base = buildClipMeta(take.clipId, merged, sampleRate, now);
  const bytes = ownedClipBytes(merged);

  const db = await getDb();
  const tx = openTakeTx(db);
  try {
    const { segmentId, clipId } = take;
    const segment = await tx.objectStore("segments").get(segmentId);
    const active = segment?.activeTakeId
      ? await tx.objectStore("takes").get(segment.activeTakeId)
      : undefined;
    const rows = tx.objectStore("pendingTakes");
    const row = await rows.get(segmentId);
    const record = await tx.objectStore("takeDispositions").get(clipId);
    const verdict = judgePending(
      segment,
      active?.clipId ?? null,
      row,
      record,
      take,
      opts.isDiscardRequested?.(clipId) === true
    );

    let result: ReplayResult;
    switch (verdict) {
      case "gone":
        await endOwnRow(tx, segmentId, clipId);
        result = { outcome: "gone" };
        break;
      case "done":
        await endOwnRow(tx, segmentId, clipId);
        await recordDisposition(tx, segmentId, clipId, "saved");
        result = { outcome: "already-saved" };
        break;
      case "discarded":
        // Nothing, the row included: a recorded Discard already deleted it,
        // and a Discard only requested here deletes it in its own settle,
        // with the record, so a kill before that leaves the row, not a gap.
        result = { outcome: "discarded" };
        break;
      case "free": {
        // The row's own generation when it carries one (#163 A-14): a
        // transcode since the hold does not move `audioRevision`, so the
        // verdict is still `free` over a clip one lossy pass further on.
        const generation =
          take.baseGeneration ?? (await priorClipGeneration(tx, segmentId));
        await tx.objectStore("clipMeta").put({ ...base, generation });
        await clipBytes.write(tx, clipId, bytes);
        await endOwnRow(tx, segmentId, clipId);
        const saved = await writeTakeInTx(
          tx,
          segmentId,
          clipId,
          base.durationMs,
          { finished: take.finished, now }
        );
        await recordDisposition(tx, segmentId, clipId, "saved");
        // The request again, in the last write's own turn (the hold's step 7,
        // George r1 on #1652): a tap during the writes above must not be
        // sealed as `saved`, which is final. Abort, so the row, the active
        // take and the revision stay as they were and the Discard's own
        // settle records it; otherwise commit here, so no window reopens.
        if (opts.isDiscardRequested?.(clipId) === true && abortNow(tx)) {
          await tx.done.catch(() => {});
          return { outcome: "discarded" };
        }
        tx.commit();
        result = { outcome: "saved", take: saved };
        break;
      }
      default: {
        const refusal = verdict === "moved" ? "superseded" : "unexplained";
        if (row && row.clipId !== clipId) {
          result = { outcome: "held", verdict };
          break;
        }
        // Keep, exactly: the row the slot lets go of must be whole on disk.
        // The take's own row is marked if its recipe is whole; otherwise (no
        // row, or a `stored` base that is gone or changed) the slot's recipe
        // is written as an `inline` row and marked.
        if (row && (await recipeWhole(tx, row))) {
          await rows.put({ ...row, refusal });
        } else {
          await rows.put({
            segmentId,
            ordinal: take.ordinal,
            clipId,
            base: encodePendingBase(take.existing, take.editOnly, null),
            recorded: new Int16Array(take.recorded).buffer,
            sampleRate,
            offset: take.offset,
            finished: take.finished,
            editOnly: take.editOnly,
            createdAt: row?.createdAt ?? now,
            baseRevision: take.baseRevision,
            ...(take.baseGeneration === null
              ? {}
              : { baseGeneration: take.baseGeneration }),
            refusal,
          });
          if (row?.base.kind === "stored") {
            await deleteClipIfUnreferenced(tx, row.base.sourceClipId);
          }
        }
        result = { outcome: "kept", verdict };
      }
    }
    await tx.done;
    return result;
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      // Already settled (aborted by a failed request, or committed); the
      // original cause is what the caller acts on.
    }
    await tx.done.catch(() => {});
    throw cause;
  }
}

/**
 * Clear a segment's audio, returning it to never-recorded.
 *
 * B5's cut-to-nothing lands here: a selection over the whole clip, cut, then
 * close leaves an empty working buffer, and persisting that as a 0-frame take
 * would fabricate a recorded state — a resolved clip that plays silence and can
 * be counted finished. Instead the take and its clip are removed and the segment
 * returns to "not-started" (the same shape B6's Erase Segment will reuse, G4).
 *
 * One atomic transaction, like `saveTake`: the pointer reset, the take-row delete
 * and the clip delete land together, so an interrupted clear never strands a
 * segment pointing at a take that is gone. Idempotent — a segment with no active
 * take is left "not-started" and nothing is deleted — so a repeated close, or a
 * cut-to-empty on an already-empty segment, is a safe no-op.
 */
export async function clearSegmentTake(segmentId: SegmentId): Promise<void> {
  const db = await getDb();
  // The take write's transaction: the same stores, and strict durability
  // because this removes the only copy of a take (#179).
  const tx = openTakeTx(db);
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  const priorTakeId = segment.activeTakeId;
  if (priorTakeId !== null) {
    const priorTake = await tx.objectStore("takes").get(priorTakeId);
    await tx.objectStore("takes").delete(priorTakeId);
    // The take row is already gone, so only the survivors count.
    if (priorTake) await deleteClipIfUnreferenced(tx, priorTake.clipId);
  }

  const now = Date.now();
  await tx.objectStore("segments").put({
    ...segment,
    activeTakeId: null,
    status: "not-started",
    modifiedAt: now,
    // v13 (#38): an erase that removed a take moves the revision; a no-op
    // clear of an empty segment does not, or it would refuse a valid
    // first-take row for nothing.
    audioRevision: segment.audioRevision + (priorTakeId === null ? 0 : 1),
  });

  // Editing is activity: bump the book's `updatedAt` in the same
  // transaction, exactly as recording does.
  const chapter = await tx.objectStore("chapters").get(segment.chapterId);
  const book = chapter
    ? await tx.objectStore("books").get(chapter.bookId)
    : undefined;
  if (book) {
    await tx
      .objectStore("books")
      .put({ ...book, updatedAt: now, modifiedAt: now });
  }

  await tx.done;
}

/**
 * End a take's pending row without a commit, in the owning transaction (v13,
 * #38): `discard` (a person confirmed it, in any copy) or `give-up` (a quota
 * failure dropped the row; the take is still wanted). Either deletes the row
 * if it is this take's and records why, together. A Discard also deletes the
 * take's own clip a failed attempt may have written, unless something uses it.
 * Never rejects: a failure comes back as a value for the hook to report.
 *
 * A settle that finds its segment deleted writes no record. Records go only
 * with their segment, so one written after the delete would never go; and
 * none is needed, because a deleted segment never comes back and every
 * writer refuses a take whose segment is gone.
 */
export async function settlePendingTake(
  segmentId: SegmentId,
  clipId: ClipId,
  kind: "discard" | "give-up"
): Promise<{ readonly ok: true } | { readonly ok: false; cause: unknown }> {
  try {
    const db = await getDb();
    const tx = openTakeTx(db);
    try {
      await endOwnRow(tx, segmentId, clipId);
      const present = (await tx.objectStore("segments").count(segmentId)) > 0;
      if (kind === "discard") {
        if (present) {
          await recordDisposition(tx, segmentId, clipId, "discarded");
        }
        await deleteClipIfUnreferenced(tx, clipId);
      } else if (present) {
        await recordDisposition(tx, segmentId, clipId, "given-up");
      }
      await tx.done;
      return { ok: true };
    } catch (cause) {
      try {
        tx.abort();
      } catch {
        // Already settled; the original cause is what the caller reports.
      }
      await tx.done.catch(() => {});
      throw cause;
    }
  } catch (cause) {
    return { ok: false, cause };
  }
}

/**
 * Mark a take's own row refused and keep it, in the owning transaction (the
 * note's §3 table, "Refuse or park"): the launch replay's classification, for
 * a row it will not install (`legacy`, `sample-rate`, `base-missing`,
 * `base-changed`). Writes nothing when the row is gone, is another clip's, or
 * is already marked, so a mark never overwrites another take's row or an
 * earlier reason. Never rejects: a failure comes back as a value for the hook
 * to report, and the row is then left as it was.
 */
export async function markPendingRefused(
  segmentId: SegmentId,
  clipId: ClipId,
  refusal: PendingRefusal
): Promise<{ readonly ok: true } | { readonly ok: false; cause: unknown }> {
  try {
    const db = await getDb();
    const tx = openTakeTx(db);
    const rows = tx.objectStore("pendingTakes");
    const row = await rows.get(segmentId);
    if (row?.clipId === clipId && row.refusal === undefined) {
      await rows.put({ ...row, refusal });
    }
    await tx.done;
    return { ok: true };
  } catch (cause) {
    return { ok: false, cause };
  }
}

/**
 * The binary "finished" write boundary over the 5-value enum (D-FIN).
 *
 * A never-recorded segment can be neither finished nor "draft": there is no
 * recording to be either. The invariant is enforced here, in the store, not
 * only by disabling the checkbox — writing "draft" onto an empty segment would
 * fabricate a recorded state that any Phase-2 reader of the enum would trust.
 * So on a segment with no active take, `true` rejects and `false` is an
 * idempotent no-op that leaves (or restores) "not-started".
 */
export async function setSegmentFinished(
  segmentId: SegmentId,
  finished: boolean
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    "segments",
    "readwrite",
    // Strict durability: this flips the bit an export trusts to decide what
    // ships. Same bar `openTakeTx` and `clearSegmentTake` hold, though the
    // blast radius here is the finished mark, not the recording itself
    // (#179, #829).
    { durability: "strict" }
  );
  const segment = await tx.store.get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  if (segment.activeTakeId === null) {
    if (finished) {
      throw new Error(
        `Segment ${segmentId} has no recording; cannot mark finished`
      );
    }
    await tx.store.put({
      ...segment,
      status: "not-started",
      modifiedAt: Date.now(),
    });
    await tx.done;
    return;
  }

  await tx.store.put({
    ...segment,
    status: finished ? FINISHED_STATUS : UNFINISHED_STATUS,
    modifiedAt: Date.now(),
  });
  await tx.done;
}
