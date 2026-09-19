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
 * `performErase`, which is the whole of the operation minus React. This repo
 * has no jsdom and no renderer — the same constraint `tests/audio-session.test.ts`
 * and `tests/save-failure.test.ts` document — so the hook's `erasing` flag and
 * its double-tap guard (both `useRef`/`useState`) are NOT exercised here; they
 * are review + on-device surface. What IS node-testable is `performErase`: the
 * call it makes to the real store, the outcome that leaves, the success/failure
 * result it returns, and the `onErased` fire. That is what these cover, against
 * fake-indexeddb through the real store helpers.
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

    const onErased = vi.fn();
    const result = await performErase(segmentId, onErased);

    expect(result).toEqual({ ok: true });
    expect(onErased).toHaveBeenCalledTimes(1);

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

    const onErased = vi.fn();
    const result = await performErase(segmentId, onErased);

    expect(result).toEqual({ ok: true });
    expect(onErased).toHaveBeenCalledTimes(1);
    const after = await getSegment(segmentId);
    expect(after?.activeTakeId).toBeNull();
    expect(after?.status).toBe("not-started");
  });

  it("keeps a committed delete a success even when onErased throws", async () => {
    // The delete is irreversible once clearSegmentTake commits, so a failing
    // notification (a reload that threw, say) must NOT report the erase as
    // failed and invite a retry against an already-cleared segment (Frank R-B6).
    const { segmentId, clipId } = await recordedSegment();
    const onErased = vi.fn(() => {
      throw new Error("reload failed");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reports: FailureReport[] = [];
    const stopSink = subscribeToFailures((r) => reports.push(r));

    const result = await performErase(segmentId, onErased);

    // The throwing callback does not turn a committed deletion into a failure.
    expect(result).toEqual({ ok: true });
    expect(onErased).toHaveBeenCalledTimes(1);
    // And the audio really is gone — the store op ran to completion.
    const after = await getSegment(segmentId);
    expect(after?.activeTakeId).toBeNull();
    expect(await getClipMeta(clipId)).toBeUndefined();
    // The notification failure is logged, never swallowed.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();

    // The store op itself committed — this is the notification-failure site
    // (`"Post-erase notification failed"`), not the store-failure one #456
    // routes. Only the latter reports to the funnel.
    expect(reports).toEqual([]);
    stopSink();
  });

  it("catches a store rejection, surfaces the reason, and does not fire onErased", async () => {
    // A segment id with no row: `clearSegmentTake` throws "No such segment: …".
    // This is the failure path the hook maps to `error` and a `false` return.
    const bogus = newClipId() as unknown as SegmentId;
    const onErased = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await performErase(bogus, onErased);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("No such segment");
    expect(onErased).not.toHaveBeenCalled();
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
