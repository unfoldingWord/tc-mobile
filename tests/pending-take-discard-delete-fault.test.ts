import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import {
  listPendingTakes,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { SegmentId } from "@/types/domain";
import { clearAllStores, ramp } from "./support";

/**
 * The hold's Discard-after-put branch (#1747, from #1618): when Discard is
 * requested in the put's own success turn, `holdInTx` deletes the row it just
 * wrote without awaiting the delete, so `commit()` stays in the same turn, and
 * gives the delete an empty `.catch`. Two halves are pinned here:
 *
 * 1. a delete that fails as a request aborts the transaction, and
 *    `writePendingTake` reports it as `ok: false` through `tx.done`;
 * 2. that same failure is not raised a second time as an unhandled
 *    rejection, which is all the empty handler is for.
 *
 * Half 2 is observed with a process-level `unhandledRejection` listener that,
 * for the length of one case, is the only one installed (vitest's own are set
 * aside and put back), and the probe case shows that listener does see an
 * unhandled rejection within the same wait.
 */

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

const take = (segmentId: SegmentId): NewTake => ({
  segmentId,
  ordinal: 1,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: ramp(50),
  offset: 0,
  finished: false,
  editOnly: false,
  baseRevision: 0,
  baseGeneration: null,
});

/**
 * Make a delete on `pendingTakes` fail as a request rather than throw: it
 * issues an `add` of the key the hold has just put, which errors with a
 * ConstraintError, and that request's error aborts the transaction.
 */
const failPendingDelete = (): { readonly issued: () => number } => {
  const realDelete = IDBObjectStore.prototype.delete;
  const realAdd = IDBObjectStore.prototype.add;
  let issued = 0;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    query
  ) {
    if (this.name !== "pendingTakes") return realDelete.call(this, query);
    issued++;
    return realAdd.call(this, {
      segmentId: query,
    }) as unknown as IDBRequest<undefined>;
  });
  return { issued: () => issued };
};

/** Give a pending rejection the turns Node needs to report it. */
const settleTurns = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/**
 * Run `body` with a listener that is the only `unhandledRejection` listener,
 * and return the reasons it saw.
 */
const unhandledDuring = async (
  body: () => Promise<void>
): Promise<unknown[]> => {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  const prior = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", onRejection);
  try {
    await body();
    await settleTurns();
  } finally {
    process.off("unhandledRejection", onRejection);
    for (const listener of prior) process.on("unhandledRejection", listener);
  }
  return seen;
};

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the hold's Discard-after-put delete, when it fails", () => {
  it("probe: the listener sees an unhandled rejection within the wait", async () => {
    const probe = new Error("probe");
    const seen = await unhandledDuring(async () => {
      void Promise.reject(probe);
    });
    expect(seen).toEqual([probe]);
  });

  it("returns ok: false, leaves no row, and raises no unhandled rejection", async () => {
    const segmentId = await freshSegment();
    // False at the hold's first check, true in the put's success turn.
    let checks = 0;
    const isDiscardRequested = (): boolean => ++checks > 1;
    const deletes = failPendingDelete();

    let result: Awaited<ReturnType<typeof writePendingTake>> | undefined;
    const seen = await unhandledDuring(async () => {
      result = await writePendingTake(take(segmentId), {
        isDiscardRequested,
      });
    });

    // The branch under test ran: the second check fired and the delete was
    // issued on pendingTakes.
    expect(checks).toBe(2);
    expect(deletes.issued()).toBe(1);
    // Half 1: the failure reaches the caller.
    // (The cause's name is the backend's: fake-indexeddb rejects `tx.done`
    // with an AbortError, so it is not pinned.)
    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.cause).toBeInstanceOf(Error);
    // Half 2: and only once.
    expect(seen).toEqual([]);

    vi.restoreAllMocks();
    const listed = await listPendingTakes();
    if (!listed.ok) throw listed.cause;
    expect(listed.rows).toEqual([]);
  });
});
