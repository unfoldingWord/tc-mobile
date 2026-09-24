import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { performErase } from "@/hooks/use-erase-segment";
import {
  addSegment,
  addChapter,
  addTake,
  createBook,
  getSegment,
} from "@/lib/storage/books";
import { getClip, getClipMeta, newClipId, putClip } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import type { SegmentId } from "@/types/domain";

/**
 * Lane E — the reusable erase hook.
 *
 * `useEraseSegment` is thin React glue (guard state, error state) over
 * `performErase`, which is the whole of the operation minus React. Nothing
 * mounts this hook's effect graph in this suite — the same boundary
 * `tests/audio-session.test.ts` documents — so the hook's `erasing` flag and
 * its double-tap guard (both `useRef`/`useState`) are NOT exercised here; they
 * are review + on-device surface. What IS node-testable is `performErase`: the
 * call it makes to the real store, the outcome that leaves, the success/failure
 * result it returns. That is what these cover, against fake-indexeddb through
 * the real store helpers.
 *
 * `performErase` wraps `clearSegmentTake`, whose own atomicity/ref-counting is
 * proved in `tests/storage.test.ts`; this file asserts the hook-owned contract
 * on top of it — that erase actually reaches that op and maps its results.
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A book → chapter → one segment carrying a real take + stored clip. */
const recordedSegment = async (): Promise<{
  segmentId: SegmentId;
  clipId: ReturnType<typeof newClipId>;
}> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  const clipId = newClipId();
  const meta = await putClip(clipId, samples(100), CANONICAL_SAMPLE_RATE);
  await addTake(segment.id, clipId, meta.durationMs);
  return { segmentId: segment.id, clipId };
};

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

describe("performErase", () => {
  it("erases the audio and returns the segment to not-started, clip gone", async () => {
    const { segmentId, clipId } = await recordedSegment();
    // Precondition: it really is recorded.
    const before = await getSegment(segmentId);
    expect(before?.activeTakeId).not.toBeNull();
    expect(before?.status).toBe("draft");
    expect(await getClipMeta(clipId)).toBeDefined();

    const result = await performErase(segmentId);

    expect(result).toEqual({ ok: true });

    const after = await getSegment(segmentId);
    expect(after?.activeTakeId).toBeNull(); // G4: audio gone, row kept
    expect(after?.status).toBe("not-started");
    // The clip's audio and metadata are both gone (nothing else referenced it).
    expect(await getClipMeta(clipId)).toBeUndefined();
    expect(await getClip(clipId)).toBeUndefined();
  });

  it("is a safe no-op on an already-empty segment", async () => {
    const { segmentId } = await recordedSegment();
    await performErase(segmentId); // now not-started

    const result = await performErase(segmentId);

    expect(result).toEqual({ ok: true });
    const after = await getSegment(segmentId);
    expect(after?.activeTakeId).toBeNull();
    expect(after?.status).toBe("not-started");
  });

  it("catches a store rejection and surfaces the reason", async () => {
    // A segment id with no row: `clearSegmentTake` throws "No such segment: …".
    // This is the failure path the hook maps to `error` and a `false` return.
    const bogus = newClipId() as unknown as SegmentId;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await performErase(bogus);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("No such segment");
    // Never swallowed silently: this site's own message, plus `reportFailure`'s
    // own internal `console.error` (#456) — the same "kept beside it, not
    // replaced" doubling `recorder-stop-backstop` (#480) already carries.
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('reports a store rejection to the funnel once, under "erase-segment" (#456)', async () => {
    const bogus = newClipId() as unknown as SegmentId;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performErase(bogus);

    off();
    consoleError.mockRestore();
    expect(reports.map((r) => r.context)).toEqual(["erase-segment"]);
  });

  it("reports nothing to the funnel on a successful erase (#456)", async () => {
    const { segmentId } = await recordedSegment();
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performErase(segmentId);

    off();
    expect(reports).toEqual([]);
  });
});
