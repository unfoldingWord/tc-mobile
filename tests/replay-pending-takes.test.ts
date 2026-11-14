import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Passes through to the real store unless a case holds a Discard's settle
// back, which is how a request-only Discard is kept open across a replay.
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return {
    ...actual,
    settlePendingTake: vi.fn(actual.settlePendingTake),
    // Logs "drop-settled" when the real drop returns, so a case can order it
    // against the failure rows (#1860).
    dropRefusedPendingTake: vi.fn(
      async (...args: Parameters<typeof actual.dropRefusedPendingTake>) => {
        const result = await actual.dropRefusedPendingTake(...args);
        order.push("drop-settled");
        return result;
      }
    ),
  };
});

const order: string[] = [];

import {
  refusedAndDropped,
  replayPendingTakes,
} from "@/hooks/replay-pending-takes";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import {
  performDiscardTake,
  performResumeTake,
  performSaveTake,
} from "@/hooks/use-save-take";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { lightsFailureMarker } from "@/lib/failure-marker";
import { describeCause } from "@/lib/failure-text";
import {
  addChapter,
  addSegment,
  createBook,
  deleteSegment,
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
  type NewTake,
  type PendingTake,
} from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type {
  ClipId,
  SegmentId,
  StoredPendingTake,
  TakeDisposition,
} from "@/types/domain";
import { clearAllStores, ramp, recordTake, stripComments } from "./support";

/**
 * The replay slice of #38 rebuild PR 3 (docs/design/pending-take-lifecycle.md
 * §3 "The replay's own reads", §4): the launch replay lists the rows, sorts
 * them oldest first, classifies each without reading audio, reads the recipe,
 * installs the take in the one slot, and commits it through
 * `saveReplayedTake`, the conditional commit #1652 added. A Retry of a
 * replayed take runs that commit again, never the ordinary `saveTake`.
 *
 * `replayPendingTakes` and `performResumeTake` are the whole of the replay
 * minus React; the slot here is the hook's `writeSlot` modelled as a
 * variable, the same split `tests/use-save-take-pending.test.ts` uses.
 */

const RATE = CANONICAL_SAMPLE_RATE;

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
  baseGeneration: null,
});

const rowsNow = async (): Promise<StoredPendingTake[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows;
};

const rowOf = async (
  segmentId: SegmentId
): Promise<StoredPendingTake | undefined> =>
  (await getDb()).get("pendingTakes", segmentId);

const recordOf = async (
  clipId: ClipId
): Promise<TakeDisposition["kind"] | undefined> =>
  (await (await getDb()).get("takeDispositions", clipId))?.kind;

const activeClip = async (segmentId: SegmentId): Promise<ClipId | null> => {
  const segment = await getSegment(segmentId);
  if (!segment?.activeTakeId) return null;
  return (await (await getDb()).get("takes", segment.activeTakeId))!.clipId;
};

/** Put a row exactly as given, for the shapes no v13 hold writes. */
const putRow = async (row: StoredPendingTake): Promise<void> => {
  await (await getDb()).put("pendingTakes", row);
};

/** The row a hold writes for a first take, read straight back. */
const heldRow = async (t: ReplayTake): Promise<StoredPendingTake> => {
  expect(await writePendingTake(t)).toEqual({ ok: true, outcome: "written" });
  return (await rowOf(t.segmentId))!;
};

/**
 * The hook's slot and effects, modelled: `update` is `writeSlot`, applied
 * synchronously, and `onSaved` / `requestSweep` are counted.
 */
const app = () => {
  let held: PendingTake | null = null;
  const calls = { saved: 0, sweep: 0 };
  const effects = {
    update: (t: (h: PendingTake | null) => PendingTake | null) => {
      held = t(held);
    },
    onSaved: () => {
      calls.saved += 1;
    },
    requestSweep: () => {
      calls.sweep += 1;
    },
  };
  return {
    held: () => held,
    effects,
    calls,
    /** The launch replay as `useSaveTake`'s effect runs it. */
    launch: (before?: (take: ReplayTake) => Promise<void>) =>
      replayPendingTakes(async (take) => {
        await before?.(take);
        return (await performResumeTake(held, take, effects)) === true;
      }),
  };
};

let reports: FailureReport[] = [];
let off: () => void = () => {};
const contexts = () => reports.map((r) => r.context);
const messages = () => reports.map((r) => (r.cause as Error).message);

/** `ramp(40)` at the canonical rate: what a refusal row reports as its length. */
const FORTY_SAMPLES = `length: 1 ms (40 samples)`;

beforeEach(async () => {
  await clearAllStores();
  reports = [];
  order.length = 0;
  off = subscribeToFailures((r) => {
    reports.push(r);
    order.push(`report:${r.context}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  off();
  vi.restoreAllMocks();
});

describe("the launch replay saves a row it finds (RP-P, in the app)", () => {
  it("saves a held first take quietly: active, row gone, slot clear, the screen reloads, one informational log row", async () => {
    const segmentId = await freshSegment();
    const t = { ...firstTake(segmentId), finished: true };
    await heldRow(t);
    const a = app();

    await a.launch();

    expect(await activeClip(segmentId)).toBe(t.clipId);
    expect(await rowsNow()).toEqual([]);
    expect(await recordOf(t.clipId)).toBe("saved");
    expect(a.held()).toBeNull();
    expect(a.calls).toEqual({ saved: 1, sweep: 1 });
    // Quiet on screen; the one record is an informational row that does not
    // light ≡ (#38, PR #1706's pick; tests/pending-take-replayed-row.test.ts).
    expect(contexts()).toEqual(["pending-take-replayed"]);
  });

  it("goes oldest first and saves every row, one at a time", async () => {
    // The store lists rows by key (segment id): the older row gets the later
    // key, so key order is the wrong order.
    const [s1, s2] = [await freshSegment(), await freshSegment()].sort();
    const older = firstTake(s2!);
    const newer = firstTake(s1!);
    await putRow({ ...(await heldRow(older)), createdAt: 1 });
    await putRow({ ...(await heldRow(newer)), createdAt: 2 });
    const order: ClipId[] = [];

    await app().launch(async (take) => {
      order.push(take.clipId);
    });

    expect(order).toEqual([older.clipId, newer.clipId]);
    expect(await rowsNow()).toEqual([]);
  });
});

describe("#1557 in the app: a row another copy finished leaves the slot clear", () => {
  it("another copy saves C between this launch's read and its commit: already-saved, no second row, clip or take, slot clear", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();

    await a.launch(async (take) => {
      // Copy A finishes C's own save (deleting C's row) after this copy
      // read the row back.
      await saveTake(segmentId, take.clipId, take.recorded, RATE);
    });

    expect(a.held()).toBeNull();
    expect(await rowsNow()).toEqual([]);
    expect(await activeClip(segmentId)).toBe(c.clipId);
    const db = await getDb();
    expect(await db.count("takes")).toBe(1);
    expect(await db.count("clipMeta")).toBe(1);
    expect(await recordOf(c.clipId)).toBe("saved");
    expect(reports).toEqual([]);
    expect(a.calls.saved).toBe(1);
  });

  it("a row whose take is already active is ended by the verdict, not skipped: row gone, slot clear", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    const row = await heldRow(c);
    await saveTake(segmentId, c.clipId, c.recorded, RATE);
    // The row outlived its save (a raw state no v13 commit leaves).
    await putRow(row);
    const a = app();

    await a.launch();

    expect(await rowsNow()).toEqual([]);
    expect(a.held()).toBeNull();
    expect(reports).toEqual([]);
  });
});

describe("classification, before any audio is read (§3, The replay's own reads)", () => {
  it("a row whose segment is gone is deleted and reported once, and nothing is installed", async () => {
    const segmentId = await freshSegment();
    const row = await heldRow(firstTake(segmentId));
    // The row a pre-PR-2 delete left behind.
    await deleteSegment(segmentId);
    await putRow(row);
    const resumed = vi.fn();

    await replayPendingTakes(resumed);

    expect(resumed).not.toHaveBeenCalled();
    expect(await rowsNow()).toEqual([]);
    expect(contexts()).toEqual(["pending-take-refused"]);
  });

  it("a row an earlier build marked refused is dropped, logged once, and the next launch is quiet (#1562 item 2)", async () => {
    const segmentId = await freshSegment();
    const row = await heldRow(firstTake(segmentId));
    await putRow({ ...row, refusal: "superseded" });
    const resumed = vi.fn();

    await replayPendingTakes(resumed);
    await replayPendingTakes(resumed);

    expect(resumed).not.toHaveBeenCalled();
    expect(await rowOf(segmentId)).toBeUndefined();
    expect(await recordOf(row.clipId)).toBe("refused");
    expect(contexts()).toEqual(["pending-take-refused"]);
    expect(messages()[0]).toContain(
      "refusal: superseded (kept by an earlier build)"
    );
    expect(messages()[0]).toContain("verdict: not reached");
    expect(messages()[0]).toContain(FORTY_SAMPLES);
  });

  it("an earlier build's marked row with a stored base lets its base clip go when nothing else uses it", async () => {
    const segmentId = await freshSegment();
    const kept = await recordTake(segmentId, { frames: 80 });
    const meta = (await getClipMeta(kept.clipId)) as ClipMeta;
    const t: ReplayTake = {
      ...firstTake(segmentId),
      existing: new Int16Array(80).fill(1000),
      offset: 80,
      baseRevision: 1,
      baseGeneration: null,
    };
    expect(await writePendingTake(t, { source: meta })).toEqual({
      ok: true,
      outcome: "written",
    });
    await recordTake(segmentId);
    const row = (await rowOf(segmentId))!;
    expect(row.base.kind).toBe("stored");
    await putRow({ ...row, refusal: "superseded" });

    await replayPendingTakes(vi.fn());

    expect(await rowOf(segmentId)).toBeUndefined();
    expect(await getClipMeta(kept.clipId)).toBeUndefined();
  });

  it("the dropped row is written only after the drop has committed (#1860)", async () => {
    const segmentId = await freshSegment();
    const row = await heldRow(firstTake(segmentId));
    await putRow({ ...row, refusal: "superseded" });

    await replayPendingTakes(vi.fn());

    expect(order).toEqual(["drop-settled", "report:pending-take-refused"]);
    expect(messages()[0]).toContain("audio dropped");
    expect(await rowOf(segmentId)).toBeUndefined();
  });

  it("a failed drop leaves the row as it was and reports it as ONE row carrying the delete cause, and the next launch tries again", async () => {
    const segmentId = await freshSegment();
    const row = await heldRow(firstTake(segmentId));
    await putRow({ ...row, refusal: "superseded" });
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementationOnce(() => {
      throw new Error("injected delete fault");
    });

    await replayPendingTakes(vi.fn());

    expect((await rowOf(segmentId))?.refusal).toBe("superseded");
    // One write, so a kill cannot land between the delete error and the
    // "audio still present" statement (#1863).
    expect(contexts()).toEqual(["pending-take-refused"]);
    expect(messages()[0]).toContain("audio still present");
    expect(messages()[0]).not.toContain("audio dropped");
    expect(describeCause(reports[0]!.cause).message).toContain(
      "injected delete fault"
    );
    // Both contexts light the Books marker by default, so one row lights it
    // exactly as the two did.
    expect(lightsFailureMarker("pending-take-refused")).toBe(true);
    expect(lightsFailureMarker("pending-take-delete")).toBe(true);

    await replayPendingTakes(vi.fn());
    expect(await rowOf(segmentId)).toBeUndefined();
  });

  it.each(
    [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ].flatMap((rate) =>
      (["drop commits", "drop fails"] as const).map(
        (path) => [rate, path] as const
      )
    )
  )(
    "a row stored at rate %s reports its length as unknown with the rate shown (%s)",
    async (rate, path) => {
      const segmentId = await freshSegment();
      const row = await heldRow(firstTake(segmentId));
      await putRow({ ...row, sampleRate: rate });
      if (path === "drop fails") {
        vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementationOnce(
          () => {
            throw new Error("injected delete fault");
          }
        );
      }

      await replayPendingTakes(vi.fn());

      expect(messages()[0]).toContain(
        `length: unknown (40 samples, rate ${rate})`
      );
    }
  );

  it.each([
    [40, Number.MIN_VALUE],
    [Number.POSITIVE_INFINITY, 48_000],
    [Number.NaN, 48_000],
  ] as const)(
    "a length that computes to a non-finite value prints unknown with samples and rate (%s samples, rate %s)",
    (samples, rate) => {
      expect(
        refusedAndDropped("sample-rate", null, samples, rate).message
      ).toContain(`length: unknown (${samples} samples, rate ${rate})`);
    }
  );

  it.each([
    [-40, 48_000],
    [-1, 22_050],
    [-0.5, 48_000],
  ] as const)(
    "a negative sample count prints unknown with samples and rate, never a numeric ms (%s samples, rate %s)",
    (samples, rate) => {
      const message = refusedAndDropped(
        "sample-rate",
        null,
        samples,
        rate
      ).message;
      expect(message).toContain(
        `length: unknown (${samples} samples, rate ${rate})`
      );
      expect(message).not.toMatch(/length: -?\d+ ms/);
    }
  );

  it.each([
    [
      "legacy",
      (row: StoredPendingTake): StoredPendingTake => {
        const legacy: { -readonly [K in keyof StoredPendingTake]?: unknown } = {
          ...row,
        };
        delete legacy.baseRevision;
        return legacy as StoredPendingTake;
      },
    ],
    [
      "sample-rate",
      (row: StoredPendingTake): StoredPendingTake => ({
        ...row,
        sampleRate: 22_050,
      }),
    ],
  ] as const)(
    "a %s row is dropped, reported once with its length, and quiet on the next launch",
    async (refusal, shape) => {
      const segmentId = await freshSegment();
      const row = await heldRow(firstTake(segmentId));
      await putRow(shape(row));
      const resumed = vi.fn();

      await replayPendingTakes(resumed);
      await replayPendingTakes(resumed);

      expect(resumed).not.toHaveBeenCalled();
      expect(await rowOf(segmentId)).toBeUndefined();
      expect(await recordOf(row.clipId)).toBe("refused");
      expect(contexts()).toEqual(["pending-take-refused"]);
      expect(messages()[0]).toContain(`refusal: ${refusal};`);
      expect(messages()[0]).toContain("verdict: not reached");
      // A row at another rate reports its length at its own rate.
      expect(messages()[0]).toContain(
        refusal === "sample-rate" ? "length: 2 ms (40 samples)" : FORTY_SAMPLES
      );
    }
  );

  it("a stored base whose clip changed is dropped as base-changed and never installed", async () => {
    const segmentId = await freshSegment();
    const kept = await recordTake(segmentId, { frames: 80 });
    const meta = (await getClipMeta(kept.clipId)) as ClipMeta;
    const t: ReplayTake = {
      ...firstTake(segmentId),
      existing: new Int16Array(80).fill(1000),
      offset: 80,
      baseRevision: 1,
      baseGeneration: null,
    };
    expect(await writePendingTake(t, { source: meta })).toEqual({
      ok: true,
      outcome: "written",
    });
    const db = await getDb();
    await db.put("clipMeta", { ...meta, generation: meta.generation + 1 });
    const resumed = vi.fn();

    await replayPendingTakes(resumed);

    expect(resumed).not.toHaveBeenCalled();
    expect(await rowOf(segmentId)).toBeUndefined();
    // The base clip is still the segment's active take, so it stays.
    expect(await getClipMeta(kept.clipId)).toBeDefined();
    expect(contexts()).toEqual(["pending-take-refused"]);
    expect(messages()[0]).toContain("refusal: base-changed;");
  });

  it("a failed list is reported under pending-take-read, and nothing else runs", async () => {
    const segmentId = await freshSegment();
    await heldRow(firstTake(segmentId));
    vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementation(() => {
      throw new Error("injected list fault");
    });
    const resumed = vi.fn();

    await replayPendingTakes(resumed);

    expect(resumed).not.toHaveBeenCalled();
    expect(contexts()).toEqual(["pending-take-read"]);
  });
});

describe("what the conditional commit's outcome does to the slot (§4)", () => {
  it("moved: the row is dropped, nothing saved over the segment, slot freed, reported once with refusal, verdict and length", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    // Another take lands after C's base was read: the revision moves.
    const d = await recordTake(segmentId);
    const a = app();

    await a.launch();

    expect(await activeClip(segmentId)).toBe(d.clipId);
    expect(await rowOf(segmentId)).toBeUndefined();
    expect(a.held()).toBeNull();
    expect(a.calls.saved).toBe(0);
    expect(contexts()).toEqual(["pending-take-refused"]);
    expect(messages()[0]).toContain("refusal: superseded;");
    expect(messages()[0]).toContain("verdict: moved;");
    expect(messages()[0]).toContain(FORTY_SAMPLES);
    expect(messages()[0]).toContain("audio dropped");
  });

  it("discarded in this copy while installed: nothing written, slot freed, reported once", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();

    await a.launch(async (take) => {
      // Another copy discards C after this copy read the row.
      await settlePendingTake(segmentId, take.clipId, "discard");
    });

    expect(await activeClip(segmentId)).toBeNull();
    expect(a.held()).toBeNull();
    expect(contexts()).toEqual(["pending-take-refused"]);
  });

  it("gone on the first attempt frees the slot; gone on a Retry fails it as stale", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    await a.launch(async () => {
      await deleteSegment(segmentId);
    });
    expect(a.held()).toBeNull();

    // A Retry of a held replayed take whose segment then went.
    const s2 = await freshSegment();
    const d = firstTake(s2);
    await heldRow(d);
    const b = app();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    });
    await b.launch();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(b.held()?.state).toBe("failed");
    await deleteSegment(s2);
    const next = retrySave(b.held())!;
    b.effects.update(() => next);
    expect(await performSaveTake(next, b.effects)).toBe(false);
    expect(b.held()?.kind).toBe("stale");
  });

  it("held (another clip's row holds the key, no row of its own): failed unknown, nothing written; a Retry drops it and never saves", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    const d = firstTake(segmentId);
    await a.launch(async () => {
      // C's row goes with no record, and D's row takes the key.
      const db = await getDb();
      await db.delete("pendingTakes", segmentId);
      await writePendingTake(d);
      expect((await rowOf(segmentId))?.clipId).toBe(d.clipId);
    });

    expect(a.held()?.state).toBe("failed");
    expect(a.held()?.kind).toBe("unknown");
    expect(a.held()?.attempts).toBe(1);
    expect(await activeClip(segmentId)).toBeNull();
    expect(contexts()).toEqual(["pending-take-refused"]);

    // D's row goes; Retry runs the verdict again: unexplained, dropped.
    await (await getDb()).delete("pendingTakes", segmentId);
    const next = retrySave(a.held())!;
    a.effects.update(() => next);
    expect(await performSaveTake(next, a.effects)).toBe(true);

    expect(await activeClip(segmentId)).toBeNull();
    expect(await rowOf(segmentId)).toBeUndefined();
    expect(a.held()).toBeNull();
    expect(messages()[1]).toContain("refusal: unexplained;");
    expect(messages()[1]).toContain("verdict: unexplained;");
  });

  it("a quota failure of a replayed commit keeps its row and gives nothing up", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    });

    await a.launch();
    // Any give-up a failure path started has had its turn.
    await new Promise((r) => setTimeout(r, 20));

    expect(a.held()?.kind).toBe("quota");
    expect((await rowOf(segmentId))?.clipId).toBe(c.clipId);
    expect(await recordOf(c.clipId)).toBeUndefined();
  });

  it("a replayed attempt never holds: a row gone with no record stays unexplained and is dropped, not saved", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    // C's row went with no record saying why (absence is not consent). A
    // hold before the commit would put an unmarked own row back, and the
    // verdict would then read it as free and save C.
    await (await getDb()).delete("pendingTakes", segmentId);
    const a = app();

    expect(await performResumeTake(null, c, a.effects)).toBe(true);

    expect(await activeClip(segmentId)).toBeNull();
    expect(await rowOf(segmentId)).toBeUndefined();
    expect(a.held()).toBeNull();
  });

  it("a Discard of a held replayed take records discarded and ends its row", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new Error("injected fault");
    });
    await a.launch();
    expect(a.held()?.state).toBe("failed");

    await performDiscardTake(a.held(), a.effects.update);

    expect(await rowOf(segmentId)).toBeUndefined();
    expect(await recordOf(c.clipId)).toBe("discarded");
    expect(a.held()).toBeNull();
  });
});

describe("a Discard requested in this copy outlives a replayed `discarded` (George on #1652)", () => {
  it("while the Discard's settle has not committed, every later replay of the take reports discarded and never saves it", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    // The first attempt fails, so the take is held on the recovery screen.
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new Error("injected fault");
    });
    await a.launch();
    expect(a.held()?.state).toBe("failed");
    // The person discards it, and the settle that records it is held back:
    // the request is the only thing that says so, and the row is unmarked.
    vi.mocked(settlePendingTake).mockImplementationOnce(
      () => new Promise(() => {})
    );
    void performDiscardTake(a.held(), a.effects.update);
    expect(a.held()).toBeNull();

    // Two more replay passes in this page (a remount): each installs C from
    // its row, and the conditional commit reads the request.
    await a.launch();
    await a.launch();

    expect(await activeClip(segmentId)).toBeNull();
    expect(await recordOf(c.clipId)).toBeUndefined();
    expect((await rowOf(segmentId))?.clipId).toBe(c.clipId);
    expect(a.held()).toBeNull();
  });
});

describe("the slot guard", () => {
  it("a held slot stops the run: busy, the row untouched, nothing written", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    const mine = { ...firstTake(await freshSegment()) };
    // The person's own recording holds the slot.
    a.effects.update(() => ({
      ...mine,
      state: "saving",
      kind: null,
      attempts: 0,
    }));

    await a.launch();

    expect(a.held()?.clipId).toBe(mine.clipId);
    expect((await rowOf(segmentId))?.clipId).toBe(c.clipId);
    expect(await activeClip(segmentId)).toBeNull();
  });

  it("a take that reaches the slot after it was read keeps it: the replay does not save", async () => {
    const segmentId = await freshSegment();
    const c = firstTake(segmentId);
    await heldRow(c);
    const a = app();
    const mine = firstTake(await freshSegment());
    const raced: PendingTake = {
      ...mine,
      state: "saving",
      kind: null,
      attempts: 0,
    };
    let calls = 0;
    const effects = {
      ...a.effects,
      update: (t: (h: PendingTake | null) => PendingTake | null) => {
        // The first write the replay makes finds a recording already there.
        if (calls++ === 0) a.effects.update(() => raced);
        a.effects.update(t);
      },
    };

    expect(await performResumeTake(null, c, effects)).toBe("busy");

    expect(a.held()?.clipId).toBe(mine.clipId);
    expect(await activeClip(segmentId)).toBeNull();
    expect((await rowOf(segmentId))?.clipId).toBe(c.clipId);
  });
});

describe("useSaveTake runs the replay once, from a mount effect", () => {
  it("the hook's effect calls replayPendingTakes through the slot's resume, which installs through performResumeTake", () => {
    const code = stripComments(
      readFileSync(resolve(__dirname, "../src/hooks/use-save-take.ts"), "utf8")
    );
    // Since #1549 the slot is `createTakeSlot`, made once per mount; its
    // `resume` is behaviour-tested in `tests/take-slot.test.ts`.
    const hook = code.slice(code.indexOf("export function useSaveTake"));
    expect(hook).toMatch(
      /useEffect\(\(\) => \{[^}]*?replayPendingTakes\(\(take\) => slot\.resume\(take\)\)/
    );
    const factory = code.slice(
      code.indexOf("export function createTakeSlot"),
      code.indexOf("export function useSaveTake")
    );
    expect(factory).toMatch(
      /resume: async \(take\) => \{[^]*?performResumeTake\(held, take, e\)/
    );
  });
});
