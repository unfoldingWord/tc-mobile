/**
 * Take writes — the one recording behind a segment, and the finished flag.
 *
 * Split out of `books.ts` (#160, L-16), which had grown to hold the whole tree
 * plus every write that touches audio. What lives here is one cohesive thing:
 * the transaction shape a take write needs, the 1:1 replace itself, and the
 * two write paths over it — `addTake` (clip already on disk) and `saveTake`
 * (clip written in the same transaction, the #38 atomicity fix) — plus the
 * clear and the finished mark.
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

import { buildClipMeta } from "./clips";
import { getDb, type TcMobileDb } from "./db";
import type {
  ClipId,
  RecordingStatus,
  SegmentId,
  Take,
  TakeId,
} from "@/types/domain";

const uuid = (): string => crypto.randomUUID();

/**
 * Open the transaction a take write needs: the take row and segment pointer, the
 * clip both `saveTake` writes and a superseded take's clip is deleted from, and
 * the book/chapter parents floated to the top of the shelf. `addTake` and
 * `saveTake` open the identical transaction — `saveTake` just also writes the
 * clip inside it — so the store list and the take logic are shared, not
 * duplicated. `TakeTx` is derived from this call's return so the helper's
 * parameter type cannot drift from what actually opens.
 */
function openTakeTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(
    ["segments", "takes", "clipMeta", "clipData", "chapters", "books"],
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
 * All of it is one atomic transaction spanning the take, segment, and clip
 * stores, so the delete of the old audio cannot land without the new audio and
 * pointer landing too: an interrupted replace never strands the new recording.
 * The prior clip is deleted only when it differs from the new one, so a retry
 * that reuses a clip id (the pending-take upsert path) never deletes the audio
 * it just committed.
 *
 * `finished` sets the segment's final status in this same transaction. It
 * defaults to false — a new recording is draft, which is what demotes an
 * approved segment — so `true` is only ever the recorder carrying an explicit
 * Finished mark for THIS take. Writing it here, atomically with the take, is
 * what lets the mark survive a save-failure retry (which re-runs this) instead
 * of being lost to a separate write the recovery path never reaches.
 *
 * Shared by `addTake` (clip already on disk) and `saveTake` (clip written in the
 * same transaction), so the 1:1 replace, the finished-mark, the prior-clip
 * cleanup and the book float exist once. Does NOT open or close the transaction:
 * the caller owns its lifetime, which is what lets `saveTake` make the clip write
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
    // A new recording is draft unless the recorder carried an explicit Finished
    // mark for it: a fresh take demotes an approved segment and moves a first
    // take off "not-started", while an explicit mark lands finished atomically
    // with the take (so a retry re-applies it, never a separate lost write).
    status: finished ? FINISHED_STATUS : UNFINISHED_STATUS,
  });

  if (priorTake && priorTake.id !== take.id) {
    await tx.objectStore("takes").delete(priorTake.id);
    // Guard the clip delete against a reused id: retrying a save with the same
    // clipId must not delete the audio the new take now points at.
    if (priorTake.clipId !== clipId) {
      await tx.objectStore("clipMeta").delete(priorTake.clipId);
      await tx.objectStore("clipData").delete(priorTake.clipId);
    }
  }

  // Recording is activity: float the book to the top of the shelf (listBooks
  // sorts by updatedAt), in the SAME transaction so the take and the recency
  // land together. A dangling chapter/book parent is skipped rather than
  // failing a save that otherwise succeeded.
  const chapter = await tx.objectStore("chapters").get(segment.chapterId);
  const book = chapter
    ? await tx.objectStore("books").get(chapter.bookId)
    : undefined;
  if (book) await tx.objectStore("books").put({ ...book, updatedAt: now });

  return take;
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
 * Point a segment at an already-stored clip as its active take.
 *
 * Assumes the clip is on disk (its caller `putClip`s first). For the record/edit
 * commit path, prefer `saveTake`, which writes the clip in the SAME transaction
 * so a failure cannot strand an orphan.
 */
export async function addTake(
  segmentId: SegmentId,
  clipId: ClipId,
  durationMs: number,
  opts: { finished?: boolean; now?: number } = {}
): Promise<Take> {
  const db = await getDb();
  const tx = openTakeTx(db);
  const take = await writeTakeInTx(tx, segmentId, clipId, durationMs, opts);
  await tx.done;
  return take;
}

/**
 * Persist a recording — the clip AND the take — in ONE transaction.
 *
 * This is the commit path's write, and its atomicity is the #38 fix. The old
 * flow was `putClip` (transaction A) then `addTake` (transaction B): if the
 * second failed — quota on the take/segment write, or the clip write itself
 * succeeding and then the process dying — the clip was already durable with no
 * take referencing it. That orphan consumed the very space the recovery screen
 * tells the translator to free, so freeing space and retrying failed again: the
 * quota death spiral. One transaction removes the half-written state entirely —
 * a quota failure rolls back the clip too, so there is nothing to reap.
 *
 * The clip write is the same shape as `putClip` (build meta, reject a 0-frame
 * clip, copy through a fresh ArrayBuffer so a trimmed view does not serialise its
 * whole backing buffer); the take write is `writeTakeInTx`, shared with
 * `addTake`. `putClip` is an upsert on `clipId`, so a retry with the same id
 * overwrites rather than duplicating.
 */
export async function saveTake(
  segmentId: SegmentId,
  clipId: ClipId,
  samples: Int16Array,
  sampleRate: number,
  opts: { finished?: boolean; now?: number } = {}
): Promise<Take> {
  const now = opts.now ?? Date.now();
  // Built before the transaction opens, so a 0-frame clip is rejected without
  // ever starting a write. The generation is stamped below, inside the
  // transaction, once the prior clip has been read.
  const base = buildClipMeta(clipId, samples, sampleRate, now);
  const bytes = new Int16Array(samples);

  const db = await getDb();
  const tx = openTakeTx(db);
  try {
    // The lossy-pass count carries over from the clip this take REPLACES (B8,
    // Q5). The only way a segment has a prior take at save time is that the
    // recorder opened it and edited or inserted into its audio — and if that
    // audio was an MP3 (a finished segment being fixed), the buffer being saved
    // was decoded from it and has been through that many lossy passes already.
    // An erase clears the take first, so a genuinely fresh recording starts at
    // 0. Read inside the transaction so the count and the take it describes
    // come from the same state.
    const generation = await priorClipGeneration(tx, segmentId);
    const meta = { ...base, generation };
    await tx.objectStore("clipMeta").put(meta);
    await tx.objectStore("clipData").put(bytes.buffer, clipId);
    const take = await writeTakeInTx(tx, segmentId, clipId, meta.durationMs, {
      ...opts,
      now,
    });
    await tx.done;
    return take;
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
 * Clear a segment's audio, returning it to never-recorded.
 *
 * B5's cut-to-nothing lands here: a selection over the whole clip, cut, then
 * close leaves an empty working buffer, and persisting that as a 0-frame take
 * would fabricate a recorded state — a resolved clip that plays silence and can
 * be counted finished. Instead the take and its clip are removed and the segment
 * returns to "not-started" (the same shape B6's Erase Segment will reuse, G4).
 *
 * One atomic transaction, like `addTake`: the pointer reset, the take-row delete
 * and the clip delete land together, so an interrupted clear never strands a
 * segment pointing at a take that is gone. Idempotent — a segment with no active
 * take is left "not-started" and nothing is deleted — so a repeated close, or a
 * cut-to-empty on an already-empty segment, is a safe no-op.
 */
export async function clearSegmentTake(segmentId: SegmentId): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["segments", "takes", "clipMeta", "clipData", "chapters", "books"],
    "readwrite",
    // Strict durability: this removes the only copy of a take. #179.
    { durability: "strict" }
  );
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  const priorTakeId = segment.activeTakeId;
  if (priorTakeId !== null) {
    const priorTake = await tx.objectStore("takes").get(priorTakeId);
    await tx.objectStore("takes").delete(priorTakeId);
    if (priorTake) {
      // Delete the clip only when no OTHER take still points at it. Nothing
      // shares a clip today (every take mints a fresh `newClipId()`), but a
      // future content-addressed import could dedupe, and an unconditional
      // delete would then punch a hole in another segment — unrecoverable audio
      // loss (Frank R4). The take row is already gone, so `getAll` sees only the
      // survivors. NOTE: `addTake`'s prior-clip delete has the same latent
      // property and is tracked in #68.
      const survivors = await tx.objectStore("takes").getAll();
      const stillReferenced = survivors.some(
        (t) => t.clipId === priorTake.clipId
      );
      if (!stillReferenced) {
        await tx.objectStore("clipMeta").delete(priorTake.clipId);
        await tx.objectStore("clipData").delete(priorTake.clipId);
      }
    }
  }

  await tx.objectStore("segments").put({
    ...segment,
    activeTakeId: null,
    status: "not-started",
  });

  // Editing is activity: float the book to the top of the shelf in the same
  // transaction, exactly as recording does.
  const chapter = await tx.objectStore("chapters").get(segment.chapterId);
  const book = chapter
    ? await tx.objectStore("books").get(chapter.bookId)
    : undefined;
  if (book)
    await tx.objectStore("books").put({ ...book, updatedAt: Date.now() });

  await tx.done;
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
  const tx = db.transaction("segments", "readwrite");
  const segment = await tx.store.get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  if (segment.activeTakeId === null) {
    if (finished) {
      throw new Error(
        `Segment ${segmentId} has no recording; cannot mark finished`
      );
    }
    await tx.store.put({ ...segment, status: "not-started" });
    await tx.done;
    return;
  }

  await tx.store.put({
    ...segment,
    status: finished ? FINISHED_STATUS : UNFINISHED_STATUS,
  });
  await tx.done;
}
