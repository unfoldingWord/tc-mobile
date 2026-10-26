/**
 * The pending-take store (v12, #1462): a take whose save has not landed,
 * written down so a kill and relaunch does not lose it (#38).
 *
 * The held take itself is `PendingTake` (`lib/takes/pending-take.ts`). This is
 * the store half: the hold that writes one row per segment, the reads, and the
 * stored | inline base encoding (the DRI's 2026-10-19 pick, "base = stored |
 * inline"; shape and reasons in docs/design/v12-schema.md).
 *
 * From v13 the row's life follows docs/design/pending-take-lifecycle.md (§3).
 * The hold is one transaction that reads everything it decides from and puts
 * the row, or writes nothing. A row ends only in the owning transaction
 * (`saveTake` or `settlePendingTake` in `takes.ts`), which deletes it and
 * records why in `takeDispositions`, together, or with its segment.
 *
 * **Best-effort, by design.** It protects the kill-and-relaunch case, not the
 * quota case: on a quota failure the hook gives the row up (a `given-up`
 * record) and the next hold for that take writes nothing. No function here
 * rejects or throws; a failure is returned as a value, because `lib/` cannot
 * reach the failure log (`hooks/report-failure.ts`). The hook does not await
 * the hold before the commit: the two are serialized by IndexedDB on their
 * shared stores, and either order is correct (the note, "Ordering against the
 * clip write").
 */

import type { IDBPDatabase } from "idb";

import { getDb, type TcMobileDb } from "./db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type {
  ClipId,
  PendingTakeBase,
  StoredPendingTake,
} from "@/types/domain";

/**
 * Relaxed, not strict: the protected case is a process kill, which an
 * OS-buffered write survives, not a power loss; and a strict flush here would
 * compete for the disk with `saveTake`'s own strict flush, the write that
 * matters more.
 */
const DURABILITY = { durability: "relaxed" } as const;

/** What the store needs to know about the clip behind the editor's buffer. */
type StoredClipSource = Pick<
  ClipMeta,
  "id" | "encoding" | "generation" | "frameCount"
>;

/**
 * What a hold did. `written`: the row is on disk. Nothing was written for the
 * rest: `kept` (this take's row is already there), `kept-foreign` (another
 * take's row holds the segment, so this take has no safety copy),
 * `segment-gone`, `discarded` (requested in this copy, or recorded), `saved`
 * (the commit already landed) or `given-up` (dropped for quota on purpose).
 */
export type HoldOutcome =
  | "written"
  | "kept"
  | "kept-foreign"
  | "segment-gone"
  | "discarded"
  | "saved"
  | "given-up";

type PendingWriteResult =
  | { readonly ok: true; readonly outcome: HoldOutcome }
  | { readonly ok: false; readonly cause: unknown };

type PendingListResult =
  | { readonly ok: true; readonly rows: StoredPendingTake[] }
  | { readonly ok: false; readonly cause: unknown };

/**
 * A row read back: the recipe to offer again, or why not. A recipe only
 * advises: whether its take is already saved, discarded or moved is the
 * conditional commit's verdict (`saveReplayedTake`), decided inside its own
 * transaction, so this read has no `saved` arm of its own (#1557).
 *
 *   - `segment-gone`: another copy deleted the segment.
 *   - `base-missing`, `base-changed`: a `stored` base whose clip is gone, or
 *     is not the PCM clip the row was written against (a transcode since).
 *     Never spliced: splicing an MP3 as PCM corrupts the audio. The launch
 *     replay marks the row refused and keeps it.
 *   - `sample-rate`: written under another rate than the caller saves at.
 *   - `failed`: the read itself failed.
 */
type PendingRecipeResult =
  | { readonly kind: "recipe"; readonly take: NewTake }
  | {
      readonly kind:
        "segment-gone" | "base-missing" | "base-changed" | "sample-rate";
    }
  | { readonly kind: "failed"; readonly cause: unknown };

/**
 * A copy through a fresh buffer, the `clipData` precedent (`saveTake`): a
 * trimmed view must not carry its whole backing buffer into the row.
 */
function ownBuffer(view: Int16Array): ArrayBuffer {
  return new Int16Array(view).buffer;
}

/**
 * The base a pending take splices onto, `stored` or `inline`.
 *
 * `stored` only when every one of these holds; anything else is `inline`:
 *
 *   - the caller passes the clip, which it may do ONLY when the editor's
 *     buffer is that stored clip unchanged (no cut or paste this session);
 *   - the save is not edit-only (there the whole edited buffer is `existing`,
 *     and nothing in `clipData` holds it);
 *   - the clip is PCM (a Finished segment's clip is an MP3, and a replay would
 *     decode it again with no guarantee of the same sample count);
 *   - the buffer is exactly as long as the clip, a cheap check on the caller's
 *     word that nothing was cut.
 *
 * A first take is `inline` with an empty buffer: zero bytes, and the union
 * stays the two the DRI picked.
 */
export function encodePendingBase(
  existing: Int16Array,
  editOnly: boolean,
  source: StoredClipSource | null
): PendingTakeBase {
  if (
    source &&
    !editOnly &&
    source.encoding === "pcm" &&
    source.frameCount === existing.length
  ) {
    return {
      kind: "stored",
      sourceClipId: source.id,
      generation: source.generation,
      frameCount: source.frameCount,
    };
  }
  return { kind: "inline", samples: ownBuffer(existing) };
}

/** The hold's scope (the note, §3 "The hold"). */
function openHoldTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(
    [
      "segments",
      "takes",
      "clipMeta",
      "clipData",
      "pendingTakes",
      "takeDispositions",
    ],
    "readwrite",
    DURABILITY
  );
}

type HoldTx = ReturnType<typeof openHoldTx>;

/**
 * Hold a take: write its row before the commit, so a kill does not lose it.
 * Never rejects, never throws.
 *
 * One transaction, nothing awaited before it but `getDb()`, in the note's
 * seven steps (docs/design/pending-take-lifecycle.md, §3 "The hold"): the
 * segment, this copy's Discard request, the take's disposition, the active
 * take, the segment's row (never overwritten when it is another take's), then
 * the put with `baseRevision`, and the Discard request again in the put's own
 * success turn, with `commit()` there so no further window opens.
 *
 * `baseRevision` is the take's own, the segment's `audioRevision` read with
 * the audio `existing` came from, never this transaction's read of the
 * segment: an erase or save that landed between the base read and the hold
 * must stay visible to a replay, which then judges the row `moved` (cell HM,
 * George r1 on #1618). A take that does not know its revision (`null`) is
 * held with none, so a replay refuses it the way it refuses a row from
 * before v13 (`legacy`), and the audio is kept rather than spliced.
 *
 * `baseGeneration` is stamped the same way, from the take, and omitted when
 * it is `null` (#163 A-14): a replay then re-reads it, as it did before.
 *
 * `source` is the stored clip behind `existing`, passed only when the buffer
 * is that clip unchanged. It becomes a `stored` base only if the clip checks
 * out inside this transaction; otherwise the base is `inline`.
 */
export async function writePendingTake(
  take: NewTake,
  opts: {
    readonly source?: StoredClipSource | null;
    readonly sampleRate?: number;
    readonly now?: number;
    readonly isDiscardRequested?: (clipId: ClipId) => boolean;
  } = {}
): Promise<PendingWriteResult> {
  const requested = (): boolean =>
    opts.isDiscardRequested?.(take.clipId) === true;
  try {
    const db = await getDb();
    const tx = openHoldTx(db);
    try {
      const outcome = await holdInTx(tx, take, opts, requested);
      await tx.done;
      return { ok: true, outcome };
    } catch (cause) {
      settle(() => tx.abort());
      await tx.done.catch(() => {});
      throw cause;
    }
  } catch (cause) {
    return { ok: false, cause };
  }
}

async function holdInTx(
  tx: HoldTx,
  take: NewTake,
  opts: {
    readonly source?: StoredClipSource | null;
    readonly sampleRate?: number;
    readonly now?: number;
  },
  requested: () => boolean
): Promise<HoldOutcome> {
  const segment = await tx.objectStore("segments").get(take.segmentId);
  if (!segment) return "segment-gone";
  if (requested()) return "discarded";
  const record = await tx.objectStore("takeDispositions").get(take.clipId);
  if (record) return record.kind;
  if (segment.activeTakeId) {
    const active = await tx.objectStore("takes").get(segment.activeTakeId);
    if (active?.clipId === take.clipId) return "saved";
  }
  const rows = tx.objectStore("pendingTakes");
  const held = await rows.get(take.segmentId);
  if (held) return held.clipId === take.clipId ? "kept" : "kept-foreign";

  const source = await checkedSource(tx, opts.source ?? null);
  const row: StoredPendingTake = {
    segmentId: take.segmentId,
    ordinal: take.ordinal,
    clipId: take.clipId,
    base: encodePendingBase(take.existing, take.editOnly, source),
    recorded: ownBuffer(take.recorded),
    sampleRate: opts.sampleRate ?? CANONICAL_SAMPLE_RATE,
    offset: take.offset,
    finished: take.finished,
    editOnly: take.editOnly,
    createdAt: opts.now ?? Date.now(),
    ...(take.baseRevision === null ? {} : { baseRevision: take.baseRevision }),
    ...(take.baseGeneration === null
      ? {}
      : { baseGeneration: take.baseGeneration }),
  };
  await rows.put(row);
  // The put's success turn: no tap can run between this check and the
  // commit below.
  const discarded = requested();
  if (discarded) {
    // Not awaited: an await would end this turn before `commit()`. A failed
    // delete aborts the transaction, and `tx.done` carries that to the caller
    // as `ok: false`; this handler only stops the same failure surfacing a
    // second time as an unhandled rejection.
    rows.delete(take.segmentId).catch(() => {});
  }
  tx.commit();
  return discarded ? "discarded" : "written";
}

/**
 * The caller's source, if its clip is on disk exactly as the caller read it:
 * PCM, at the same `generation` and `frameCount`, with that many frames of
 * bytes. Otherwise `null`, and the base is written inline. Read in the hold's
 * own transaction, so a replace or transcode either lands before (and fails
 * this) or after (and finds the row protecting the clip).
 */
async function checkedSource(
  tx: HoldTx,
  source: StoredClipSource | null
): Promise<StoredClipSource | null> {
  if (!source) return null;
  const meta = await tx.objectStore("clipMeta").get(source.id);
  const data = await tx.objectStore("clipData").get(source.id);
  return baseClipIntact(meta, data, source) ? source : null;
}

/**
 * Whether a base clip is on disk exactly as a row or a source names it: PCM,
 * at that `generation` and `frameCount`, with that many frames of bytes. The
 * one check the hold (before it writes a `stored` base), the recipe read and
 * a replay's keep (before it frees the slot) all make.
 */
export function baseClipIntact(
  meta: ClipMeta | undefined,
  data: ArrayBuffer | undefined,
  want: { readonly generation: number; readonly frameCount: number }
): boolean {
  return (
    meta?.encoding === "pcm" &&
    meta.generation === want.generation &&
    meta.frameCount === want.frameCount &&
    data?.byteLength === want.frameCount * 2
  );
}

/** Every pending row, for the launch replay. Never rejects. */
export async function listPendingTakes(): Promise<PendingListResult> {
  try {
    const db = await getDb();
    return { ok: true, rows: await db.getAll("pendingTakes") };
  } catch (cause) {
    return { ok: false, cause };
  }
}

/**
 * Read a row back as the recipe the save hook holds. Never rejects.
 *
 * One read-only transaction over the segment, its take and the base clip, so
 * every check below judges the same state. A `stored` base is used only if its
 * `clipMeta` is still there, still `"pcm"`, still at the `generation` and
 * `frameCount` the row was written against, and its bytes are that many
 * frames; anything else is refused, never spliced.
 */
export async function loadPendingRecipe(
  row: StoredPendingTake,
  sampleRate: number
): Promise<PendingRecipeResult> {
  if (row.sampleRate !== sampleRate) return { kind: "sample-rate" };
  try {
    const db = await getDb();
    const tx = openRecipeTx(db);
    try {
      const result = await readRecipe(tx, row);
      await tx.done;
      return result;
    } catch (cause) {
      settle(() => tx.abort());
      await tx.done.catch(() => {});
      throw cause;
    }
  } catch (cause) {
    return { kind: "failed", cause };
  }
}

/** The read `loadPendingRecipe` makes; `RecipeTx` is derived from it. */
function openRecipeTx(db: IDBPDatabase<TcMobileDb>) {
  return db.transaction(
    ["segments", "takes", "clipMeta", "clipData"],
    "readonly"
  );
}

type RecipeTx = ReturnType<typeof openRecipeTx>;

async function readRecipe(
  tx: RecipeTx,
  row: StoredPendingTake
): Promise<PendingRecipeResult> {
  const segment = await tx.objectStore("segments").get(row.segmentId);
  if (!segment) return { kind: "segment-gone" };

  let existing: Int16Array;
  if (row.base.kind === "inline") {
    existing = new Int16Array(row.base.samples);
  } else {
    const base = row.base;
    const meta = await tx.objectStore("clipMeta").get(base.sourceClipId);
    const data = await tx.objectStore("clipData").get(base.sourceClipId);
    if (!meta || !data) return { kind: "base-missing" };
    if (!baseClipIntact(meta, data, base)) return { kind: "base-changed" };
    existing = new Int16Array(data);
  }

  return {
    kind: "recipe",
    take: {
      segmentId: row.segmentId,
      ordinal: row.ordinal,
      clipId: row.clipId,
      existing,
      recorded: new Int16Array(row.recorded),
      offset: row.offset,
      finished: row.finished,
      editOnly: row.editOnly,
      baseRevision: row.baseRevision ?? null,
      // Absent on a row written before #163 A-14: unknown, so the commit
      // re-reads, as it did then.
      baseGeneration: row.baseGeneration ?? null,
    },
  };
}

/**
 * Abort a transaction a thrown error left open, so nothing half-done commits.
 * A failed request has already aborted it, and a committed one cannot be:
 * either way there is nothing to undo, and the caller returns the original
 * cause.
 */
function settle(abort: () => void): void {
  try {
    abort();
  } catch {
    // Already settled (aborted by a failed request, or committed); see above.
  }
}
