import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mergeTake } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
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
  loadPendingRecipe,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import {
  clearSegmentTake,
  saveReplayedTake,
  saveTake,
  settlePendingTake,
} from "@/lib/storage/takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type {
  ClipId,
  SegmentId,
  StoredPendingTake,
  TakeDisposition,
} from "@/types/domain";
import {
  clearAllStores,
  forgetDisposition,
  loseClip,
  ramp,
  recordTake,
} from "./support";

/**
 * The replay's conditional commit at the store (#38 rebuild PR 3, the store
 * slice; closes #1557): `saveReplayedTake` judges the take once, inside its
 * owning transaction, with `judgePending`, and does what the verdict says
 * (docs/design/pending-take-lifecycle.md §4, cells RP-P, RP-S, RP-E, DL-P,
 * TP-P and Frank r2's and George r4's pairs in TP-X). A second copy is the
 * store called directly; the orderings themselves are
 * `tests/pending-interleave.test.ts`.
 */

const RATE = CANONICAL_SAMPLE_RATE;

type Replayable = NewTake & { readonly baseRevision: number };

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

/** A first take on an empty segment, read at revision 0. */
const firstTake = (segmentId: SegmentId): NewTake => ({
  segmentId,
  ordinal: 1,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: ramp(40),
  offset: 0,
  finished: false,
  editOnly: false,
  baseRevision: 0,
});

/** A segment with kept take K (revision 1), and an append onto K's audio. */
const keptSegment = async () => {
  const segmentId = await freshSegment();
  const kept = await recordTake(segmentId, { frames: 80 });
  const meta = (await getClipMeta(kept.clipId)) as ClipMeta;
  const pcm = new Int16Array(80).fill(1000);
  const append: NewTake = {
    ...firstTake(segmentId),
    existing: pcm,
    offset: 80,
    baseRevision: 1,
  };
  return { segmentId, kept, meta, pcm, append };
};

/** Hold the take, then read it back the way a launch replay does. */
const holdAndLoad = async (
  t: NewTake,
  source: ClipMeta | null = null
): Promise<Replayable> => {
  expect(await writePendingTake(t, { source })).toEqual({
    ok: true,
    outcome: "written",
  });
  const row = (await rowsNow()).find((r) => r.clipId === t.clipId)!;
  const read = await loadPendingRecipe(row, RATE);
  if (read.kind !== "recipe") throw new Error(`no recipe: ${read.kind}`);
  return read.take as Replayable;
};

const replay = (
  t: Replayable,
  opts: { isDiscardRequested?: (clipId: ClipId) => boolean } = {}
) =>
  saveReplayedTake(t, mergeTake(t.existing, t.recorded, t.offset), RATE, opts);

const rowsNow = async (): Promise<StoredPendingTake[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows;
};

const recordOf = async (
  clipId: ClipId
): Promise<TakeDisposition["kind"] | undefined> =>
  (await (await getDb()).get("takeDispositions", clipId))?.kind;

const activeClip = async (segmentId: SegmentId): Promise<ClipId | null> => {
  const segment = await getSegment(segmentId);
  if (!segment?.activeTakeId) return null;
  return (await (await getDb()).get("takes", segment.activeTakeId))!.clipId;
};

const counts = async () => {
  const db = await getDb();
  return {
    takes: await db.count("takes"),
    clips: await db.count("clipMeta"),
    rows: await db.count("pendingTakes"),
  };
};

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveReplayedTake: free saves (RP-P)", () => {
  it("replays a row whose revision is unchanged, and deletes it in the commit's transaction", async () => {
    const segmentId = await freshSegment();
    const t = await holdAndLoad({ ...firstTake(segmentId), finished: true });

    const result = await replay(t);

    expect(result.outcome).toBe("saved");
    expect(await activeClip(segmentId)).toBe(t.clipId);
    expect(await rowsNow()).toEqual([]);
    expect(await recordOf(t.clipId)).toBe("saved");
    const segment = await getSegment(segmentId);
    expect(segment?.audioRevision).toBe(1);
    expect(segment?.status).toBe("affirmed");
  });

  it("writes nothing at all when the take write fails: row, record and revision stay", async () => {
    const segmentId = await freshSegment();
    const t = await holdAndLoad(firstTake(segmentId));
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      if (this.name === "takes") throw new Error("injected takes fault");
      return realPut.apply(this, args);
    });

    await expect(replay(t)).rejects.toThrow("injected takes fault");
    vi.restoreAllMocks();

    expect((await rowsNow()).map((r) => r.clipId)).toEqual([t.clipId]);
    expect(await recordOf(t.clipId)).toBeUndefined();
    expect((await getSegment(segmentId))?.audioRevision).toBe(0);
    expect(await getClipMeta(t.clipId)).toBeUndefined();
  });

  it("a hold by another copy during the replay never takes the row, and the replay saves its take (mixed build)", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    // Another copy holds D on the same segment after C was loaded.
    const d = firstTake(segmentId);
    expect(await writePendingTake(d)).toEqual({
      ok: true,
      outcome: "kept-foreign",
    });

    expect((await replay(c)).outcome).toBe("saved");
    expect(await activeClip(segmentId)).toBe(c.clipId);
  });

  it("a cross-copy quota give-up keeps C and saves it (Frank r2 (a))", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    await settlePendingTake(segmentId, c.clipId, "give-up");
    expect(await rowsNow()).toEqual([]);

    expect((await replay(c)).outcome).toBe("saved");
    expect(await activeClip(segmentId)).toBe(c.clipId);
    expect(await recordOf(c.clipId)).toBe("saved");
  });
});

describe("saveReplayedTake: a take already finished writes nothing (#1557)", () => {
  it("a row another copy already finished reports saved, writes no row and no take", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    // Copy A's ordinary save of the same take: its row goes, `saved` lands.
    await saveTake(
      segmentId,
      c.clipId,
      mergeTake(c.existing, c.recorded, 0),
      RATE
    );
    const before = await counts();
    const revision = (await getSegment(segmentId))?.audioRevision;

    expect(await replay(c)).toEqual({ outcome: "already-saved" });

    expect(await counts()).toEqual(before);
    expect(before.rows).toBe(0);
    expect((await getSegment(segmentId))?.audioRevision).toBe(revision);
  });

  it("a take another copy saved and then replaced reports saved, and parks no second copy (#1557's case)", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    await saveTake(
      segmentId,
      c.clipId,
      mergeTake(c.existing, c.recorded, 0),
      RATE
    );
    // A newer take replaces C: neither the row nor the active clip says C
    // was saved now. Only the record does.
    const d = await recordTake(segmentId);
    const before = await counts();

    expect(await replay(c)).toEqual({ outcome: "already-saved" });
    expect(await counts()).toEqual(before);
    expect(await activeClip(segmentId)).toBe(d.clipId);
  });

  it("reads the active clip as done when no record says so", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    await saveTake(
      segmentId,
      c.clipId,
      mergeTake(c.existing, c.recorded, 0),
      RATE
    );
    await forgetDisposition(c.clipId);

    expect(await replay(c)).toEqual({ outcome: "already-saved" });
    expect(await recordOf(c.clipId)).toBe("saved");
  });

  it("a Retry after another copy's replay saved the same take reports saved and writes nothing (TP-P)", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    expect((await replay(c)).outcome).toBe("saved");
    const before = await counts();

    // The revision moved (C's own save), but the record says saved: done.
    expect(await replay(c)).toEqual({ outcome: "already-saved" });
    expect(await counts()).toEqual(before);
  });
});

describe("saveReplayedTake: discarded writes nothing", () => {
  it("a cross-copy Discard frees C with nothing written (Frank r2 (b))", async () => {
    const { segmentId, kept, append } = await keptSegment();
    const c = await holdAndLoad(append);
    await settlePendingTake(segmentId, c.clipId, "discard");
    const before = await counts();

    expect(await replay(c)).toEqual({ outcome: "discarded" });
    expect(await counts()).toEqual(before);
    expect(await activeClip(segmentId)).toBe(kept.clipId);
  });

  it("a Discard requested in this copy writes nothing and leaves the row for its own settle", async () => {
    const { segmentId, kept, append } = await keptSegment();
    const c = await holdAndLoad(append);

    expect(
      await replay(c, { isDiscardRequested: (id) => id === c.clipId })
    ).toEqual({ outcome: "discarded" });
    expect((await rowsNow()).map((r) => r.clipId)).toEqual([c.clipId]);
    expect(await activeClip(segmentId)).toBe(kept.clipId);
    expect(await recordOf(c.clipId)).toBeUndefined();
  });
});

describe("saveReplayedTake: moved and unexplained keep, and never save", () => {
  it("a first-take row is not replayed onto a segment another copy saved and then erased (RP-E)", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    await recordTake(segmentId);
    await clearSegmentTake(segmentId);
    // `activeTakeId` is null again: only the revision tells.
    expect((await getSegment(segmentId))?.activeTakeId).toBeNull();

    expect(await replay(c)).toEqual({ outcome: "kept", verdict: "moved" });
    expect((await getSegment(segmentId))?.activeTakeId).toBeNull();
    const [row] = await rowsNow();
    expect(row?.clipId).toBe(c.clipId);
    expect(row?.refusal).toBe("superseded");
    expect(await recordOf(c.clipId)).toBeUndefined();
  });

  it("a newer save between the recipe read and the commit survives (RP-S, Frank r1 on #1546)", async () => {
    const { segmentId, append } = await keptSegment();
    const c = await holdAndLoad(append);
    const d = await recordTake(segmentId);

    expect(await replay(c)).toEqual({ outcome: "kept", verdict: "moved" });
    expect(await activeClip(segmentId)).toBe(d.clipId);
    const [row] = await rowsNow();
    expect(row?.refusal).toBe("superseded");
    // The marked row still rebuilds the same audio.
    const read = await loadPendingRecipe(row!, RATE);
    expect(read.kind === "recipe" && Array.from(read.take.recorded)).toEqual(
      Array.from(c.recorded)
    );
  });

  it("a kept row's stored base survives another copy replacing the take, and its recipe rebuilds (Frank r3 on the note)", async () => {
    const { segmentId, kept, meta, pcm, append } = await keptSegment();
    const c = await holdAndLoad(append, meta);
    expect((await rowsNow())[0]?.base.kind).toBe("stored");
    await recordTake(segmentId);

    expect(await replay(c)).toEqual({ outcome: "kept", verdict: "moved" });
    const [row] = await rowsNow();
    expect(row?.base.kind).toBe("stored");
    const read = await loadPendingRecipe(row!, RATE);
    expect(read.kind === "recipe" && Array.from(read.take.existing)).toEqual(
      Array.from(pcm)
    );
    // The pair: the base clip goes when that kept row ends.
    await deleteSegment(segmentId);
    expect(await getClipMeta(kept.clipId)).toBeUndefined();
  });

  it("a kept row whose stored base is gone is rewritten inline from the slot before the slot is freed", async () => {
    const { segmentId, kept, meta, pcm, append } = await keptSegment();
    const c = await holdAndLoad(append, meta);
    await recordTake(segmentId);
    // A row from before the base rule held: its base clip is gone.
    await loseClip(kept.clipId);

    expect(await replay(c)).toEqual({ outcome: "kept", verdict: "moved" });
    const [row] = await rowsNow();
    expect(row?.base.kind).toBe("inline");
    expect(row?.refusal).toBe("superseded");
    const read = await loadPendingRecipe(row!, RATE);
    expect(read.kind === "recipe" && Array.from(read.take.existing)).toEqual(
      Array.from(pcm)
    );
  });

  it("parks a take whose row went with no record, as unexplained, and never saves it", async () => {
    const { segmentId, kept, append } = await keptSegment();
    const c = await holdAndLoad(append);
    // Removed without a record: no v13 writer does this, so it is done raw.
    await (await getDb()).delete("pendingTakes", segmentId);

    expect(await replay(c)).toEqual({
      outcome: "kept",
      verdict: "unexplained",
    });
    expect(await activeClip(segmentId)).toBe(kept.clipId);
    const [row] = await rowsNow();
    expect(row?.clipId).toBe(c.clipId);
    expect(row?.refusal).toBe("unexplained");
    expect(row?.base.kind).toBe("inline");
    expect(row?.baseRevision).toBe(c.baseRevision);
  });

  it("parks a given-up take whose segment moved since (TP-E at the store, Frank r7 on #1546)", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    await settlePendingTake(segmentId, c.clipId, "give-up");
    await recordTake(segmentId);
    await clearSegmentTake(segmentId);

    expect(await replay(c)).toEqual({ outcome: "kept", verdict: "moved" });
    expect((await getSegment(segmentId))?.activeTakeId).toBeNull();
    expect((await rowsNow())[0]?.refusal).toBe("superseded");
  });

  it("a given-up take is not saved while another clip's row holds the segment (George r4)", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    await settlePendingTake(segmentId, c.clipId, "give-up");
    const d = firstTake(segmentId);
    expect(await writePendingTake(d)).toEqual({ ok: true, outcome: "written" });
    const dRow = await rowsNow();

    expect(await replay(c)).toEqual({
      outcome: "held",
      verdict: "unexplained",
    });
    expect(await rowsNow()).toEqual(dRow);
    expect((await getSegment(segmentId))?.activeTakeId).toBeNull();
    expect(await recordOf(c.clipId)).toBe("given-up");
  });
});

describe("saveReplayedTake: gone (DL-P, DL-R)", () => {
  it("writes nothing for a deleted segment, and drops a row a PR-1 build left behind", async () => {
    const segmentId = await freshSegment();
    const c = await holdAndLoad(firstTake(segmentId));
    const [row] = await rowsNow();
    await deleteSegment(segmentId);
    // A build before rebuild PR 2 kept the row; put it back to model that.
    await (await getDb()).put("pendingTakes", row!);

    expect(await replay(c)).toEqual({ outcome: "gone" });
    expect(await rowsNow()).toEqual([]);
    expect(await recordOf(c.clipId)).toBeUndefined();
    expect(await getClipMeta(c.clipId)).toBeUndefined();
  });
});

describe("a settle after its segment was deleted leaves no record", () => {
  it.each(["discard", "give-up"] as const)(
    "%s on a deleted segment writes no disposition",
    async (kind) => {
      const segmentId = await freshSegment();
      const c = firstTake(segmentId);
      await writePendingTake(c);
      await deleteSegment(segmentId);

      expect(await settlePendingTake(segmentId, c.clipId, kind)).toEqual({
        ok: true,
      });
      expect(await recordOf(c.clipId)).toBeUndefined();
      expect(await (await getDb()).count("takeDispositions")).toBe(0);
    }
  );
});
