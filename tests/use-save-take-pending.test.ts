import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both stores pass through to the real modules unless a case replaces one
// call: that is how a never-settling write, or a failed write or delete, is
// produced without a quota to exhaust in fake-indexeddb.
vi.mock("@/lib/storage/pending-takes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/storage/pending-takes")>();
  return {
    ...actual,
    writePendingTake: vi.fn(actual.writePendingTake),
    deletePendingTake: vi.fn(actual.deletePendingTake),
  };
});
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return { ...actual, saveTake: vi.fn(actual.saveTake) };
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
import { newClipId } from "@/lib/storage/clips";
import {
  deletePendingTake,
  listPendingTakes,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import { saveTake } from "@/lib/storage/takes";
import {
  retrySave,
  startSave,
  type PendingTake,
} from "@/lib/takes/pending-take";
import type { ClipId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Slice 2 of #38: the save orchestration writes the held take down to
 * `pendingTakes` before the commit, and removes it once the save lands or the
 * translator confirms a discard.
 *
 * Covered through `performSaveTake` and `performDiscardTake`, the whole of the
 * two operations minus React (see `tests/use-save-take.test.ts` for why the
 * hook itself is not mounted). The write and the delete are fire-and-forget,
 * so these cases wait for the spy's call or the store's state, never on the
 * operation's own promise.
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

/** The segment ids `pendingTakes` holds rows for, by clip. */
const pendingClipIds = async (): Promise<ClipId[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows.map((r) => r.clipId);
};

const write = vi.mocked(writePendingTake);
const remove = vi.mocked(deletePendingTake);

let reports: FailureReport[] = [];
let off: () => void = () => {};

beforeEach(async () => {
  await clearAllStores();
  // Back to the pass-through, dropping any one-off implementation a previous
  // case queued but never reached.
  write.mockReset();
  remove.mockReset();
  vi.mocked(saveTake).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reports = [];
  off = subscribeToFailures((r) => reports.push(r));
});

afterEach(() => {
  off();
  vi.restoreAllMocks();
});

describe("performSaveTake — the pending row", () => {
  it("is written before the commit starts, and deleted once the save lands", async () => {
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
    // "deleted", not "absent": the row was there, and this removed it.
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(segmentId, clipId);
    expect(await remove.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "deleted",
    });
    expect(await pendingClipIds()).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("stays in place when the save fails, so a relaunch can still find it", async () => {
    // A segment id with no row: `saveTake` throws "No such segment: …".
    const segmentId = newClipId() as unknown as SegmentId;
    const clipId = newClipId();
    const take = heldTake(segmentId, clipId);

    const ok = await performSaveTake(take, {
      update: slot(take).update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(false);
    await vi.waitFor(async () =>
      expect(await pendingClipIds()).toEqual([clipId])
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("never delays the save: a write that has not settled does not hold the commit", async () => {
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

  it('never fails the save: a failed write is reported under "pending-take-write" and the take still lands', async () => {
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
      expect(reports.map((r) => r.context)).toContain("pending-take-write")
    );
    expect(reports).toEqual([
      expect.objectContaining({ context: "pending-take-write", cause }),
    ]);
  });

  it('reports a failed delete after the save under "pending-take-delete"', async () => {
    const segmentId = await freshSegment();
    const take = heldTake(segmentId, newClipId());
    const cause = new Error("pending delete refused");
    remove.mockResolvedValueOnce({ ok: false, cause });

    const ok = await performSaveTake(take, {
      update: slot(take).update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    await vi.waitFor(() =>
      expect(reports).toEqual([
        expect.objectContaining({ context: "pending-take-delete", cause }),
      ])
    );
  });
});

describe("performSaveTake — the pending row after a quota failure", () => {
  /**
   * A save that runs out of room only after the pending row has landed: the
   * shape where one copy of the take fits and two do not. fake-indexeddb has
   * no quota, so the failure is injected, after the write has settled.
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

  it("gives the row up, so the real save gets the space, and still reports the save's own quota failure", async () => {
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
    await vi.waitFor(() =>
      expect(remove).toHaveBeenCalledWith(segmentId, clipId)
    );
    expect(await remove.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "deleted",
    });
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
    await vi.waitFor(async () => expect(await pendingClipIds()).toEqual([]));

    const retried = retrySave(s.held());
    expect(retried).toMatchObject({ state: "saving", clipId });
    s.update(() => retried);
    const ok = await performSaveTake(retried!, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await getSegment(segmentId))?.activeTakeId).not.toBeNull();
    expect(await pendingClipIds()).toEqual([]);
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
    expect(remove).not.toHaveBeenCalled();

    const retried = retrySave(s.held());
    s.update(() => retried);
    const ok = await performSaveTake(retried!, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(await write.mock.results[1]?.value).toEqual({
      ok: true,
      outcome: "kept",
    });
    await vi.waitFor(async () => expect(await pendingClipIds()).toEqual([]));
  });
});

describe("performDiscardTake — the pending row", () => {
  it("is deleted once the translator confirms the discard", async () => {
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
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(segmentId, clipId);
    expect(await remove.mock.results[0]?.value).toEqual({
      ok: true,
      outcome: "deleted",
    });
    expect(await pendingClipIds()).toEqual([]);
  });

  it("deletes no row when nothing was held", async () => {
    const s = slot(null);

    await performDiscardTake(s.held(), s.update);

    expect(remove).not.toHaveBeenCalled();
  });

  it('reports a failed delete under "pending-take-delete"', async () => {
    const segmentId = await freshSegment();
    const take = heldTake(segmentId, newClipId());
    const cause = new Error("pending delete refused");
    remove.mockResolvedValueOnce({ ok: false, cause });
    const s = slot(take);

    await performDiscardTake(s.held(), s.update);

    await vi.waitFor(() =>
      expect(reports).toEqual([
        expect.objectContaining({ context: "pending-take-delete", cause }),
      ])
    );
  });
});
