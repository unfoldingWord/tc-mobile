import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through spies: a case replaces one call to make a save fail, and the
// rest count how often the save ran.
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return {
    ...actual,
    saveTake: vi.fn(actual.saveTake),
    saveReplayedTake: vi.fn(actual.saveReplayedTake),
  };
});
// Pass-through, so a case can see the row exactly as the first put left it.
vi.mock("@/lib/storage/pending-takes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/storage/pending-takes")>();
  return { ...actual, writePendingTake: vi.fn(actual.writePendingTake) };
});
// Pass-through, so a case can stall the hook's read of the active take.
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return { ...actual, getSegment: vi.fn(actual.getSegment) };
});

import { recoverPendingTakes } from "@/hooks/recover-pending-takes";
import {
  performDiscardTake,
  performResumeTake,
  performSaveTake,
} from "@/hooks/use-save-take";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
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
  markPendingRefusal,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import { getDb } from "@/lib/storage/db";
import { saveReplayedTake, saveTake } from "@/lib/storage/takes";
import {
  retrySave,
  startSave,
  type NewTake,
  type PendingTake,
} from "@/lib/takes/pending-take";
import type { SegmentId, StoredPendingTake } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Slice 3 of #38: on launch, every `pendingTakes` row is read back and its
 * save finished quietly (the DRI's pick, "Finish the save quietly
 * (Recommended)"), through the same `performSaveTake` a Save runs.
 *
 * `resume` below is the hook's resume minus React: `performResumeTake` over a
 * plain slot, so a failed completion leaves the slot in the `failed` state
 * the recovery screen renders (`App`'s `recovery`: a held take with
 * `attempts > 0`).
 */

const samples = (length: number, value = 1000): Int16Array =>
  Int16Array.from({ length }, () => value);

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return segment.id;
};

const newTake = (segmentId: SegmentId): NewTake => ({
  segmentId,
  ordinal: 1,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: samples(10),
  offset: 0,
  finished: false,
  editOnly: false,
});

const launch = (
  // Runs before each resume: what another open copy does between the
  // replay's read of a row and its commit.
  between: () => Promise<void> = async () => {}
) => {
  let held: PendingTake | null = null;
  const effects = {
    update: (t: (h: PendingTake | null) => PendingTake | null) => {
      held = t(held);
    },
    requestSweep: () => {},
  };
  const resume = vi.fn(async (take: NewTake) => {
    await between();
    return performResumeTake(held, take, effects);
  });
  // The recovery screen's Retry, minus React: `retryPendingTake`'s two steps.
  const retry = () => {
    const next = retrySave(held);
    if (!next || next === held) throw new Error("Retry refused");
    held = next;
    return performSaveTake(next, effects);
  };
  return {
    resume,
    retry,
    held: () => held,
    run: () => recoverPendingTakes(resume),
  };
};

/** A row as a build from before `target` existed wrote it. */
const writeLegacyRow = async (take: NewTake): Promise<void> => {
  await writeRow(take);
  const db = await getDb();
  const row = await db.get("pendingTakes", take.segmentId);
  if (!row) throw new Error("no row");
  const legacy: StoredPendingTake = { ...row };
  delete (legacy as { target?: unknown }).target;
  await db.put("pendingTakes", legacy);
};

/** The clip id behind a segment's active take, or undefined. */
const activeClip = async (segmentId: SegmentId) => {
  const segment = await getSegment(segmentId);
  if (!segment?.activeTakeId) return undefined;
  return (await (await getDb()).get("takes", segment.activeTakeId))?.clipId;
};

const rows = async (): Promise<StoredPendingTake[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows;
};

const writeRow = async (
  take: NewTake,
  opts: { sampleRate?: number; now?: number } = {}
): Promise<void> => {
  // The target the hook records: the segment's active take as the save began.
  const target = (await getSegment(take.segmentId))?.activeTakeId ?? null;
  const written = await writePendingTake(take, { ...opts, target });
  if (!written.ok) throw written.cause;
};

const refused = (r: FailureReport[]) =>
  r.filter((x) => x.context === "pending-take-refused");

let reports: FailureReport[] = [];
let off: () => void = () => {};

beforeEach(async () => {
  await clearAllStores();
  vi.mocked(saveTake).mockClear();
  vi.mocked(saveReplayedTake).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reports = [];
  off = subscribeToFailures((r) => reports.push(r));
});

afterEach(() => {
  off();
  vi.restoreAllMocks();
});

describe("recoverPendingTakes — finishing the save on launch", () => {
  it("saves a pending row into its segment and deletes the row", async () => {
    const segmentId = await freshSegment();
    const take = newTake(segmentId);
    await writeRow(take);

    const app = launch();
    await app.run();

    const segment = await getSegment(segmentId);
    const active = segment?.activeTakeId
      ? await (await getDb()).get("takes", segment.activeTakeId)
      : undefined;
    expect(active?.clipId).toBe(take.clipId);
    expect(app.held()).toBeNull();
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
    expect(reports).toEqual([]);
  });

  it("deletes a row whose save already landed, without saving again", async () => {
    const segmentId = await freshSegment();
    const take = newTake(segmentId);
    await saveTake(
      segmentId,
      take.clipId,
      take.recorded,
      CANONICAL_SAMPLE_RATE
    );
    await writeRow(take);
    vi.mocked(saveTake).mockClear();

    const app = launch();
    await app.run();

    expect(app.resume).not.toHaveBeenCalled();
    expect(saveTake).not.toHaveBeenCalled();
    expect(saveReplayedTake).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
  });

  it("shows the recovery screen when the save fails, keeps the row, and stops there", async () => {
    const first = await freshSegment();
    const second = await freshSegment();
    const a = newTake(first);
    const b = newTake(second);
    await writeRow(a, { now: 1 });
    await writeRow(b, { now: 2 });
    vi.mocked(saveReplayedTake).mockRejectedValueOnce(
      new Error("disk said no")
    );

    const app = launch();
    await app.run();

    // The recovery screen's state: held, failed, one attempt.
    expect(app.held()?.clipId).toBe(a.clipId);
    expect(app.held()?.state).toBe("failed");
    expect(app.held()?.attempts).toBe(1);
    // One save at a time: the second row waits for the next launch.
    expect(app.resume).toHaveBeenCalledTimes(1);
    expect((await rows()).map((r) => r.clipId).sort()).toEqual(
      [a.clipId, b.clipId].sort()
    );
  });

  it("stops when the slot already holds a take", async () => {
    await writeRow(newTake(await freshSegment()), { now: 1 });
    await writeRow(newTake(await freshSegment()), { now: 2 });
    const resume = vi.fn(async () => "busy" as const);

    await recoverPendingTakes(resume);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(await rows()).toHaveLength(2);
  });

  it("never displaces a take the slot already holds", async () => {
    const segmentId = await freshSegment();
    const held = {
      ...newTake(segmentId),
      state: "saving",
      kind: null,
      attempts: 0,
    } as const;
    let slot: PendingTake | null = held;

    const result = await performResumeTake(
      slot,
      { ...newTake(segmentId), replayTarget: null },
      {
        update: (t) => {
          slot = t(slot);
        },
        requestSweep: () => {},
      }
    );

    expect(result).toBe("busy");
    expect(slot).toBe(held);
    expect(saveTake).not.toHaveBeenCalled();
    expect(saveReplayedTake).not.toHaveBeenCalled();
  });

  it("does not save when the live slot was filled after `held` was read", async () => {
    const segmentId = await freshSegment();
    const occupant = {
      ...newTake(segmentId),
      state: "failed",
      kind: "quota",
      attempts: 1,
    } as const;
    // The caller's snapshot says empty; the live slot already holds a take.
    let live: PendingTake | null = occupant;

    const result = await performResumeTake(
      null,
      { ...newTake(segmentId), replayTarget: null },
      {
        update: (t) => {
          live = t(live);
        },
        requestSweep: () => {},
      }
    );

    expect(result).toBe("busy");
    expect(live).toBe(occupant);
    expect(saveTake).not.toHaveBeenCalled();
    expect(saveReplayedTake).not.toHaveBeenCalled();
  });
});

describe("recoverPendingTakes — another copy saved first (Frank, PR #1546)", () => {
  it("keeps a newer take another copy saved between the read and the commit", async () => {
    const segmentId = await freshSegment();
    const replayed = newTake(segmentId);
    await writeRow(replayed);
    const newer = newClipId();

    // Another open copy saves a newer take on this segment after the replay
    // has read the row, before its commit. The replayed row is untouched.
    const app = launch(async () => {
      await saveTake(segmentId, newer, samples(20, 7), CANONICAL_SAMPLE_RATE);
    });
    await app.run();

    expect(await activeClip(segmentId)).toBe(newer);
    const db = await getDb();
    expect(await db.get("clipData", newer)).toBeDefined();
    expect(await db.get("clipData", replayed.clipId)).toBeUndefined();
    // The overtaken audio is kept, refused, and on record once.
    expect((await rows()).map((r) => r.refusalReported)).toEqual([
      "superseded",
    ]);
    expect(refused(reports)).toHaveLength(1);
    expect(app.held()).toBeNull();
  });

  it("keeps a newer recording when another copy completes the row and replaces it", async () => {
    const first = await freshSegment();
    const second = await freshSegment();
    const a = newTake(first);
    const b = newTake(second);
    await writeRow(a, { now: 1 });
    await writeRow(b, { now: 2 });
    const newer = newClipId();
    let done = false;

    // While the replay is on row A, another copy finishes B's save, removes
    // its row, and then saves a newer recording over B. The replay's row
    // list was read before all of that.
    const app = launch(async () => {
      if (done) return;
      done = true;
      await saveTake(second, b.clipId, b.recorded, CANONICAL_SAMPLE_RATE);
      await deletePendingTake(second, b.clipId);
      await saveTake(second, newer, samples(20, 7), CANONICAL_SAMPLE_RATE);
    });
    await app.run();

    expect(await activeClip(first)).toBe(a.clipId);
    expect(await activeClip(second)).toBe(newer);
    const db = await getDb();
    expect(await db.get("clipData", newer)).toBeDefined();
    // B's audio is kept as a refused row, never saved over the newer take.
    const kept = await rows();
    expect(kept.map((r) => [r.clipId, r.refusalReported])).toEqual([
      [b.clipId, "superseded"],
    ]);
  });

  it("refuses an old row beside a newer take saved before launch, and says so once", async () => {
    const segmentId = await freshSegment();
    const old = newTake(segmentId);
    await writeRow(old);
    // The old row's delete was lost, and a later save landed without a row.
    const newer = newClipId();
    await saveTake(segmentId, newer, samples(20, 7), CANONICAL_SAMPLE_RATE);
    vi.mocked(saveTake).mockClear();

    await launch().run();
    await launch().run();

    expect(await activeClip(segmentId)).toBe(newer);
    expect(await (await getDb()).get("clipData", newer)).toBeDefined();
    expect((await rows()).map((r) => [r.clipId, r.refusalReported])).toEqual([
      [old.clipId, "superseded"],
    ]);
    expect(refused(reports)).toHaveLength(1);
    expect(saveTake).not.toHaveBeenCalled();
  });

  it("keeps the precondition on Retry: a newer save after a failed replay survives", async () => {
    const segmentId = await freshSegment();
    const replayed = newTake(segmentId);
    await writeRow(replayed);
    vi.mocked(saveReplayedTake).mockRejectedValueOnce(
      new Error("disk said no")
    );
    const app = launch();
    await app.run();
    expect(app.held()?.state).toBe("failed");

    const newer = newClipId();
    await saveTake(segmentId, newer, samples(20, 7), CANONICAL_SAMPLE_RATE);
    vi.mocked(saveTake).mockClear();
    expect(await app.retry()).toBe("stale");

    expect(await activeClip(segmentId)).toBe(newer);
    expect(saveTake).not.toHaveBeenCalled();
    expect((await rows()).map((r) => [r.clipId, r.refusalReported])).toEqual([
      [replayed.clipId, "superseded"],
    ]);
    expect(refused(reports)).toHaveLength(1);
    expect(app.held()).toBeNull();
  });

  it("keeps the audio when Retry after a quota failure finds a newer save", async () => {
    const segmentId = await freshSegment();
    const replayed = newTake(segmentId);
    await writeRow(replayed);
    vi.mocked(saveReplayedTake).mockRejectedValueOnce(
      new DOMException("disk full", "QuotaExceededError")
    );
    const app = launch();
    await app.run();
    expect(app.held()?.kind).toBe("quota");
    // The quota rule gives the row up.
    await vi.waitFor(async () => expect(await rows()).toEqual([]));

    const newer = newClipId();
    await saveTake(segmentId, newer, samples(20, 7), CANONICAL_SAMPLE_RATE);
    expect(await app.retry()).toBe("stale");

    expect(await activeClip(segmentId)).toBe(newer);
    const kept = await rows();
    expect(kept.map((r) => [r.clipId, r.refusalReported])).toEqual([
      [replayed.clipId, "superseded"],
    ]);
    // The whole take's audio, as one inline buffer.
    const base = kept[0]?.base;
    expect(base?.kind === "inline" && new Int16Array(base.samples)).toEqual(
      replayed.recorded
    );
    expect(refused(reports)).toHaveLength(1);
    expect(app.held()).toBeNull();
  });
});

describe("recoverPendingTakes — two copies, one row (Frank, PR #1546 r4)", () => {
  it("a Discard in one copy never deletes the clip another copy's replay saved", async () => {
    const segmentId = await freshSegment();
    const take = newTake(segmentId);
    await writeRow(take);

    // Copy A's replay fails (not quota): the take is held, the row kept.
    vi.mocked(saveReplayedTake).mockRejectedValueOnce(
      new Error("disk said no")
    );
    const a = launch();
    await a.run();
    expect(a.held()?.state).toBe("failed");

    // Copy B opens and finishes the same row: the same clip is now active.
    await launch().run();
    expect(await activeClip(segmentId)).toBe(take.clipId);

    // Copy A's translator confirms Discard.
    let slot = a.held();
    await performDiscardTake(slot, (t) => {
      slot = t(slot);
    });

    expect(slot).toBeNull();
    expect(await activeClip(segmentId)).toBe(take.clipId);
    const db = await getDb();
    expect(await db.get("clipMeta", take.clipId)).toBeDefined();
    expect(await db.get("clipData", take.clipId)).toBeDefined();
  });
});

describe("recoverPendingTakes — a row the save hook wrote", () => {
  it("records the take the save replaces, so the next launch can finish it", async () => {
    const segmentId = await freshSegment();
    const take = startSave(null, newTake(segmentId));
    // The app is killed mid-save: here, the save fails and nothing retries.
    vi.mocked(saveTake).mockRejectedValueOnce(new Error("killed"));
    let held: PendingTake | null = take;
    await performSaveTake(take, {
      update: (t) => {
        held = t(held);
      },
      requestSweep: () => {},
    });
    // A first take: the save replaces nothing, and the row says so.
    await vi.waitFor(async () =>
      expect((await rows()).map((r) => r.target)).toEqual([null])
    );

    await launch().run();

    expect(await activeClip(segmentId)).toBe(take.clipId);
    expect(refused(reports)).toEqual([]);
  });

  it("puts the target in the row's first write, so a row a kill leaves can still be finished", async () => {
    // Every value put into `pendingTakes`: a kill can land after any of them,
    // so each one must be a row the replay will finish.
    const puts: unknown[] = [];
    const put = IDBObjectStore.prototype.put;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.name === "pendingTakes") puts.push(value);
        return put.call(this, value, key);
      });
    const segmentId = await freshSegment();
    const take = startSave(null, newTake(segmentId));
    vi.mocked(saveTake).mockRejectedValueOnce(new Error("killed"));
    let held: PendingTake | null = take;
    await performSaveTake(take, {
      update: (t) => {
        held = t(held);
      },
      requestSweep: () => {},
    });
    await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
    spy.mockRestore();

    expect(puts.length).toBeGreaterThan(0);
    for (const value of puts) expect(value).toMatchObject({ target: null });

    await launch().run();

    expect(await activeClip(segmentId)).toBe(take.clipId);
    expect(refused(reports)).toEqual([]);
  });
});

describe("recoverPendingTakes — killed right after the first put (George r5)", () => {
  it("finishes a take whose row is only the first put", async () => {
    const segmentId = await freshSegment();
    const take = startSave(null, newTake(segmentId));
    const real = await vi.importActual<
      typeof import("@/lib/storage/pending-takes")
    >("@/lib/storage/pending-takes");
    // The row as the first put leaves it: what a kill right after it finds.
    let firstPut: StoredPendingTake | undefined;
    vi.mocked(writePendingTake).mockImplementationOnce(async (...args) => {
      const result = await real.writePendingTake(...args);
      firstPut = (await rows())[0];
      return result;
    });
    vi.mocked(saveTake).mockRejectedValueOnce(new Error("killed"));
    await performSaveTake(take, { update: () => {}, requestSweep: () => {} });
    // Whatever the hook writes after the first put has landed by now.
    await vi.waitFor(async () =>
      expect((await rows())[0]?.target).not.toBeUndefined()
    );
    const db = await getDb();
    await db.clear("pendingTakes");
    await db.put("pendingTakes", firstPut!);

    await launch().run();

    expect(await activeClip(segmentId)).toBe(take.clipId);
    expect(refused(reports)).toEqual([]);
  });
});

describe("recoverPendingTakes — a Discard while the target read is slow (George r6)", () => {
  it("a delete that lands before the row's put still wins", async () => {
    const segmentId = await freshSegment();
    // The recording the translator keeps.
    const keptClip = newClipId();
    await saveTake(segmentId, keptClip, samples(10), CANONICAL_SAMPLE_RATE, {
      finished: false,
    });
    vi.mocked(saveTake).mockClear();
    const real = await vi.importActual<typeof import("@/lib/storage/books")>(
      "@/lib/storage/books"
    );
    // The hook's read of the active take stalls (another transaction holds
    // `segments`), so the row's put has not opened yet.
    let release!: () => void;
    const stalled = new Promise<void>((r) => (release = r));
    vi.mocked(getSegment).mockImplementationOnce(async (id) => {
      await stalled;
      return real.getSegment(id);
    });
    // The edit fails before its own transaction opens (a merge that cannot
    // allocate), so the recovery screen shows while the read is still stalled.
    vi.mocked(saveTake).mockRejectedValueOnce(new Error("out of memory"));
    const take = startSave(null, newTake(segmentId));
    let held: PendingTake | null = take;
    const update = (t: (h: PendingTake | null) => PendingTake | null) => {
      held = t(held);
    };
    expect(await performSaveTake(take, { update, requestSweep: () => {} })).toBe(
      false
    );

    // The translator confirms Discard; then the read lands.
    await performDiscardTake(held, update);
    expect(held).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    release();
    await vi.mocked(writePendingTake).mock.results.at(-1)!.value;

    await vi.waitFor(async () => expect(await rows()).toEqual([]));
    await launch().run();
    expect(await activeClip(segmentId)).toBe(keptClip);
  });
});

describe("recoverPendingTakes — rows it cannot save", () => {
  it("deletes a row whose segment is gone and reports it once", async () => {
    const take = newTake("seg-gone" as SegmentId);
    await writeRow(take);

    const app = launch();
    await app.run();
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
    await app.run();

    expect(app.resume).not.toHaveBeenCalled();
    expect(refused(reports)).toHaveLength(1);
  });

  it("keeps a row written at another sample rate, and reports it on one launch only", async () => {
    const segmentId = await freshSegment();
    const take = newTake(segmentId);
    await writeRow(take, { sampleRate: CANONICAL_SAMPLE_RATE / 2 });

    await launch().run();
    await launch().run();

    expect(refused(reports)).toHaveLength(1);
    const kept = await rows();
    expect(kept.map((r) => r.clipId)).toEqual([take.clipId]);
    expect(kept[0]?.refusalReported).toBe("sample-rate");
    expect(saveTake).not.toHaveBeenCalled();
    expect(saveReplayedTake).not.toHaveBeenCalled();
  });

  it("keeps a row written before rows carried a target, and reports it on one launch only", async () => {
    const segmentId = await freshSegment();
    const take = newTake(segmentId);
    await writeLegacyRow(take);

    await launch().run();
    await launch().run();

    expect(refused(reports)).toHaveLength(1);
    const kept = await rows();
    expect(kept.map((r) => [r.clipId, r.refusalReported])).toEqual([
      [take.clipId, "no-target"],
    ]);
    expect(saveReplayedTake).not.toHaveBeenCalled();
  });

  it("goes on to the next row after a refused one", async () => {
    const segmentId = await freshSegment();
    const gone = newTake("seg-gone" as SegmentId);
    const take = newTake(segmentId);
    await writeRow(gone, { now: 1 });
    await writeRow(take, { now: 2 });

    const app = launch();
    await app.run();

    expect(app.resume).toHaveBeenCalledTimes(1);
    const segment = await getSegment(segmentId);
    expect(segment?.activeTakeId).toBeTruthy();
  });
});

describe("markPendingRefusal", () => {
  it("marks only the row of the take it names", async () => {
    const segmentId = await freshSegment();
    const take = newTake(segmentId);
    await writeRow(take);

    const other = await markPendingRefusal(
      segmentId,
      newClipId(),
      "sample-rate"
    );
    expect(other).toEqual({ ok: true, outcome: "kept" });
    expect((await rows())[0]?.refusalReported).toBeUndefined();

    const own = await markPendingRefusal(segmentId, take.clipId, "sample-rate");
    expect(own).toEqual({ ok: true, outcome: "written" });
    expect((await rows())[0]?.refusalReported).toBe("sample-rate");
  });
});
