import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// `clearSegmentTake` passes through to the real store unless a case below
// replaces one call, which is how a clear failure OTHER than a missing segment
// is produced: fake-indexeddb has no quota to exhaust.
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return { ...actual, clearSegmentTake: vi.fn(actual.clearSegmentTake) };
});

import {
  performClearEditedSegment,
  performDiscardTake,
  performSaveTake,
} from "@/hooks/use-save-take";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  addChapter,
  addSegment,
  clearSegmentTake,
  createBook,
  getSegment,
} from "@/lib/storage/books";
import { getClip, getClipMeta, newClipId, putClip } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { startSave, type PendingTake } from "@/lib/takes/pending-take";
import type { ClipId, SegmentId } from "@/types/domain";

/**
 * The save orchestration — the wiring between the pure transitions and the store.
 *
 * `tests/pending-take.test.ts` covers pure transitions. These tests cover
 * store orchestration, including keeping the held recording on a failed save.
 *
 * What is covered: `performSaveTake` and `performDiscardTake`, which are the
 * whole of the two operations minus React, against fake-indexeddb through the
 * real store helpers. Same split as `performErase` in `use-erase-segment.ts`.
 *
 * These tests do not mount the hook or exercise its `useState` slot,
 * `savingRef` double-tap guard or `onSaved` latest-ref. The static render
 * harness does not run hook effects or interactions.
 * The transcode sweep is injected here rather
 * than run: it starts the MP3 encoder in a Web Worker, which does not exist in
 * Node — so what these tests assert about it is whether it is ASKED for, which
 * is the decision (D3: only a Finished commit, only after it lands).
 *
 */

const samples = (length: number, value = 1000): Int16Array =>
  Int16Array.from({ length }, () => value);

/** A book → chapter → one never-recorded segment. */
const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return segment.id;
};

/**
 * The held slot, as the hook's `setPending` behaves: an updater applied to
 * whatever is currently held. A plain variable, because what these tests need
 * from React is exactly this and nothing else.
 */
const slot = (initial: PendingTake | null = null) => {
  let held = initial;
  return {
    held: () => held,
    update: (transition: (h: PendingTake | null) => PendingTake | null) => {
      held = transition(held);
    },
  };
};

/** A `saving` take over the given recipe, exactly as `saveRecording` opens one. */
const heldTake = (over: {
  segmentId: SegmentId;
  clipId: ClipId;
  existing?: Int16Array;
  recorded?: Int16Array;
  offset?: number;
  finished?: boolean;
  editOnly?: boolean;
}): PendingTake =>
  startSave(null, {
    segmentId: over.segmentId,
    ordinal: null,
    clipId: over.clipId,
    existing: over.existing ?? new Int16Array(0),
    recorded: over.recorded ?? samples(10),
    offset: over.offset ?? 0,
    finished: over.finished ?? false,
    editOnly: over.editOnly ?? false,
  });

beforeEach(async () => {
  // Clear every store rather than deleting the database: `deleteDatabase`
  // blocks while any connection is open, so clearing is the deterministic reset
  // (AGENTS.md, mirrored from tests/storage.test.ts).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("performSaveTake — a commit that lands", () => {
  it("writes the take, empties the slot, reloads, and reports success", async () => {
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake({ segmentId, clipId });
    const s = slot(take);
    const onSaved = vi.fn();
    const requestSweep = vi.fn();

    const ok = await performSaveTake(take, {
      update: s.update,
      onSaved,
      requestSweep,
    });

    expect(ok).toBe(true);
    // The slot is empty: the recording is on disk, so there is nothing left to
    // hold and no recovery screen to show.
    expect(s.held()).toBeNull();
    // The reload is how the just-recorded row stops reading as never-recorded.
    expect(onSaved).toHaveBeenCalledTimes(1);
    const segment = await getSegment(segmentId);
    expect(segment?.activeTakeId).not.toBeNull();
    const stored = await getClip(clipId);
    expect(stored?.encoding).toBe("pcm");
    if (stored?.encoding === "pcm") expect(stored.samples).toEqual(samples(10));
  });

  it("saves the MERGED buffer, not the fragment that was recorded", async () => {
    // Under the 1:1 take model `saveTake` REPLACES the segment's audio, so what
    // is written has to be the whole segment: existing audio with the recording
    // spliced in at the offset. Saving `recorded` alone would delete the
    // original clip and leave only the new fragment.
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake({
      segmentId,
      clipId,
      existing: samples(6, 100),
      recorded: samples(4, 200),
      offset: 3,
    });
    const s = slot(take);

    await performSaveTake(take, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    const stored = await getClip(clipId);
    expect(stored?.encoding).toBe("pcm");
    if (stored?.encoding === "pcm") {
      expect(Array.from(stored.samples)).toEqual([
        100, 100, 100, 200, 200, 200, 200, 100, 100, 100,
      ]);
    }
  });

  it("saves the flattened buffer as-is on an edit-only commit", async () => {
    // B5: `recorded` is empty and the whole edited segment is in `existing`, so
    // the merge is a pass-through and the buffer lands verbatim.
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const edited = samples(7, 321);
    const take = heldTake({
      segmentId,
      clipId,
      existing: edited,
      recorded: new Int16Array(0),
      editOnly: true,
    });
    const s = slot(take);

    await performSaveTake(take, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    const stored = await getClip(clipId);
    if (stored?.encoding === "pcm") expect(stored.samples).toEqual(edited);
    expect(s.held()).toBeNull();
  });

  it("asks for the transcode sweep only when the take carries the Finished mark", async () => {
    // D3: a finished take is finished PCM and is owed an MP3. A draft take is
    // not, and sweeping for it would load and encode audio still being worked on.
    const segmentId = await freshSegment();
    const draftSweep = vi.fn();
    const draftTake = heldTake({ segmentId, clipId: newClipId() });
    const draft = slot(draftTake);
    await performSaveTake(draftTake, {
      update: draft.update,
      requestSweep: draftSweep,
    });
    expect(draftSweep).not.toHaveBeenCalled();

    const finishedSweep = vi.fn();
    const finishedTake = heldTake({
      segmentId,
      clipId: newClipId(),
      finished: true,
    });
    const finished = slot(finishedTake);
    await performSaveTake(finishedTake, {
      update: finished.update,
      requestSweep: finishedSweep,
    });
    expect(finishedSweep).toHaveBeenCalledTimes(1);
    // And the mark rode the take rather than being a second write.
    expect((await getSegment(segmentId))?.status).toBe("affirmed");
  });

  it("empties the slot only for the attempt that actually succeeded", async () => {
    // A write resolving after its take was replaced must not clear the slot the
    // NEWER take is sitting in — that would drop a recording nobody saved.
    const segmentId = await freshSegment();
    const newer = heldTake({ segmentId, clipId: newClipId() });
    const s = slot(newer);
    const older = heldTake({ segmentId, clipId: newClipId() });

    const ok = await performSaveTake(older, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(s.held()).toBe(newer);
  });

  it("reports nothing to the funnel on a successful commit (#456)", async () => {
    const segmentId = await freshSegment();
    const take = heldTake({ segmentId, clipId: newClipId() });
    const s = slot(take);
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });

    off();
    expect(reports).toEqual([]);
  });

  it('keeps a committed write a success, and reports nothing under "save-take", even when a post-commit effect throws (Frank P2, PR #509 round 2)', async () => {
    // The mirror of the performErase / performClearEditedSegment guard: once
    // `saveTake` commits, the write itself succeeded. A throwing post-commit
    // effect (a reload that failed, or a sweep request that threw) must not
    // be folded back into a "save-take" failure report or re-arm the
    // recovery screen over a take that is already durably on disk.
    //
    // `finished: true` on purpose (Frank round 2, PR #509): the FIRST fix
    // for this finding put `update`, `onSaved` and `requestSweep` behind one
    // shared try, which meant `onSaved` throwing skipped `requestSweep`
    // entirely and left Finished PCM without the transcode request it is
    // owed (D3) — this assertion is what pins that each effect is
    // independent, not just that the function as a whole returns true.
    const segmentId = await freshSegment();
    const clipId = newClipId();
    const take = heldTake({ segmentId, clipId, finished: true });
    const s = slot(take);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));
    const requestSweep = vi.fn();

    const ok = await performSaveTake(take, {
      update: s.update,
      onSaved: () => {
        throw new Error("reload failed");
      },
      requestSweep,
    });

    off();
    consoleError.mockRestore();
    expect(ok).toBe(true);
    // The store op committed — this is the notification-failure site, not
    // the store-failure one #456 routes. Only the latter reports.
    expect(reports).toEqual([]);
    // The slot was still cleared: the write is on disk, so there is nothing
    // left to hold and no recovery screen to show.
    expect(s.held()).toBeNull();
    const stored = await getClip(clipId);
    expect(stored?.encoding).toBe("pcm");
    // The Finished mark still owes a sweep, independent of onSaved's throw.
    expect(requestSweep).toHaveBeenCalledTimes(1);
  });
});

describe("performSaveTake — a commit that fails", () => {
  /** A segment id with no row: `saveTake` throws "No such segment: …". */
  const bogusSegment = () => newClipId() as unknown as SegmentId;

  it("keeps the recording held on a stale target rather than dropping it", async () => {
    // THE regression this file exists for. A `finally` that empties the slot,
    // or a rethrow that unwinds past it, loses the only copy of field audio.
    // Since #378 this exact store error is not retryable — the segment row is
    // gone — but the recovery screen still has to own the samples until the
    // translator confirms Discard.
    const clipId = newClipId();
    const recorded = samples(10, 4242);
    const take = heldTake({ segmentId: bogusSegment(), clipId, recorded });
    const s = slot(take);
    const onSaved = vi.fn();
    const requestSweep = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const ok = await performSaveTake(take, {
      update: s.update,
      onSaved,
      requestSweep,
    });

    expect(ok).toBe(false);
    const held = s.held();
    expect(held).not.toBeNull();
    expect(held?.state).toBe("failed");
    expect(held?.kind).toBe("stale");
    expect(held?.attempts).toBe(1);
    // The samples are carried through untouched — the recipe a retry re-runs.
    expect(held?.recorded).toBe(recorded);
    expect(held?.clipId).toBe(clipId);
    // No reload, and no sweep: nothing is durably on disk to sweep.
    expect(onSaved).not.toHaveBeenCalled();
    expect(requestSweep).not.toHaveBeenCalled();
    // Never swallowed silently.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("leaves no orphaned clip behind for the failed attempt", async () => {
    // #38: the clip and the take are one transaction, so a failed save must not
    // hold the space the save just ran out of. The retry reuses this clipId.
    const clipId = newClipId();
    const take = heldTake({ segmentId: bogusSegment(), clipId });
    const s = slot(take);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await performSaveTake(take, {
      update: s.update,
      requestSweep: vi.fn(),
    });

    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
    consoleError.mockRestore();
  });

  it('reports the failure to the funnel once, under "save-take" (#456)', async () => {
    const take = heldTake({ segmentId: bogusSegment(), clipId: newClipId() });
    const s = slot(take);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performSaveTake(take, { update: s.update, requestSweep: vi.fn() });

    off();
    consoleError.mockRestore();
    expect(reports.map((r) => r.context)).toEqual(["save-take"]);
    expect(reports[0]?.cause).toBeInstanceOf(Error);
  });

  it("does not mark a slot that has moved on to another take", async () => {
    // The mirror of the success case: a late failure must not turn a newer
    // `saving` take into a `failed` one and offer Retry over the wrong audio.
    const segmentId = await freshSegment();
    const newer = heldTake({ segmentId, clipId: newClipId() });
    const s = slot(newer);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const ok = await performSaveTake(
      heldTake({ segmentId: bogusSegment(), clipId: newClipId() }),
      { update: s.update, requestSweep: vi.fn() }
    );

    expect(ok).toBe(false);
    expect(s.held()).toBe(newer);
    consoleError.mockRestore();
  });
});

describe("performDiscardTake", () => {
  it("empties the slot and deletes the clip the failed attempt left", async () => {
    // The orphan `discardSave` only REPORTS. Nothing references these bytes
    // once the slot is empty, so leaving them holds exactly the space that ran
    // out — on the one device that has just run out of it.
    const segmentId = await freshSegment();
    const clipId = newClipId();
    await putClip(clipId, samples(10), CANONICAL_SAMPLE_RATE);
    const s = slot(heldTake({ segmentId, clipId }));

    await performDiscardTake(s.held(), s.update);

    expect(s.held()).toBeNull();
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
  });

  it("deletes nothing when there was nothing held", async () => {
    // A discard tapped with an empty slot must not delete anything: there is no
    // orphan to report, and a delete keyed on a stale id would take live audio.
    const segmentId = await freshSegment();
    const other = newClipId();
    await putClip(other, samples(10), CANONICAL_SAMPLE_RATE);
    const s = slot(null);

    await performDiscardTake(s.held(), s.update);

    expect(s.held()).toBeNull();
    expect(await getClipMeta(other)).toBeDefined();
    expect((await getSegment(segmentId))?.activeTakeId).toBeNull();
  });
});

describe("performClearEditedSegment — the cut-to-empty close (#456)", () => {
  /** A segment id with no row: `clearSegmentTake` throws "No such segment: …". */
  const bogusSegment = () => newClipId() as unknown as SegmentId;

  it('reports a store rejection to the funnel once, under "erase-segment" (George R1 P3-3)', async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    const outcome = await performClearEditedSegment(bogusSegment());

    off();
    consoleError.mockRestore();
    expect(outcome).toBe("stale");
    expect(reports.map((r) => r.context)).toEqual(["erase-segment"]);
    expect(reports[0]?.cause).toBeInstanceOf(Error);
  });

  it('answers "stale" only for the segment it was asked to clear (#607)', async () => {
    // A missing segment is a target another copy deleted, and a retry of the
    // clear cannot bring it back; any other failure may pass on the next tap.
    // The store call is the real one above; here it is replaced for one call.
    const segmentId = await freshSegment();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.mocked(clearSegmentTake).mockRejectedValueOnce(
      new Error("QuotaExceededError")
    );
    const transient = await performClearEditedSegment(segmentId);
    vi.mocked(clearSegmentTake).mockRejectedValueOnce(
      new Error("No such segment: some-other-segment")
    );
    const otherId = await performClearEditedSegment(segmentId);

    consoleError.mockRestore();
    expect(transient).toBe(false);
    expect(otherId).toBe(false);
  });

  it("reports nothing to the funnel, and fires onCleared, on a successful clear", async () => {
    const segmentId = await freshSegment();
    const onCleared = vi.fn();
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    const outcome = await performClearEditedSegment(segmentId, onCleared);

    off();
    expect(outcome).toBe(true);
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(reports).toEqual([]);
  });

  it("keeps a committed clear a success even when onCleared throws (Frank P2, PR #509 round 2)", async () => {
    // The mirror of performErase's "keeps a committed delete a success even
    // when onErased throws": the store op is what can genuinely fail, and a
    // throwing notification (a reload that failed, say) must not turn an
    // already-committed clear into a false "erase-segment" report or a
    // "could not clear" message over audio that is already gone.
    const segmentId = await freshSegment();
    const onCleared = vi.fn(() => {
      throw new Error("reload failed");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    const outcome = await performClearEditedSegment(segmentId, onCleared);

    off();
    consoleError.mockRestore();
    expect(outcome).toBe(true);
    expect(onCleared).toHaveBeenCalledTimes(1);
    // The store op committed — this is the notification-failure site, not
    // the store-failure one #456 routes. Only the latter reports.
    expect(reports).toEqual([]);
  });
});
