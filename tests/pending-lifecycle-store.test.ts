import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  createBook,
  deleteBook,
  deleteSegment,
  getSegment,
} from "@/lib/storage/books";
import { getClipMeta, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  listPendingTakes,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import {
  clearSegmentTake,
  saveTake,
  settlePendingTake,
} from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type {
  BookId,
  ClipId,
  SegmentId,
  StoredPendingTake,
  TakeDisposition,
} from "@/types/domain";
import {
  clearAllStores,
  ramp,
  recordTake,
  storeOrphanClip,
  throwWhenStoreRequested,
} from "./support";

/**
 * The v13 pending-take lifecycle at the store (#38,
 * docs/design/pending-take-lifecycle.md §3 and §5, the cells PR 1 owns): the
 * hold's seven steps, the owning transaction's commit, Discard and give-up
 * with their records, the deletes that drop records, and a pending row's
 * `stored` base clip counted as a use. Real stores over fake-indexeddb; a
 * second copy is modelled by calling the store directly, which is all a
 * second connection does in these single-ordering cases (the orderings
 * themselves are `tests/pending-interleave.test.ts`).
 */

const RATE = 48_000;

const freshSegment = async (): Promise<{
  bookId: BookId;
  segmentId: SegmentId;
}> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  return { bookId: book.id, segmentId: (await addSegment(chapter.id)).id };
};

const take = (
  segmentId: SegmentId,
  overrides: Partial<NewTake> = {}
): NewTake => ({
  segmentId,
  ordinal: 1,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: ramp(50),
  offset: 0,
  finished: false,
  editOnly: false,
  baseRevision: 0,
  ...overrides,
});

/** A segment with kept take K, and K's clip as the recorder read it. */
const keptSegment = async (opts: { finished?: boolean } = {}) => {
  const { bookId, segmentId } = await freshSegment();
  const kept = await recordTake(segmentId, { frames: 80, ...opts });
  const meta = (await getClipMeta(kept.clipId)) as ClipMeta;
  const pcm = new Int16Array(80).fill(1000);
  return { bookId, segmentId, kept, meta, pcm };
};

const rowsNow = async (): Promise<StoredPendingTake[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows;
};

const recordOf = async (
  clipId: ClipId
): Promise<TakeDisposition["kind"] | undefined> =>
  (await (await getDb()).get("takeDispositions", clipId))?.kind;

const clipPresent = async (clipId: ClipId) => {
  const db = await getDb();
  return {
    meta: (await db.get("clipMeta", clipId)) !== undefined,
    data: (await db.get("clipData", clipId)) !== undefined,
  };
};

/** Make the Nth put to `store` throw inside its transaction. */
const failPut = (
  store: string,
  error = new Error(`injected ${store} fault`)
) => {
  const realPut = IDBObjectStore.prototype.put;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === store) throw error;
    return realPut.apply(this, args);
  });
};

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the hold (§3, seven steps)", () => {
  it("writes the row with the revision its take was read at", async () => {
    const { segmentId } = await keptSegment();
    const t = take(segmentId, { baseRevision: 1 });
    expect(await writePendingTake(t)).toEqual({ ok: true, outcome: "written" });
    const [row] = await rowsNow();
    expect(row?.clipId).toBe(t.clipId);
    expect(row?.baseRevision).toBe(1);
  });

  it("a hold for a deleted segment writes no row", async () => {
    // DL-S.
    const { segmentId } = await freshSegment();
    await deleteSegment(segmentId);
    expect(await writePendingTake(take(segmentId))).toEqual({
      ok: true,
      outcome: "segment-gone",
    });
    expect(await rowsNow()).toEqual([]);
  });

  it("writes nothing for a take this copy has been asked to discard, or whose record says why it ended", async () => {
    const { segmentId } = await freshSegment();
    expect(
      await writePendingTake(take(segmentId), {
        isDiscardRequested: () => true,
      })
    ).toEqual({ ok: true, outcome: "discarded" });
    for (const kind of ["give-up", "discard"] as const) {
      const t = take(segmentId);
      await settlePendingTake(segmentId, t.clipId, kind);
      expect(await writePendingTake(t)).toEqual({
        ok: true,
        outcome: kind === "give-up" ? "given-up" : "discarded",
      });
    }
    const saved = take(segmentId);
    await saveTake(segmentId, saved.clipId, ramp(50), RATE);
    expect(await writePendingTake(saved)).toEqual({
      ok: true,
      outcome: "saved",
    });
    expect(await rowsNow()).toEqual([]);
  });

  it("a request for Discard outranks a given-up record", async () => {
    const { segmentId } = await freshSegment();
    const t = take(segmentId);
    await settlePendingTake(segmentId, t.clipId, "give-up");
    expect(
      await writePendingTake(t, { isDiscardRequested: () => true })
    ).toEqual({ ok: true, outcome: "discarded" });
  });

  it("a hold whose put runs out of room aborts alone, and the save after it lands", async () => {
    // Replaces the slice-1 pin "asks IndexedDB for pendingTakes only": the
    // property it protected, per the DRI's round-6 pick on #1546.
    const { segmentId } = await freshSegment();
    const t = take(segmentId);
    failPut(
      "pendingTakes",
      new DOMException("disk full", "QuotaExceededError")
    );
    const held = await writePendingTake(t);
    vi.restoreAllMocks();
    expect(held.ok).toBe(false);
    expect(await rowsNow()).toEqual([]);

    const saved = await saveTake(segmentId, t.clipId, ramp(50), RATE);
    expect(saved.outcome).toBe("saved");
    expect((await getSegment(segmentId))?.audioRevision).toBe(1);
  });

  it("a hold whose source clip is intact writes a stored base", async () => {
    const { segmentId, meta, pcm } = await keptSegment();
    await writePendingTake(take(segmentId, { existing: pcm }), {
      source: meta,
    });
    expect((await rowsNow())[0]?.base).toEqual({
      kind: "stored",
      sourceClipId: meta.id,
      generation: 0,
      frameCount: 80,
    });
  });

  it("a hold whose source clip was replaced before it ran writes an inline base", async () => {
    // Frank r4 on the note: the caller read K's clip, then another copy
    // replaced K (deleting that clip) before the hold's transaction ran.
    const { segmentId, meta, pcm } = await keptSegment();
    await recordTake(segmentId);
    expect(await clipPresent(meta.id)).toEqual({ meta: false, data: false });

    await writePendingTake(take(segmentId, { existing: pcm }), {
      source: meta,
    });
    const [row] = await rowsNow();
    expect(row?.base.kind).toBe("inline");
    expect(
      row?.base.kind === "inline" && new Int16Array(row.base.samples)
    ).toEqual(pcm);
  });

  it("a hold whose source clip was transcoded before it ran writes an inline base", async () => {
    const { segmentId, meta, pcm } = await keptSegment({ finished: true });
    expect(
      await commitTranscode(
        segmentId,
        meta.id,
        encodeMp3(pcm),
        computePeaks(pcm, 4)
      )
    ).toBe("committed");

    await writePendingTake(take(segmentId, { existing: pcm }), {
      source: meta,
    });
    expect((await rowsNow())[0]?.base.kind).toBe("inline");
  });
});

describe("the hold stamps the revision the base was read at (George r1 on #1618)", () => {
  /**
   * Cell HM in the note's §5: the editor read K's audio at revision r, then
   * another copy erased or replaced K before this copy's hold ran. The row
   * must name r, the revision its base belongs to, so the replay (PR 3) sees
   * the move; stamping the hold's own live read would claim the newer base.
   */
  it.each([
    ["an erase", (segmentId: SegmentId) => clearSegmentTake(segmentId)],
    [
      "a save",
      (segmentId: SegmentId) =>
        saveTake(segmentId, newClipId(), ramp(40), RATE).then(() => {}),
    ],
  ])(
    "%s that commits between the base read and the hold leaves the row on the base's revision",
    async (_name, move) => {
      const { segmentId, pcm } = await keptSegment();
      const observed = (await getSegment(segmentId))!.audioRevision;
      await move(segmentId);
      const live = (await getSegment(segmentId))!.audioRevision;
      expect(live).toBe(observed + 1);

      expect(
        await writePendingTake({
          ...take(segmentId, { existing: pcm }),
          baseRevision: observed,
        })
      ).toEqual({ ok: true, outcome: "written" });
      // What the replay will compare: the row at `observed`, the segment at
      // `observed + 1`, so the verdict is `moved`.
      expect((await rowsNow())[0]?.baseRevision).toBe(observed);
      expect((await getSegment(segmentId))?.audioRevision).toBe(observed + 1);
    }
  );

  it("holds a take whose revision is unknown with none, as a legacy row", async () => {
    // Fail-safe: the replay refuses a row with no revision (`legacy`, RP-P)
    // and keeps it, so the audio survives and is never spliced on a guess.
    const { segmentId } = await keptSegment();
    expect(
      await writePendingTake(take(segmentId, { baseRevision: null }))
    ).toEqual({ ok: true, outcome: "written" });
    const [row] = await rowsNow();
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("baseRevision");
  });
});

describe("the commit (NR-S)", () => {
  it("a save moves the revision, deletes its own row and records saved in the commit's transaction", async () => {
    const { segmentId } = await freshSegment();
    const t = take(segmentId);
    await writePendingTake(t);

    // A fault on the record put: nothing of the commit may land without it.
    failPut("takeDispositions");
    await expect(saveTake(segmentId, t.clipId, ramp(50), RATE)).rejects.toThrow(
      "injected takeDispositions fault"
    );
    vi.restoreAllMocks();
    expect((await rowsNow()).map((r) => r.clipId)).toEqual([t.clipId]);
    expect((await getSegment(segmentId))?.audioRevision).toBe(0);
    expect(await clipPresent(t.clipId)).toEqual({ meta: false, data: false });

    expect((await saveTake(segmentId, t.clipId, ramp(50), RATE)).outcome).toBe(
      "saved"
    );
    expect(await rowsNow()).toEqual([]);
    expect(await recordOf(t.clipId)).toBe("saved");
    expect((await getSegment(segmentId))?.audioRevision).toBe(1);
  });

  it("leaves another take's row alone", async () => {
    const { segmentId } = await freshSegment();
    const other = take(segmentId);
    await writePendingTake(other);
    await saveTake(segmentId, newClipId(), ramp(50), RATE);
    expect((await rowsNow()).map((r) => r.clipId)).toEqual([other.clipId]);
  });
});

describe("the settles: Discard and give-up (DL-X, TP-L)", () => {
  it("Discard records discarded with its row delete, and deletes an orphan clip only when no take names it", async () => {
    const { segmentId } = await freshSegment();
    const t = take(segmentId);
    await writePendingTake(t);
    // The bytes a failed attempt may have written: nothing names them.
    await storeOrphanClip(t.clipId, ramp(50));

    // A fault on the record put rolls the row delete back with it.
    failPut("takeDispositions");
    expect((await settlePendingTake(segmentId, t.clipId, "discard")).ok).toBe(
      false
    );
    vi.restoreAllMocks();
    expect((await rowsNow()).map((r) => r.clipId)).toEqual([t.clipId]);

    expect(await settlePendingTake(segmentId, t.clipId, "discard")).toEqual({
      ok: true,
    });
    expect(await rowsNow()).toEqual([]);
    expect(await recordOf(t.clipId)).toBe("discarded");
    expect(await clipPresent(t.clipId)).toEqual({ meta: false, data: false });
  });

  it("a Discard keeps a clip another copy already made the active take", async () => {
    // Frank r4 on #1546: the record stays `saved`, and the clip stays.
    const { segmentId } = await freshSegment();
    const t = take(segmentId);
    await saveTake(segmentId, t.clipId, ramp(50), RATE);
    await settlePendingTake(segmentId, t.clipId, "discard");
    expect(await recordOf(t.clipId)).toBe("saved");
    expect(await clipPresent(t.clipId)).toEqual({ meta: true, data: true });
  });

  it("a give-up deletes its row and records given-up; only a Discard or a save replaces that record", async () => {
    const { segmentId } = await freshSegment();
    const t = take(segmentId);
    await writePendingTake(t);
    await settlePendingTake(segmentId, t.clipId, "give-up");
    expect(await rowsNow()).toEqual([]);
    expect(await recordOf(t.clipId)).toBe("given-up");
    await settlePendingTake(segmentId, t.clipId, "discard");
    expect(await recordOf(t.clipId)).toBe("discarded");
    await settlePendingTake(segmentId, t.clipId, "give-up");
    expect(await recordOf(t.clipId)).toBe("discarded");
  });

  it("returns a failure instead of rejecting when the store throws", async () => {
    const { segmentId } = await freshSegment();
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "pendingTakes",
      new Error("boom")
    );
    const result = await settlePendingTake(segmentId, newClipId(), "discard");
    expect(result.ok).toBe(false);
  });
});

describe("a pending row's stored base clip is a use (RC-S)", () => {
  /** K active on S with clip X, and a row for C whose stored base is X. */
  const heldOverKept = async (opts: { finished?: boolean } = {}) => {
    const kept = await keptSegment(opts);
    const c = take(kept.segmentId, { existing: kept.pcm });
    await writePendingTake(c, { source: kept.meta });
    expect((await rowsNow())[0]?.base.kind).toBe("stored");
    return { ...kept, c, x: kept.meta.id };
  };

  /** K active on S with clip X, and a row on a segment in ANOTHER book whose
   * stored base is X: a use of X that deleting S, or S's book, leaves. */
  const heldElsewhere = async () => {
    const kept = await keptSegment();
    const { segmentId: other } = await freshSegment();
    const c = take(other, { existing: kept.pcm });
    await writePendingTake(c, { source: kept.meta });
    expect((await rowsNow()).map((r) => [r.segmentId, r.base.kind])).toEqual([
      [other, "stored"],
    ]);
    return { ...kept, c, x: kept.meta.id };
  };

  it("a save keeps the prior clip while a pending row's stored base names it, and deletes it when that row ends", async () => {
    const { segmentId, c, x } = await heldOverKept();
    // Another copy saves D over K: K's clip X is no longer any take's.
    await saveTake(segmentId, newClipId(), ramp(40), RATE);
    expect(await clipPresent(x)).toEqual({ meta: true, data: true });

    await settlePendingTake(segmentId, c.clipId, "give-up");
    expect(await clipPresent(x)).toEqual({ meta: false, data: false });
  });

  it("erase, segment delete, book delete and a Discard's orphan delete each keep a clip a row's stored base names", async () => {
    const erased = await heldOverKept();
    await clearSegmentTake(erased.segmentId);
    expect(await clipPresent(erased.x)).toEqual({ meta: true, data: true });

    // A segment or book delete drops the deleted segment's own row (RP-D,
    // below), so the row that keeps X here hangs off a segment in another
    // book that the delete does not touch.
    await clearAllStores();
    const segmentGone = await heldElsewhere();
    await deleteSegment(segmentGone.segmentId);
    expect(await clipPresent(segmentGone.x)).toEqual({
      meta: true,
      data: true,
    });

    await clearAllStores();
    const bookGone = await heldElsewhere();
    await deleteBook(bookGone.bookId);
    expect(await clipPresent(bookGone.x)).toEqual({ meta: true, data: true });

    // A Discard whose orphan is a clip another row's base names.
    await clearAllStores();
    const orphaned = await heldOverKept();
    await clearSegmentTake(orphaned.segmentId);
    const { segmentId: elsewhere } = await freshSegment();
    await settlePendingTake(elsewhere, orphaned.x, "discard");
    expect(await clipPresent(orphaned.x)).toEqual({ meta: true, data: true });
  });

  it("a transcode leaves a clip a row's stored base names as PCM", async () => {
    const { segmentId, x, pcm } = await heldOverKept({ finished: true });
    expect(
      await commitTranscode(segmentId, x, encodeMp3(pcm), computePeaks(pcm, 4))
    ).toBe("stale");
    expect((await getClipMeta(x))?.encoding).toBe("pcm");
  });
});

describe("deletes drop the disposition records (RP-D, the records half)", () => {
  it("deleting a segment, or its book, removes its takes' disposition records in the same transaction", async () => {
    const one = await freshSegment();
    const two = await freshSegment();
    const a = newClipId();
    const b = newClipId();
    await saveTake(one.segmentId, a, ramp(10), RATE);
    await saveTake(two.segmentId, b, ramp(10), RATE);

    // A fault on the tombstone rolls the record delete back with the segment.
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "tombstones",
      new Error("boom")
    );
    await expect(deleteSegment(one.segmentId)).rejects.toThrow("boom");
    vi.restoreAllMocks();
    expect(await recordOf(a)).toBe("saved");

    await deleteSegment(one.segmentId);
    expect(await recordOf(a)).toBeUndefined();
    expect(await recordOf(b)).toBe("saved");

    await deleteBook(two.bookId);
    expect(await recordOf(b)).toBeUndefined();
  });
});

describe("deletes drop the pending rows of the segments they delete (RP-D, the rows half)", () => {
  /** S with kept take K (clip X), a row for C whose stored base is X, and a
   * save of D over K by another copy: X is now named only by C's row. */
  const baseOnlyInRow = async () => {
    const kept = await keptSegment();
    const c = take(kept.segmentId, { existing: kept.pcm });
    await writePendingTake(c, { source: kept.meta });
    const d = newClipId();
    await saveTake(kept.segmentId, d, ramp(40), RATE);
    expect(await clipPresent(kept.meta.id)).toEqual({ meta: true, data: true });
    return { ...kept, c, d, x: kept.meta.id };
  };

  const rowClips = async (): Promise<ClipId[]> =>
    (await rowsNow()).map((r) => r.clipId).sort();

  it("deleting a segment removes its pending row and releases its base clip", async () => {
    const s = await baseOnlyInRow();
    // A row on another segment, which this delete must leave.
    const other = await freshSegment();
    const e = take(other.segmentId);
    await writePendingTake(e);

    // A fault on the tombstone rolls the row delete and the clip release back
    // with the segment: one transaction.
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "tombstones",
      new Error("boom")
    );
    await expect(deleteSegment(s.segmentId)).rejects.toThrow("boom");
    vi.restoreAllMocks();
    expect(await rowClips()).toEqual([s.c.clipId, e.clipId].sort());
    expect(await clipPresent(s.x)).toEqual({ meta: true, data: true });

    await deleteSegment(s.segmentId);
    expect(await rowClips()).toEqual([e.clipId]);
    expect(await clipPresent(s.x)).toEqual({ meta: false, data: false });
    expect(await clipPresent(s.d)).toEqual({ meta: false, data: false });

    // Idempotent: a second delete of the gone segment writes nothing.
    await expect(deleteSegment(s.segmentId)).resolves.toBeNull();
    expect(await rowClips()).toEqual([e.clipId]);
  });

  it("deleting a segment whose row's base is its own active clip leaves neither", async () => {
    const kept = await keptSegment();
    const c = take(kept.segmentId, { existing: kept.pcm });
    await writePendingTake(c, { source: kept.meta });

    await deleteSegment(kept.segmentId);
    expect(await rowsNow()).toEqual([]);
    expect(await clipPresent(kept.meta.id)).toEqual({
      meta: false,
      data: false,
    });
  });

  it("deleting a book removes the pending rows of its segments", async () => {
    const s = await baseOnlyInRow();
    // A second segment of the same book, with an inline row.
    const segment = await getSegment(s.segmentId);
    const sibling = await addSegment(segment!.chapterId);
    const f = take(sibling.id);
    await writePendingTake(f);
    // A segment in another book, whose row the delete must leave.
    const other = await freshSegment();
    const e = take(other.segmentId);
    await writePendingTake(e);

    throwWhenStoreRequested(
      unwrap(await getDb()),
      "tombstones",
      new Error("boom")
    );
    await expect(deleteBook(s.bookId)).rejects.toThrow("boom");
    vi.restoreAllMocks();
    expect(await rowClips()).toEqual([s.c.clipId, f.clipId, e.clipId].sort());
    expect(await clipPresent(s.x)).toEqual({ meta: true, data: true });

    await deleteBook(s.bookId);
    expect(await rowClips()).toEqual([e.clipId]);
    expect(await clipPresent(s.x)).toEqual({ meta: false, data: false });

    // Idempotent: a second delete of the gone book writes nothing.
    await deleteBook(s.bookId);
    expect(await rowClips()).toEqual([e.clipId]);
  });
});
