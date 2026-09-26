import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { performDeleteSegment } from "@/hooks/use-delete-segment";
import {
  addSegment,
  addChapter,
  createBook,
  deleteSegment,
  getSegment,
} from "@/lib/storage/books";
import { addTake } from "@/lib/storage/takes";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { newClipId, putClip } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import type { SegmentId } from "@/types/domain";

// Only `deleteSegment` (`lib/storage/books.ts`) is wrapped, and only the one
// quota test below overrides it — every other case calls straight through to
// the real store op, the same selective-mock shape
// `tests/use-erase-segment.test.ts` uses for `clearSegmentTake`.
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    deleteSegment: vi.fn(actual.deleteSegment),
  };
});

/**
 * `performDeleteSegment` — the whole of the delete-segment operation (#590)
 * minus React. `useDeleteSegment`'s own guard state (`deleting`/`isDeleting`)
 * is thin React glue over this and is exercised through the mounted `Recorder`
 * instead: `tests/recorder-delete-segment.test.ts` covers the confirm wiring,
 * the exit-on-success post-condition and the Back-race guard.
 *
 * `lib/storage/books.ts`'s own `deleteSegment` — the atomic transaction, the
 * renumber, the reference-counted clip delete — is proved in
 * `tests/delete-segment.test.ts` (PR1, #590/#1059); this file asserts the
 * hook-owned contract on top of it: that a delete actually reaches that op,
 * and maps its outcome the same way `performErase` does (#172).
 */

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

const oneSegmentChapter = async (): Promise<{ segmentId: SegmentId }> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return { segmentId: segment.id };
};

const recordedSegment = async (): Promise<{ segmentId: SegmentId }> => {
  const { segmentId } = await oneSegmentChapter();
  const clipId = newClipId();
  const meta = await putClip(clipId, samples(100), CANONICAL_SAMPLE_RATE);
  await addTake(segmentId, clipId, meta.durationMs);
  return { segmentId };
};

beforeEach(async () => {
  // Clear every store rather than deleting the database: `deleteDatabase`
  // blocks while any connection is open (AGENTS.md, mirrored from
  // tests/storage.test.ts and tests/use-erase-segment.test.ts).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("performDeleteSegment", () => {
  it("removes the segment row, on a never-recorded segment (#590's own field-tester ask)", async () => {
    const { segmentId } = await oneSegmentChapter();
    expect(await getSegment(segmentId)).toBeDefined();

    const result = await performDeleteSegment(segmentId);

    expect(result).toEqual({ ok: true });
    expect(await getSegment(segmentId)).toBeUndefined();
  });

  it("removes a recorded segment's row, take and clip together", async () => {
    const { segmentId } = await recordedSegment();

    const result = await performDeleteSegment(segmentId);

    expect(result).toEqual({ ok: true });
    expect(await getSegment(segmentId)).toBeUndefined();
  });

  it("is a safe no-op on an already-deleted segment — the store's own idempotency", async () => {
    const { segmentId } = await oneSegmentChapter();
    await performDeleteSegment(segmentId);

    const result = await performDeleteSegment(segmentId);

    expect(result).toEqual({ ok: true });
  });

  it("catches a store rejection and maps it to the deleteSegmentFailed KEY — never the raw store message (#172)", async () => {
    // A segment id with no chapter behind it after the row read: forcing the
    // real store's "No such chapter" throw would need a second live copy
    // deleting the parent mid-call, which this file cannot stage without its
    // own mock of `getSegment`. The one throw this store call is documented
    // to make from a live tree is exactly that, so a bogus id (never having
    // existed) is the reachable equivalent here: the mocked `deleteSegment`
    // is told to reject directly, the same shape
    // `tests/use-erase-segment.test.ts` uses for its own "no such segment"
    // case.
    const bogus = newClipId() as unknown as SegmentId;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(deleteSegment).mockRejectedValueOnce(
      new Error(`No such chapter: bogus`)
    );

    const result = await performDeleteSegment(bogus);

    expect(result).toEqual({ ok: false, key: "deleteSegmentFailed" });
    if (!result.ok)
      expect(JSON.stringify(result)).not.toContain("No such chapter");
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("maps a quota-exceeded store rejection to the noRoom KEY, not deleteSegmentFailed (#172)", async () => {
    const { segmentId } = await oneSegmentChapter();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(deleteSegment).mockRejectedValueOnce(
      Object.assign(new Error("disk full"), { name: "QuotaExceededError" })
    );

    const result = await performDeleteSegment(segmentId);

    expect(result).toEqual({ ok: false, key: "noRoom" });
    consoleError.mockRestore();
  });

  it('reports a store rejection to the funnel once, under "segment-delete" (#456, #590)', async () => {
    const { segmentId } = await oneSegmentChapter();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(deleteSegment).mockRejectedValueOnce(new Error("boom"));
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performDeleteSegment(segmentId);

    off();
    consoleError.mockRestore();
    expect(reports.map((r) => r.context)).toEqual(["segment-delete"]);
  });

  it("reports nothing to the funnel on a successful delete (#456)", async () => {
    const { segmentId } = await oneSegmentChapter();
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));

    await performDeleteSegment(segmentId);

    off();
    expect(reports).toEqual([]);
  });
});
