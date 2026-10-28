/**
 * The clip-bytes seam (#1751, part of #1456): the one module that reads,
 * writes, probes and deletes a clip's bytes.
 *
 * A clip's bytes are the only copy of a recording. They sit in the `clipData`
 * store today, and later backends (the card children of #1456) change where.
 * Every byte site in `src/` calls this module, and no other file names the
 * store, so such a change is made here. `tests/clip-bytes-seam.test.ts` keeps
 * that true.
 *
 * Bound to the caller's transaction. Each method takes the transaction that
 * also holds the segment, take or pending-row change the bytes belong with,
 * and never opens its own: a save's bytes land or roll back with its take row
 * (the #38 atomicity, `saveTake`). A backend that cannot join an IndexedDB
 * transaction needs a different contract; that is the commit-protocol child's
 * design, not this module's.
 *
 * The clip metadata (`clipMeta`) is not behind this seam: it stays in
 * IndexedDB as the index of what exists.
 */

import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";

import type { TcMobileDb } from "./db";
import type { ClipId } from "@/types/domain";

const STORE = "clipData" satisfies StoreNames<TcMobileDb>;

type AnyStores = ArrayLike<StoreNames<TcMobileDb>>;

/**
 * Every transaction mode, and the one that writes, read off idb's own
 * `transaction` signature rather than spelled as literals: under the DOM-free
 * `typecheck:lib` a transaction's mode types as `string`, so literal modes
 * would reject every caller there.
 */
type AnyMode = NonNullable<
  Parameters<IDBPDatabase<TcMobileDb>["transaction"]>[1]
>;
type WriteMode = Exclude<AnyMode, "readonly" | "versionchange">;

/** A transaction whose scope includes the bytes ({@link withClipBytes}). */
type ClipBytesTx<Mode extends AnyMode> = IDBPTransaction<
  TcMobileDb,
  AnyStores,
  Mode
>;

/** Where a clip's bytes live, on the caller's transaction. */
interface ClipByteStore {
  /** The clip's bytes, or `undefined` when none are stored under `id`. */
  read<Mode extends AnyMode>(
    tx: ClipBytesTx<Mode>,
    id: ClipId
  ): Promise<ArrayBuffer | undefined>;
  /** Whether bytes are stored under `id`, without reading them. */
  has<Mode extends AnyMode>(
    tx: ClipBytesTx<Mode>,
    id: ClipId
  ): Promise<boolean>;
  /**
   * Store `bytes` under `id`, replacing what is there. `bytes` is an owned,
   * right-sized buffer ({@link ownedClipBytes}), never a view.
   */
  write(
    tx: ClipBytesTx<WriteMode>,
    id: ClipId,
    bytes: ArrayBuffer
  ): Promise<void>;
  /** Remove the bytes under `id`. The caller has checked nothing uses them. */
  delete(tx: ClipBytesTx<WriteMode>, id: ClipId): Promise<void>;
}

/** The only backend: the `clipData` object store. */
const indexedDbClipBytes: ClipByteStore = {
  read: (tx, id) => tx.objectStore(STORE).get(id),
  has: async (tx, id) => (await tx.objectStore(STORE).getKey(id)) !== undefined,
  write: async (tx, id, bytes) => {
    await tx.objectStore(STORE).put(bytes, id);
  },
  delete: (tx, id) => tx.objectStore(STORE).delete(id),
};

export const clipBytes: ClipByteStore = indexedDbClipBytes;

/**
 * A transaction scope with the bytes in it: `stores` with the clip-bytes
 * store appended. Scope lists name it through here, so no file but this one
 * and the schema spells it.
 */
export function withClipBytes<
  const Stores extends readonly StoreNames<TcMobileDb>[],
>(stores: Stores): readonly [...Stores, typeof STORE] {
  return [...stores, STORE];
}

/**
 * A fresh, right-sized copy of a clip's bytes, for {@link ClipByteStore.write}.
 * A view onto a larger buffer would store the whole backing buffer. Call it
 * BEFORE the transaction opens, so an allocation failure cannot abort a
 * transaction that has already started.
 */
export function ownedClipBytes(view: Int16Array | Uint8Array): ArrayBuffer {
  return view.slice().buffer;
}
