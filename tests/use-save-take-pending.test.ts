import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both stores pass through to the real modules unless a case replaces one
// call: that is how a never-settling hold, a failed hold or settle, or a
// commit failure is produced without a quota to exhaust in fake-indexeddb.
vi.mock("@/lib/storage/pending-takes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/storage/pending-takes")>();
  return { ...actual, writePendingTake: vi.fn(actual.writePendingTake) };
});
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return {
    ...actual,
    saveTake: vi.fn(actual.saveTake),
    settlePendingTake: vi.fn(actual.settlePendingTake),
  };
});

import { performDiscardTake, performSaveTake } from "@/hooks/use-save-take";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import {
  addChapter,
  addSegment,
  createBook,
  getSegment,
} from "@/lib/storage/books";
import { getClipMeta, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  listPendingTakes,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import { saveTake, settlePendingTake } from "@/lib/storage/takes";
import {
  retrySave,
  startSave,
  type PendingTake,
} from "@/lib/takes/pending-take";
import type { ClipId, SegmentId, TakeDisposition } from "@/types/domain";
import { clearAllStores, recordTake } from "./support";

/**
 * #38: the save orchestration holds the take in `pendingTakes` before the
 * commit, and the row ends in the owning transaction: the commit (saved), a
 * confirmed Discard (discarded) or a quota give-up (given-up), each with its
 * record (v13, docs/design/pending-take-lifecycle.md §3).
 *
 * Covered through `performSaveTake` and `performDiscardTake`, the whole of the
 * two operations minus React (see `tests/use-save-take.test.ts` for why the
 * hook itself is not mounted). The hold and the settles are not awaited by
 * the operation, so these cases wait for the spy's result or the store's
 * state.
 */

const samples = (length: number, value = 1000): Int16Array =>
  Int16Array.from({ length }, () => value);

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return segment.id;
};

const heldTake = (segmentId: SegmentId, clipId: ClipId): PendingTake =>
  startSave(null, {
    segmentId,
    ordinal: null,
    clipId,
    existing: new Int16Array(0),
    recorded: samples(10),
    offset: 0,
    finished: false,
    editOnly: false,
    baseRevision: 0,
    baseGeneration: null,
  });

const slot = (initial: PendingTake | null) => {
  let held = initial;
  return {
    held: () => held,
    update: (transition: (h: PendingTake | null) => PendingTake | null) => {
      held = transition(held);
    },
  };
};

/** The clip ids `pendingTakes` holds rows for. */
const pendingClipIds = async (): Promise<ClipId[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows.map((r) => r.clipId);
};

const recordOf = async (
  clipId: ClipId
): Promise<TakeDisposition["kind"] | undefined> =>
  (await (await getDb()).get("takeDispositions", clipId))?.kind;

/**
 * Hold a read-write transaction on `segments` open until released, so every
 * transaction that names `segments` (the hold, the commit, a settle) queues
 * behind it: the "stalled hold" of George r6 on #1546.
 */
async function stallSegments(): Promise<() => Promise<void>> {
  const db = await getDb();
  const tx = db.transaction("segments", "readwrite");
  let released = false;
  const running = (async () => {
    while (!released) await tx.store.get("stall" as SegmentId);
    await tx.done;
  })();
  return async () => {
    released = true;
    await running;
  };
}

const write = vi.mocked(writePendingTake);
const settle = vi.mocked(settlePendingTake);

let reports: FailureReport[] = [];
let off: () => void = () => {};

beforeEach(async () => {
  await clearAllStores();
  // Back to the pass-through, dropping any one-off implementation a previous
  // case queued but never reached.
  write.mockReset();
  settle.mockReset();
  vi.mocked(saveTake).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reports = [];
  off = subscribeToFailures((r) => reports.push(r));
});

afterEach(() => {
  off();
  vi.restoreAllMocks();
});

describe("performSaveTake — the pending row", () => {
  it("is written before the commit starts, and the commit deletes it and records saved", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);

    const ok = await performSaveTake(take, {
      update: slot(take).update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(take);
    expect(write.mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(saveTake).mock.invocationCallOrder[0]!
    );
    expect(await write.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "written",
    });
    expect(await pendingClipIds()).toEqual([]);
    expect(await recordOf(clipId)).toBe("saved");
    expect(settle).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
  });

  it("writes no row for a segment that is gone, and the save fails", async () => {
    // DL-S at the hook: `saveTake` throws "No such segment: …".
    const segmentId = newClipId() as unknown as SegmentId;
    const take = heldTake(segmentId, newClipId());

    const ok = await performSaveTake(take, {
      update: slot(take).update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(false);
    expect(await write.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "segment-gone",
    });
    expect(await pendingClipIds()).toEqual([]);
  });

  // This pins the hook only: it does not await the hold's promise. It stubs
  // `writePendingTake`, so no hold transaction opens, and it says nothing
  // about IndexedDB queueing the commit's transaction behind a real hold's,
  // which it does (the stores overlap; see `holdPendingTake`).
  it("does not await the hold: a hold promise that never settles does not hold the commit", async () => {
    const segmentId = await freshSegment();
    const take = heldTake(segmentId, newClipId());
    write.mockImplementationOnce(() => new Promise(() => {}));

    const outcome = await Promise.race([
      performSaveTake(take, {
        update: slot(take).update,
        requestSweep: vi.fn(),
      }),
      new Promise<"held">((resolve) => setTimeout(() => resolve("held"), 1000)),
    ]);

    expect(outcome).toBe(true);
    expect((await getSegment(segmentId))?.activeTakeId).not.toBeNull();
  });

  it('never fails the save: a failed hold is reported under "pending-take-write" and the take still lands', async () => {
    const segmentId = await freshSegment();
    const take = heldTake(segmentId, newClipId());
    const cause = new Error("pending write refused");
    write.mockResolvedValueOnce({ ok: false, cause });

    const ok = await performSaveTake(take, {
      update: slot(take).update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect((await getSegment(segmentId))?.activeTakeId).not.toBeNull();
    await vi.waitFor(() =>
      expect(reports).toEqual([
        expect.objectContaining({ context: "pending-take-write", cause }),
      ])
    );
  });

  it('reports a hold that found another take\'s row under "pending-take-write", and the take still lands', async () => {
    // `kept-foreign`: this take has no safety copy (the note, §3 step 5).
    const segmentId = await freshSegment();
    const other = heldTake(segmentId, newClipId());
    expect(await writePendingTake(other)).toEqual({
      ok: true,
      outcome: "written",
    });
    const take = heldTake(segmentId, newClipId());

    const ok = await performSaveTake(take, {
      update: slot(take).update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    await vi.waitFor(() =>
      expect(reports.map((r) => r.context)).toEqual(["pending-take-write"])
    );
    expect(await pendingClipIds()).toEqual([other.clipId]);
  });
});

describe("performSaveTake — the pending row after a quota failure", () => {
  /**
   * A save that runs out of room only after the hold has landed: the shape
   * where one copy of the take fits and two do not. fake-indexeddb has no
   * quota, so the failure is injected, after the hold has settled.
   */
  const quotaAfterWrite = () => {
    const cause = new DOMException("disk full", "QuotaExceededError");
    vi.mocked(saveTake).mockImplementationOnce(async () => {
      expect(await write.mock.results[0]?.value).toEqual({
        ok: true,
        outcome: "written",
      });
      throw cause;
    });
    return cause;
  };

  it("a take whose row was given up leaves no row and a given-up record, and the save's own failure is reported", async () => {
    // TP-L (PR 1): the documented limit, pinned. A kill now loses the take.
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);
    const s = slot(take);
    const cause = quotaAfterWrite();

    const ok = await performSaveTake(take, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(false);
    expect(s.held()).toMatchObject({ state: "failed", kind: "quota" });
    await vi.waitFor(async () =>
      expect(await recordOf(clipId)).toBe("given-up")
    );
    expect(settle).toHaveBeenCalledWith(segmentId, clipId, "give-up");
    expect(await pendingClipIds()).toEqual([]);
    expect(reports).toEqual([
      expect.objectContaining({ context: "save-take", cause }),
    ]);
  });

  it("does not write the row again on the Retry that follows, and that Retry saves", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);
    const s = slot(take);
    quotaAfterWrite();
    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });
    await vi.waitFor(async () =>
      expect(await recordOf(clipId)).toBe("given-up")
    );

    const retried = retrySave(s.held());
    expect(retried).toMatchObject({ state: "saving", clipId });
    s.update(() => retried);
    const ok = await performSaveTake(retried!, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(await write.mock.results[1]?.value).toEqual({
      ok: true,
      outcome: "given-up",
    });
    expect((await getSegment(segmentId))?.activeTakeId).not.toBeNull();
    expect(await pendingClipIds()).toEqual([]);
    expect(await recordOf(clipId)).toBe("saved");
  });

  it("keeps the row on any other failure, and the Retry keeps it until the save lands", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);
    const s = slot(take);
    vi.mocked(saveTake).mockImplementationOnce(async () => {
      await write.mock.results[0]?.value;
      throw new Error("a transient write failure");
    });
    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });
    expect(s.held()).toMatchObject({ state: "failed", kind: "unknown" });
    expect(await pendingClipIds()).toEqual([clipId]);
    expect(settle).not.toHaveBeenCalled();

    const retried = retrySave(s.held());
    s.update(() => retried);
    const ok = await performSaveTake(retried!, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(await write.mock.results[1]?.value).toEqual({
      ok: true,
      outcome: "kept",
    });
    expect(await pendingClipIds()).toEqual([]);
  });
});

describe("performSaveTake — another copy already ended the take (TP-R, George r3 High on the note)", () => {
  /**
   * A kept take K is active on S. This copy's edit C fails for quota and is
   * given up; another copy then ends C its own way; then this copy taps
   * Retry. The other copy is modelled by calling the store directly, which
   * is all a second connection does.
   */
  const keptThenGivenUp = async () => {
    const segmentId = await freshSegment();
    const kept = await recordTake(segmentId);
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);
    const s = slot(take);
    vi.mocked(saveTake).mockImplementationOnce(async () => {
      await write.mock.results[0]?.value;
      throw new DOMException("disk full", "QuotaExceededError");
    });
    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });
    await vi.waitFor(async () =>
      expect(await recordOf(clipId)).toBe("given-up")
    );
    const before = await getSegment(segmentId);
    return { segmentId, kept, clipId, s, before };
  };

  it("an ordinary Retry after another copy discarded a given-up take saves nothing and keeps K", async () => {
    const { segmentId, kept, clipId, s, before } = await keptThenGivenUp();
    // The other copy confirms Discard: given-up becomes discarded.
    expect(await settlePendingTake(segmentId, clipId, "discard")).toEqual({
      ok: true,
    });

    const retried = retrySave(s.held());
    s.update(() => retried);
    const ok = await performSaveTake(retried!, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(s.held()).toBeNull();
    const after = await getSegment(segmentId);
    expect(after?.activeTakeId).toBe(kept.id);
    expect(after?.audioRevision).toBe(before?.audioRevision);
    expect(await (await getDb()).count("takes")).toBe(1);
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(reports.map((r) => r.context)).toEqual([
      "save-take",
      "pending-take-refused",
    ]);
  });

  it("an ordinary Retry of a take another copy already saved writes nothing", async () => {
    const { segmentId, clipId, s } = await keptThenGivenUp();
    // The other copy saved C itself (its replay, in PR 3): one take, C's.
    await saveTake(segmentId, clipId, samples(10), 48_000);
    const saved = await getSegment(segmentId);

    const retried = retrySave(s.held());
    s.update(() => retried);
    const onSaved = vi.fn();
    const ok = await performSaveTake(retried!, {
      update: s.update,
      onSaved,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(s.held()).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(await getSegment(segmentId)).toEqual(saved);
    expect(await (await getDb()).count("takes")).toBe(1);
  });
});

describe("performDiscardTake — the pending row", () => {
  it("deletes the row and records discarded once the translator confirms", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);
    expect(await writePendingTake(take)).toEqual({
      ok: true,
      outcome: "written",
    });
    const s = slot(take);

    await performDiscardTake(s.held(), s.update);

    expect(s.held()).toBeNull();
    expect(settle).toHaveBeenCalledWith(segmentId, clipId, "discard");
    expect(await pendingClipIds()).toEqual([]);
    expect(await recordOf(clipId)).toBe("discarded");
  });

  it("settles nothing when nothing was held", async () => {
    const s = slot(null);

    await performDiscardTake(s.held(), s.update);

    expect(settle).not.toHaveBeenCalled();
  });

  it('reports a failed settle under "pending-take-delete"', async () => {
    const segmentId = await freshSegment();
    const take = heldTake(segmentId, newClipId());
    const cause = new Error("pending delete refused");
    settle.mockResolvedValueOnce({ ok: false, cause });
    const s = slot(take);

    await performDiscardTake(s.held(), s.update);

    expect(reports).toEqual([
      expect.objectContaining({ context: "pending-take-delete", cause }),
    ]);
  });
});

describe("a Discard against a hold in flight (TP-X)", () => {
  /**
   * A kept take K is active on S. An edit C is saved; its hold is stalled
   * behind a transaction on `segments`; the commit fails at once (injected);
   * Discard is confirmed; the stall is released. Then a launch: PR 1 has no
   * replay, so "the launch keeps K" is read off the disk a launch would find.
   */
  const stalledEdit = async () => {
    const segmentId = await freshSegment();
    const kept = await recordTake(segmentId);
    const revision = (await getSegment(segmentId))?.audioRevision;
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);
    const s = slot(take);
    const release = await stallSegments();
    vi.mocked(saveTake).mockImplementationOnce(async () => {
      throw new Error("injected commit failure");
    });
    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });
    expect(s.held()).toMatchObject({ state: "failed" });
    return { segmentId, kept, revision, clipId, s, release };
  };

  const expectNothingToReplay = async (
    segmentId: SegmentId,
    keptId: string,
    revision: number | undefined
  ) => {
    expect(await pendingClipIds()).toEqual([]);
    const segment = await getSegment(segmentId);
    expect(segment?.activeTakeId).toBe(keptId);
    expect(segment?.audioRevision).toBe(revision);
  };

  it("a Discard confirmed during a stalled hold leaves no row, and the launch keeps the kept take", async () => {
    // George r6 on #1546.
    const { segmentId, kept, revision, clipId, s, release } =
      await stalledEdit();

    const discarded = performDiscardTake(s.held(), s.update);
    await release();
    await discarded;

    expect(await write.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "discarded",
    });
    expect(await recordOf(clipId)).toBe("discarded");
    await expectNothingToReplay(segmentId, kept.id, revision);
  });

  it("a kill after the hold commits and before the Discard's settle leaves nothing to replay", async () => {
    // George r1's kill on the note: the settle never commits.
    const { segmentId, kept, revision, s, release } = await stalledEdit();
    settle.mockImplementationOnce(() => new Promise(() => {}));

    void performDiscardTake(s.held(), s.update);
    await release();
    expect(await write.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "discarded",
    });

    await expectNothingToReplay(segmentId, kept.id, revision);
  });

  it("a kill after a Discard confirmed between the hold's read and its commit leaves nothing to replay", async () => {
    // George r3's Medium on the note: the tap lands from a hook on the hold's
    // own put request, after step 2 has read no request.
    const segmentId = await freshSegment();
    const kept = await recordTake(segmentId);
    const revision = (await getSegment(segmentId))?.audioRevision;
    const take = heldTake(segmentId, newClipId());
    const s = slot(take);
    settle.mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(saveTake).mockImplementationOnce(async () => {
      throw new Error("injected commit failure");
    });
    const realPut = IDBObjectStore.prototype.put;
    let tapped = false;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = realPut.apply(this, args);
      if (this.name === "pendingTakes" && !tapped) {
        tapped = true;
        void performDiscardTake(s.held(), s.update);
      }
      return request;
    });

    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });

    // The hold is not awaited by the save; its own result is what to wait on.
    expect(await write.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "discarded",
    });
    expect(tapped).toBe(true);
    await expectNothingToReplay(segmentId, kept.id, revision);
  });
});
