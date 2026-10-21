import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through spies: a case replaces one call to make a save fail, and the
// rest count how often the save ran.
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return { ...actual, saveTake: vi.fn(actual.saveTake) };
});

import { recoverPendingTakes } from "@/hooks/recover-pending-takes";
import { performResumeTake } from "@/hooks/use-save-take";
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
  listPendingTakes,
  markPendingRefusal,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import { getDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import type { NewTake, PendingTake } from "@/lib/takes/pending-take";
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

const launch = () => {
  let held: PendingTake | null = null;
  const resume = vi.fn((take: NewTake) =>
    performResumeTake(held, take, {
      update: (t) => {
        held = t(held);
      },
      requestSweep: () => {},
    })
  );
  return { resume, held: () => held, run: () => recoverPendingTakes(resume) };
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
  const written = await writePendingTake(take, opts);
  if (!written.ok) throw written.cause;
};

const refused = (r: FailureReport[]) =>
  r.filter((x) => x.context === "pending-take-refused");

let reports: FailureReport[] = [];
let off: () => void = () => {};

beforeEach(async () => {
  await clearAllStores();
  vi.mocked(saveTake).mockClear();
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
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
  });

  it("shows the recovery screen when the save fails, keeps the row, and stops there", async () => {
    const first = await freshSegment();
    const second = await freshSegment();
    const a = newTake(first);
    const b = newTake(second);
    await writeRow(a, { now: 1 });
    await writeRow(b, { now: 2 });
    vi.mocked(saveTake).mockRejectedValueOnce(new Error("disk said no"));

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

    const result = await performResumeTake(slot, newTake(segmentId), {
      update: (t) => {
        slot = t(slot);
      },
      requestSweep: () => {},
    });

    expect(result).toBe("busy");
    expect(slot).toBe(held);
    expect(saveTake).not.toHaveBeenCalled();
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

    const result = await performResumeTake(null, newTake(segmentId), {
      update: (t) => {
        live = t(live);
      },
      requestSweep: () => {},
    });

    expect(result).toBe("busy");
    expect(live).toBe(occupant);
    expect(saveTake).not.toHaveBeenCalled();
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
