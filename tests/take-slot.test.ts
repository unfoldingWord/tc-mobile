import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Passes through to the real store unless a case holds a commit back or makes
// one fail, which is how the replay's quiet first attempt is kept in flight
// while a recording arrives.
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return {
    ...actual,
    saveTake: vi.fn(actual.saveTake),
    saveReplayedTake: vi.fn(actual.saveReplayedTake),
  };
});

import { replayPendingTakes } from "@/hooks/replay-pending-takes";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { createTakeSlot } from "@/hooks/use-save-take";
import {
  addChapter,
  addSegment,
  createBook,
  getSegment,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { writePendingTake } from "@/lib/storage/pending-takes";
import { saveReplayedTake, saveTake } from "@/lib/storage/takes";
import type { NewTake, PendingTake } from "@/lib/takes/pending-take";
import type { ClipId, SegmentId } from "@/types/domain";
import { clearAllStores, ramp } from "./support";

/**
 * #1549: a recording finished while the launch replay holds the one slot.
 *
 * Before this, `saveRecording` found the slot held, returned false and logged
 * only to the console, and the recorder exited: the recording was gone and the
 * failure log had no row. The slot now keeps it waiting and saves it once the
 * slot is free. These cases run the slot the hook mounts (`createTakeSlot`)
 * against fake-indexeddb through the real store, with the replay started the
 * way `useSaveTake`'s mount effect starts it.
 */

type ReplayTake = NewTake & { readonly baseRevision: number };

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

const firstTake = (segmentId: SegmentId): ReplayTake => ({
  segmentId,
  ordinal: 3,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: ramp(40),
  offset: 0,
  finished: false,
  editOnly: false,
  baseRevision: 0,
});

const activeClip = async (segmentId: SegmentId): Promise<ClipId | null> => {
  const segment = await getSegment(segmentId);
  if (!segment?.activeTakeId) return null;
  return (await (await getDb()).get("takes", segment.activeTakeId))!.clipId;
};

/** A promise and the call that releases it. */
const gate = () => {
  let open: () => void = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { shut, open };
};

/** Whether `p` has settled, after every queued microtask has run. */
const settled = async (p: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void p.then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

/** The slot the hook mounts, with React's `setPending` and the effects counted. */
const mount = (onPublish?: (held: PendingTake | null) => void) => {
  const published: (PendingTake | null)[] = [];
  const calls = { saved: 0, sweep: 0 };
  const slot = createTakeSlot(
    (held) => {
      published.push(held);
      onPublish?.(held);
    },
    {
      onSaved: () => {
        calls.saved += 1;
      },
      requestSweep: () => {
        calls.sweep += 1;
      },
    }
  );
  return {
    slot,
    published,
    calls,
    /** The launch replay, as `useSaveTake`'s mount effect starts it. */
    launch: () => replayPendingTakes((take) => slot.resume(take)),
  };
};

/**
 * A replay row on its own segment, whose conditional commit waits on the
 * returned gate (and then fails, when `fail` is set). Resolves once the
 * replay has installed it in the slot.
 */
const replayHeldOpen = async (app: ReturnType<typeof mount>, fail = false) => {
  const segmentId = await freshSegment();
  const c = firstTake(segmentId);
  expect(await writePendingTake(c)).toEqual({ ok: true, outcome: "written" });
  const commit = gate();
  const actual = vi.mocked(saveReplayedTake).getMockImplementation()!;
  vi.mocked(saveReplayedTake).mockImplementationOnce(async (...args) => {
    await commit.shut;
    if (fail) throw new Error("the replayed commit failed");
    return actual(...args);
  });
  const run = app.launch();
  await vi.waitFor(() => expect(app.slot.held()?.clipId).toBe(c.clipId));
  return { c, segmentId, commit, run };
};

let reports: FailureReport[] = [];
let off: () => void = () => {};

beforeEach(async () => {
  // A held-back commit a timed-out case never released must not leak into
  // the next case: every case starts on the real store.
  const actual = await vi.importActual<typeof import("@/lib/storage/takes")>(
    "@/lib/storage/takes"
  );
  vi.mocked(saveTake).mockReset().mockImplementation(actual.saveTake);
  vi.mocked(saveReplayedTake)
    .mockReset()
    .mockImplementation(actual.saveReplayedTake);
  await clearAllStores();
  reports = [];
  off = subscribeToFailures((r) => reports.push(r));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  off();
  vi.restoreAllMocks();
});

describe("a recording finished while the replay holds the slot (#1549)", () => {
  it("is not dropped: it waits while the replay's first attempt is in flight, then is saved once the slot frees", async () => {
    const app = mount();
    const replay = await replayHeldOpen(app);
    const mine = firstTake(await freshSegment());

    const saved = app.slot.save(mine);

    // Waiting, not refused: the promise is still open, the replay's take
    // keeps the slot, and nothing is on disk for the recording yet.
    expect(await settled(saved)).toBe(false);
    expect(app.slot.held()?.clipId).toBe(replay.c.clipId);
    expect(await activeClip(mine.segmentId)).toBeNull();

    replay.commit.open();

    expect(await saved).toBe(true);
    await replay.run;
    expect(await activeClip(replay.segmentId)).toBe(replay.c.clipId);
    expect(await activeClip(mine.segmentId)).toBe(mine.clipId);
    expect(app.slot.held()).toBeNull();
    expect(app.calls.saved).toBe(2);
    expect(reports).toEqual([]);
    // React was handed the hand-over too, not only the slot.
    expect(app.published.some((h) => h?.clipId === mine.clipId)).toBe(true);
    expect(app.published.at(-1)).toBeNull();
  });

  it("keeps the guard set across the hand-over: the waiting take's commit runs as the only attempt", async () => {
    const app = mount();
    const replay = await replayHeldOpen(app);
    const mine = firstTake(await freshSegment());
    const second = gate();
    const actual = vi.mocked(saveTake).getMockImplementation()!;
    vi.mocked(saveTake).mockImplementationOnce(async (...args) => {
      await second.shut;
      return actual(...args);
    });

    const saved = app.slot.save(mine);
    replay.commit.open();
    await replay.run;

    // The replay's attempt has ended; the recording's is in flight.
    await vi.waitFor(() => expect(saveTake).toHaveBeenCalled());
    expect(app.slot.held()?.clipId).toBe(mine.clipId);
    expect(app.slot.saving()).toBe(true);

    second.open();
    expect(await saved).toBe(true);
    expect(app.slot.saving()).toBe(false);
  });

  it("when the replay's attempt fails, the recorder is let go (false), the recording waits, and a Discard of the replayed take lets it save", async () => {
    const app = mount();
    const replay = await replayHeldOpen(app, true);
    const mine = firstTake(await freshSegment());

    const saved = app.slot.save(mine);
    replay.commit.open();

    // The recovery screen now owns the body for the replayed take, so the
    // sheet is told to exit. The recording is not on disk and not lost.
    expect(await saved).toBe(false);
    await replay.run;
    expect(app.slot.held()).toMatchObject({
      clipId: replay.c.clipId,
      state: "failed",
      attempts: 1,
    });
    expect(await activeClip(mine.segmentId)).toBeNull();

    app.slot.discard();

    await vi.waitFor(async () =>
      expect(await activeClip(mine.segmentId)).toBe(mine.clipId)
    );
    await vi.waitFor(() => expect(app.slot.held()).toBeNull());
    expect(await activeClip(replay.segmentId)).toBeNull();
  });

  it("when the replay's attempt fails, a Retry that lands lets the waiting recording save after it", async () => {
    const app = mount();
    const replay = await replayHeldOpen(app, true);
    const mine = firstTake(await freshSegment());

    const saved = app.slot.save(mine);
    replay.commit.open();
    expect(await saved).toBe(false);
    await replay.run;

    app.slot.retry();

    await vi.waitFor(async () =>
      expect(await activeClip(mine.segmentId)).toBe(mine.clipId)
    );
    expect(await activeClip(replay.segmentId)).toBe(replay.c.clipId);
    await vi.waitFor(() => expect(app.slot.held()).toBeNull());
  });

  it("a waiting recording whose own save fails is held for the recovery screen, never dropped", async () => {
    const app = mount();
    const replay = await replayHeldOpen(app);
    const mine = firstTake(await freshSegment());
    vi.mocked(saveTake).mockImplementationOnce(() =>
      Promise.reject(new Error("the recording's commit failed"))
    );

    const saved = app.slot.save(mine);
    replay.commit.open();

    expect(await saved).toBe(false);
    expect(app.slot.held()).toMatchObject({
      clipId: mine.clipId,
      state: "failed",
      attempts: 1,
    });
    expect(reports.map((r) => r.context)).toEqual(["save-take"]);
  });
});

describe("the guard across a hand-over", () => {
  it("a recording handed over after a commit lands but before its guard is released waits for the guard", async () => {
    const app = mount();
    const first = firstTake(await freshSegment());
    const mine = firstTake(await freshSegment());
    const second = gate();
    let inner: Promise<boolean> | null = null;
    // `onSaved` fires inside the first attempt, after its slot write: the
    // slot is empty and the guard still set.
    app.slot.setOnSaved(() => {
      if (inner) return;
      const actual = vi.mocked(saveTake).getMockImplementation()!;
      vi.mocked(saveTake).mockImplementationOnce(async (...args) => {
        await second.shut;
        return actual(...args);
      });
      inner = app.slot.save(mine);
    });

    expect(await app.slot.save(first)).toBe(true);

    // The first attempt has ended; the second is the one in flight, and
    // the guard says so.
    expect(app.slot.held()?.clipId).toBe(mine.clipId);
    expect(app.slot.saving()).toBe(true);
    second.open();
    expect(await inner).toBe(true);
    expect(app.slot.saving()).toBe(false);
    expect(await activeClip(mine.segmentId)).toBe(mine.clipId);
  });
});

describe("the live guards, read in the same turn as a slot write", () => {
  it("a Retry tapped as a failure is shown, before its attempt has ended, starts no second attempt", async () => {
    let slot: ReturnType<typeof mount>["slot"] | null = null;
    const app = mount((held) => {
      if (held?.state === "failed") slot?.retry();
    });
    slot = app.slot;
    const mine = firstTake(await freshSegment());
    vi.mocked(saveTake).mockImplementationOnce(() =>
      Promise.reject(new Error("the commit failed"))
    );

    expect(await app.slot.save(mine)).toBe(false);

    expect(saveTake).toHaveBeenCalledTimes(1);
    expect(app.slot.held()).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("a Discard tapped as a failure is shown, before its attempt has ended, is ignored", async () => {
    let slot: ReturnType<typeof mount>["slot"] | null = null;
    const app = mount((held) => {
      if (held?.state === "failed") slot?.discard();
    });
    slot = app.slot;
    const mine = firstTake(await freshSegment());
    vi.mocked(saveTake).mockImplementationOnce(() =>
      Promise.reject(new Error("the commit failed"))
    );

    expect(await app.slot.save(mine)).toBe(false);

    expect(app.slot.held()).toMatchObject({
      clipId: mine.clipId,
      state: "failed",
    });
  });

  it("a replay row offered while a save is in flight is refused and leaves the guard set", async () => {
    const app = mount();
    const mine = firstTake(await freshSegment());
    const held = gate();
    const actual = vi.mocked(saveTake).getMockImplementation()!;
    vi.mocked(saveTake).mockImplementationOnce(async (...args) => {
      await held.shut;
      return actual(...args);
    });
    const saved = app.slot.save(mine);

    expect(await app.slot.resume(firstTake(await freshSegment()))).toBe(false);
    expect(app.slot.saving()).toBe(true);

    held.open();
    expect(await saved).toBe(true);
  });
});

describe("a free slot, as before", () => {
  it("saves at once and resolves true", async () => {
    const app = mount();
    const mine = firstTake(await freshSegment());

    expect(await app.slot.save(mine)).toBe(true);
    expect(await activeClip(mine.segmentId)).toBe(mine.clipId);
    expect(app.slot.held()).toBeNull();
    expect(app.slot.saving()).toBe(false);
  });

  it("a held take's own failure still reaches the recovery screen with its samples", async () => {
    const app = mount();
    const mine = firstTake(await freshSegment());
    vi.mocked(saveTake).mockImplementationOnce(() =>
      Promise.reject(new Error("quota-free failure"))
    );

    expect(await app.slot.save(mine)).toBe(false);
    expect(app.slot.held()).toMatchObject({
      clipId: mine.clipId,
      recorded: mine.recorded,
      state: "failed",
    });
  });
});
