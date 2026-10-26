import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { getClipMeta, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import {
  encodePendingBase,
  listPendingTakes,
  loadPendingRecipe,
  writePendingTake,
} from "@/lib/storage/pending-takes";
import { saveTake } from "@/lib/storage/takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type { SegmentId, StoredPendingTake } from "@/types/domain";
import {
  clearAllStores,
  ramp,
  recordTake,
  savedTake,
  throwWhenStoreRequested,
} from "./support";

/**
 * The pending-take store (#38, slice 1): the write and read of one take
 * whose save has not landed, in v12's `pendingTakes` store, and the stored |
 * inline base encoding (the DRI's 2026-10-19 pick, shape in
 * docs/design/v12-schema.md, "The pending-takes store"). The v13 lifecycle
 * (the hold's seven steps, the settles, the records) is pinned in
 * `tests/pending-lifecycle-store.test.ts`.
 *
 * Node, fake-indexeddb, every store cleared between cases.
 */

const RATE = CANONICAL_SAMPLE_RATE;

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
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
  baseGeneration: null,
  ...overrides,
});

/** The stored clip behind a segment's current take, as the recorder read it. */
const recordedSegment = async (frames = 80) => {
  const segmentId = await freshSegment();
  const t = await recordTake(segmentId, { frames });
  const meta = (await getClipMeta(t.clipId)) as ClipMeta;
  const pcm = new Int16Array(frames).fill(1000);
  return { segmentId, meta, pcm };
};

const rows = async (): Promise<StoredPendingTake[]> => {
  const listed = await listPendingTakes();
  if (!listed.ok) throw listed.cause;
  return listed.rows;
};

/** The one row the store holds; throws on none or several. */
const onlyRow = async (): Promise<StoredPendingTake> => {
  const all = await rows();
  const [row] = all;
  if (all.length !== 1 || !row) throw new Error(`${all.length} rows`);
  return row;
};

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encodePendingBase — stored | inline", () => {
  it("is stored only for the unchanged stored PCM clip", async () => {
    const { meta, pcm } = await recordedSegment();
    expect(encodePendingBase(pcm, false, meta)).toEqual({
      kind: "stored",
      sourceClipId: meta.id,
      generation: meta.generation,
      frameCount: meta.frameCount,
    });
  });

  it("is inline with an empty buffer for a first take", () => {
    const base = encodePendingBase(new Int16Array(0), false, null);
    expect(base.kind).toBe("inline");
    expect(base.kind === "inline" && base.samples.byteLength).toBe(0);
  });

  it("is inline for an edit-only save even when a source is offered", async () => {
    const { meta, pcm } = await recordedSegment();
    const base = encodePendingBase(pcm, true, meta);
    expect(base.kind).toBe("inline");
    expect(base.kind === "inline" && new Int16Array(base.samples)).toEqual(pcm);
  });

  it("is inline when the clip is an MP3 (a Finished segment)", async () => {
    const { meta, pcm } = await recordedSegment();
    const mp3: ClipMeta = { ...meta, encoding: "mp3", generation: 1 };
    expect(encodePendingBase(pcm, false, mp3).kind).toBe("inline");
  });

  it("is inline when the buffer length is not the clip's frame count", async () => {
    const { meta, pcm } = await recordedSegment();
    const edited = pcm.subarray(10);
    const base = encodePendingBase(edited, false, meta);
    expect(base.kind).toBe("inline");
    // Copied through a fresh buffer: a trimmed view does not carry its
    // whole backing buffer into the row.
    expect(base.kind === "inline" && base.samples.byteLength).toBe(
      edited.byteLength
    );
  });
});

describe("writePendingTake — get-or-create in one transaction", () => {
  it("writes the row, with recorded copied through a fresh buffer", async () => {
    const segmentId = await freshSegment();
    const backing = ramp(100);
    const t = take(segmentId, {
      recorded: backing.subarray(20, 70),
      offset: 3,
    });
    const result = await writePendingTake(t, { now: 5 });
    expect(result).toEqual({ ok: true, outcome: "written" });
    const row = await onlyRow();
    expect(row).toMatchObject({
      segmentId,
      ordinal: 1,
      clipId: t.clipId,
      sampleRate: RATE,
      offset: 3,
      finished: false,
      editOnly: false,
      createdAt: 5,
    });
    expect(row.recorded.byteLength).toBe(50 * 2);
    expect(new Int16Array(row.recorded)).toEqual(backing.subarray(20, 70));
  });

  it("is a no-op for the same clipId again (a retry keeps the first row)", async () => {
    const segmentId = await freshSegment();
    const t = take(segmentId);
    await writePendingTake(t, { now: 5 });
    const again = await writePendingTake(
      { ...t, recorded: ramp(10, 7) },
      { now: 9 }
    );
    expect(again).toEqual({ ok: true, outcome: "kept" });
    const row = await onlyRow();
    expect(row.createdAt).toBe(5);
    expect(row.recorded.byteLength).toBe(50 * 2);
  });

  it("a hold never overwrites another take's row", async () => {
    // RP-S, the hold half (docs/design/pending-take-lifecycle.md §3 step 5):
    // the row there may be another take's only copy, so neither an older nor
    // a newer write replaces it.
    const segmentId = await freshSegment();
    const first = take(segmentId);
    await writePendingTake(first, { now: 10 });
    expect(await writePendingTake(take(segmentId), { now: 20 })).toEqual({
      ok: true,
      outcome: "kept-foreign",
    });
    expect(await writePendingTake(take(segmentId), { now: 5 })).toEqual({
      ok: true,
      outcome: "kept-foreign",
    });
    expect((await rows()).map((r) => r.clipId)).toEqual([first.clipId]);
  });

  it("keeps one row per segment", async () => {
    const a = await freshSegment();
    const b = await freshSegment();
    await writePendingTake(take(a), { now: 1 });
    await writePendingTake(take(b), { now: 2 });
    expect((await rows()).map((r) => r.segmentId).sort()).toEqual(
      [a, b].sort()
    );
  });

  it("lets a saveTake started while it is still in flight land", async () => {
    const segmentId = await freshSegment();
    const t = take(segmentId);
    const write = writePendingTake(t, { now: 1 });
    const saved = savedTake(
      await saveTake(segmentId, t.clipId, ramp(50), RATE)
    );
    expect(saved.clipId).toBe(t.clipId);
    expect(await write).toEqual({ ok: true, outcome: "written" });
  });

  it("returns a failure instead of rejecting when the store throws", async () => {
    const segmentId = await freshSegment();
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "pendingTakes",
      new Error("boom")
    );
    const result = await writePendingTake(take(segmentId), { now: 1 });
    expect(result.ok).toBe(false);
    expect(!result.ok && String(result.cause)).toContain("boom");
  });

  it("returns a failure instead of throwing when building the row throws", async () => {
    const segmentId = await freshSegment();
    // Stands in for an allocation failure while copying the recipe on a
    // low-memory phone: any throw while the row is built.
    const unreadable = Object.defineProperty(take(segmentId), "recorded", {
      get: () => {
        throw new RangeError("out of memory");
      },
    });
    let result: Awaited<ReturnType<typeof writePendingTake>> | undefined;
    expect(() => {
      void writePendingTake(unreadable, { now: 1 }).then((r) => (result = r));
    }).not.toThrow();
    await vi.waitFor(() => expect(result).toBeDefined());
    expect(result?.ok).toBe(false);
    expect(await rows()).toEqual([]);
  });
});

describe("listPendingTakes", () => {
  it("returns a failure instead of rejecting when the store throws", async () => {
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "pendingTakes",
      new Error("boom")
    );
    const result = await listPendingTakes();
    expect(result.ok).toBe(false);
  });
});

describe("loadPendingRecipe — reading a row back", () => {
  const writeAndRead = async (t: NewTake, source: ClipMeta | null = null) => {
    await writePendingTake(t, { now: 1, source });
    const row = await onlyRow();
    return row;
  };

  it("rebuilds an inline recipe", async () => {
    const segmentId = await freshSegment();
    const existing = ramp(30, 5);
    const t = take(segmentId, { existing, offset: 12 });
    const row = await writeAndRead(t);
    const recipe = await loadPendingRecipe(row, RATE);
    expect(recipe).toMatchObject({
      kind: "recipe",
      take: {
        segmentId,
        ordinal: 1,
        clipId: t.clipId,
        offset: 12,
        finished: false,
        editOnly: false,
      },
    });
    if (recipe.kind !== "recipe") throw new Error("expected a recipe");
    expect(recipe.take.existing).toEqual(existing);
    expect(recipe.take.recorded).toEqual(t.recorded);
  });

  it("rebuilds a stored recipe from the clip it names", async () => {
    const { segmentId, meta, pcm } = await recordedSegment();
    const row = await writeAndRead(take(segmentId, { existing: pcm }), meta);
    expect(row.base.kind).toBe("stored");
    const recipe = await loadPendingRecipe(row, RATE);
    if (recipe.kind !== "recipe") throw new Error(`refused: ${recipe.kind}`);
    expect(recipe.take.existing).toEqual(pcm);
  });

  it("refuses a stored base whose clip is no longer PCM", async () => {
    const { segmentId, meta, pcm } = await recordedSegment();
    const row = await writeAndRead(take(segmentId, { existing: pcm }), meta);
    const db = await getDb();
    // Generation left as it was, so this case isolates the encoding check;
    // a real transcode also bumps it, which the next case covers.
    await db.put("clipMeta", { ...meta, encoding: "mp3" });
    expect((await loadPendingRecipe(row, RATE)).kind).toBe("base-changed");
  });

  it("refuses a stored base whose generation moved", async () => {
    const { segmentId, meta, pcm } = await recordedSegment();
    const row = await writeAndRead(take(segmentId, { existing: pcm }), meta);
    const db = await getDb();
    await db.put("clipMeta", { ...meta, generation: meta.generation + 1 });
    expect((await loadPendingRecipe(row, RATE)).kind).toBe("base-changed");
  });

  it("refuses a stored base whose frame count moved", async () => {
    const { segmentId, meta, pcm } = await recordedSegment();
    const row = await writeAndRead(take(segmentId, { existing: pcm }), meta);
    const db = await getDb();
    await db.put("clipMeta", { ...meta, frameCount: meta.frameCount + 1 });
    expect((await loadPendingRecipe(row, RATE)).kind).toBe("base-changed");
  });

  it("refuses a stored base whose clip is gone", async () => {
    const { segmentId, meta, pcm } = await recordedSegment();
    const row = await writeAndRead(take(segmentId, { existing: pcm }), meta);
    const db = await getDb();
    await db.delete("clipData", meta.id);
    expect((await loadPendingRecipe(row, RATE)).kind).toBe("base-missing");
  });

  it("reads a recipe even when the segment's take is already this clip: the commit's verdict decides (#1557)", async () => {
    const segmentId = await freshSegment();
    const t = take(segmentId);
    const row = await writeAndRead(t);
    await saveTake(segmentId, t.clipId, ramp(50), RATE);
    expect((await loadPendingRecipe(row, RATE)).kind).toBe("recipe");
  });

  it("refuses a row whose segment is gone", async () => {
    const segmentId = await freshSegment();
    const row = await writeAndRead(take(segmentId));
    const db = await getDb();
    await db.delete("segments", segmentId);
    expect((await loadPendingRecipe(row, RATE)).kind).toBe("segment-gone");
  });

  it("refuses a row written at another sample rate", async () => {
    const segmentId = await freshSegment();
    const row = await writeAndRead(take(segmentId));
    expect((await loadPendingRecipe(row, 22_050)).kind).toBe("sample-rate");
  });

  it("returns a failure instead of rejecting when the read throws", async () => {
    const segmentId = await freshSegment();
    const row = await writeAndRead(take(segmentId));
    throwWhenStoreRequested(
      unwrap(await getDb()),
      "segments",
      new Error("boom")
    );
    const result = await loadPendingRecipe(row, RATE);
    expect(result.kind).toBe("failed");
  });
});
