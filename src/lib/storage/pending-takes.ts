/**
 * The pending-take store (v12, #1462): a take whose save has not landed,
 * written down so a kill and relaunch does not lose it (#38).
 *
 * The held take itself is `PendingTake` (`lib/takes/pending-take.ts`), and
 * until this module it lived only in React state. This is the store half: the
 * write, the read and the delete of one row per segment, and the stored |
 * inline base encoding (the DRI's 2026-10-19 pick, "base = stored | inline";
 * shape and reasons in docs/design/v12-schema.md, "The pending-takes store").
 *
 * The save hook writes and deletes rows (`hooks/use-save-take.ts`, slice 2 of
 * #38); the launch replay that reads them back is slice 3.
 *
 * **Best-effort, by design.** On a quota failure this write usually fails too,
 * so it protects the kill-and-relaunch case, not the quota case; and it must
 * never delay or gate `saveTake`. So:
 *
 *   - No function here rejects or throws. A failure is returned as a value,
 *     because `lib/` cannot reach the failure log (`hooks/report-failure.ts`);
 *     the hook that calls this reports it.
 *   - Every write and delete asks IndexedDB for `pendingTakes` ONLY. Readwrite
 *     transactions are queued only behind transactions whose store lists
 *     overlap, and `saveTake`'s (`openTakeTx` in `takes.ts`) does not name this
 *     store, so the two run side by side.
 *   - The caller does not await the write before saving: the hook starts the
 *     write before the commit, and the delete once the save lands or the
 *     translator confirms a discard, and awaits neither.
 *
 * **Ordering, and what is not guaranteed.** The write is called before its
 * commit and the delete only after it, so in practice the delete opens its
 * transaction after the write's, and IndexedDB runs overlapping readwrite
 * transactions in the order they were opened. That is practice, not a lock:
 * each call opens its transaction only after its own `await getDb()`, so call
 * order does not by itself fix open order, and a write could in principle land
 * after its delete and leave a row for a take that was saved. The backstop is
 * the read: a row whose `clipId` is the segment's active take reads back as
 * `"saved"` from `loadPendingRecipe`, never as a recording to offer, and the
 * same holds for a relaxed delete lost to a crash. The delete is also
 * conditional on `clipId`, so a late delete for one take never removes a newer
 * take's row.
 */

import type { IDBPDatabase } from "idb";

import { getDb, type TcMobileDb } from "./db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type {
  ClipId,
  PendingTakeBase,
  SegmentId,
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

type PendingWriteResult =
  | { readonly ok: true; readonly outcome: "written" | "kept" }
  | { readonly ok: false; readonly cause: unknown };

type PendingDeleteResult =
  | { readonly ok: true; readonly outcome: "deleted" | "kept" | "absent" }
  | { readonly ok: false; readonly cause: unknown };

type PendingListResult =
  | { readonly ok: true; readonly rows: StoredPendingTake[] }
  | { readonly ok: false; readonly cause: unknown };

/**
 * A row read back: the recipe to offer again, or why not.
 *
 *   - `saved`: the segment's take already uses this row's clip, so the save
 *     landed and the row is stale. Drop it; never offer it.
 *   - `segment-gone`: another copy deleted the segment.
 *   - `base-missing`, `base-changed`: a `stored` base whose clip is gone, or
 *     is not the PCM clip the row was written against (a transcode since).
 *     Never spliced: splicing an MP3 as PCM corrupts the audio. What the
 *     recovery screen offers instead is slice 3's call.
 *   - `sample-rate`: written under another rate than the caller saves at.
 *   - `failed`: the read itself failed.
 */
type PendingRecipeResult =
  | { readonly kind: "recipe"; readonly take: NewTake }
  | {
      readonly kind:
        | "saved"
        | "segment-gone"
        | "base-missing"
        | "base-changed"
        | "sample-rate";
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

/**
 * Write a pending take down. Never rejects, never throws.
 *
 * Get-or-create in ONE transaction, keyed by segment:
 *
 *   - the same `clipId` already held: a no-op (`"kept"`). A retry carries the
 *     same recipe under the same id, so there is nothing new to write;
 *   - a held row with a newer `createdAt`: kept. An older write that arrives
 *     late must not overwrite a known newer take with a stale one;
 *   - otherwise the row is put (`"written"`), replacing an older take for the
 *     same segment: the app holds one save slot.
 *
 * `source` is the stored clip behind `existing`, passed only when the buffer
 * is that clip unchanged (see `encodePendingBase`).
 */
export async function writePendingTake(
  take: NewTake,
  opts: {
    readonly source?: StoredClipSource | null;
    readonly sampleRate?: number;
    readonly now?: number;
  } = {}
): Promise<PendingWriteResult> {
  let row: StoredPendingTake;
  try {
    // Built before the first await, so the row is the recipe as it was when
    // the save was asked for.
    row = {
      segmentId: take.segmentId,
      ordinal: take.ordinal,
      clipId: take.clipId,
      base: encodePendingBase(
        take.existing,
        take.editOnly,
        opts.source ?? null
      ),
      recorded: ownBuffer(take.recorded),
      sampleRate: opts.sampleRate ?? CANONICAL_SAMPLE_RATE,
      offset: take.offset,
      finished: take.finished,
      editOnly: take.editOnly,
      createdAt: opts.now ?? Date.now(),
    };
  } catch (cause) {
    // A copy that cannot be allocated on a low-memory phone. The save itself
    // is unaffected; the caller reports this.
    return { ok: false, cause };
  }

  try {
    const db = await getDb();
    const tx = db.transaction("pendingTakes", "readwrite", DURABILITY);
    try {
      const held = await tx.store.get(row.segmentId);
      if (
        held &&
        (held.clipId === row.clipId || held.createdAt > row.createdAt)
      ) {
        await tx.done;
        return { ok: true, outcome: "kept" };
      }
      await tx.store.put(row);
      await tx.done;
      return { ok: true, outcome: "written" };
    } catch (cause) {
      settle(() => tx.abort());
      await tx.done.catch(() => {});
      throw cause;
    }
  } catch (cause) {
    return { ok: false, cause };
  }
}

/**
 * Remove the row for one take, and only that take. Never rejects.
 *
 * `"kept"` when the segment's row belongs to another `clipId`: a delete for an
 * older take must not remove a newer one's only durable copy. `"absent"` when
 * there is no row, so a repeated delete is a harmless no-op.
 */
export async function deletePendingTake(
  segmentId: SegmentId,
  clipId: ClipId
): Promise<PendingDeleteResult> {
  try {
    const db = await getDb();
    const tx = db.transaction("pendingTakes", "readwrite", DURABILITY);
    try {
      const held = await tx.store.get(segmentId);
      if (!held) {
        await tx.done;
        return { ok: true, outcome: "absent" };
      }
      if (held.clipId !== clipId) {
        await tx.done;
        return { ok: true, outcome: "kept" };
      }
      await tx.store.delete(segmentId);
      await tx.done;
      return { ok: true, outcome: "deleted" };
    } catch (cause) {
      settle(() => tx.abort());
      await tx.done.catch(() => {});
      throw cause;
    }
  } catch (cause) {
    return { ok: false, cause };
  }
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
  if (segment.activeTakeId) {
    const active = await tx.objectStore("takes").get(segment.activeTakeId);
    if (active?.clipId === row.clipId) return { kind: "saved" };
  }

  let existing: Int16Array;
  if (row.base.kind === "inline") {
    existing = new Int16Array(row.base.samples);
  } else {
    const base = row.base;
    const meta = await tx.objectStore("clipMeta").get(base.sourceClipId);
    const data = await tx.objectStore("clipData").get(base.sourceClipId);
    if (!meta || !data) return { kind: "base-missing" };
    if (
      meta.encoding !== "pcm" ||
      meta.generation !== base.generation ||
      meta.frameCount !== base.frameCount ||
      data.byteLength !== base.frameCount * 2
    ) {
      return { kind: "base-changed" };
    }
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
