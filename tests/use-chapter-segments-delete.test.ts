import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  patchDeletedSegment,
  useChapterSegments,
} from "@/hooks/use-chapter-segments";
import { reportFailure } from "@/hooks/report-failure";
import {
  addChapter,
  addSegment,
  createBook,
  deleteSegment,
  getChapter,
  getSegmentsOfChapter,
  moveSegment,
} from "@/lib/storage/books";
import type { ChapterId, Segment, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";
import { clearAllStores } from "./support";

/**
 * `useChapterSegments().deleteSegment` (#590 PR1) — the hook half of segment
 * delete. The store's `deleteSegment` is exercised for real over
 * fake-indexeddb (`tests/delete-segment.test.ts`); this file wraps it, and
 * `getSegmentsOfChapter`, so a test can make one reject or hold, following
 * the same harness `tests/use-chapter-segments-reorder.test.ts` uses for
 * `moveSegment`. The menu that would call this is a later PR; nothing here
 * mounts one.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    getSegmentsOfChapter: vi.fn(actual.getSegmentsOfChapter),
    deleteSegment: vi.fn(actual.deleteSegment),
    moveSegment: vi.fn(actual.moveSegment),
  };
});

const row = (id: string, ordinal: number): SegmentRow => ({
  segmentId: id as SegmentId,
  ordinal,
  label: null,
  hasClip: false,
  finished: false,
  clipId: null,
  peaks: null,
  durationMs: null,
});

describe("patchDeletedSegment", () => {
  const rows = [row("a", 1), row("b", 2), row("c", 3)];

  it("removes the row and renumbers the ordinals densely", () => {
    expect(
      patchDeletedSegment(rows, "b" as SegmentId).map((r) => [
        r.segmentId,
        r.ordinal,
      ])
    ).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("returns the rows themselves for an unknown id", () => {
    expect(patchDeletedSegment(rows, "zz" as SegmentId)).toBe(rows);
  });
});

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useChapterSegments> | null } = {
  current: null,
};

function Probe({ chapterId }: { chapterId: ChapterId }) {
  const result = useChapterSegments(chapterId);
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mountChapter(): Promise<{
  chapterId: ChapterId;
  segmentIds: SegmentId[];
}> {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  const segmentIds: SegmentId[] = [];
  for (let i = 0; i < 3; i++)
    segmentIds.push((await addSegment(chapter.id)).id);
  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  return { chapterId: chapter.id, segmentIds };
}

const rowsNow = () => hook().rows.map((r) => [r.segmentId, r.ordinal]);

describe("useChapterSegments().deleteSegment (#590)", () => {
  it("removes the row, renumbers the rest, and writes the store — no reload", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().deleteSegment(s2);
    });

    expect(ok).toBe(true);
    expect(rowsNow()).toEqual([
      [s1, 1],
      [s3, 2],
    ]);
    expect(hook().refreshing).toBe(false);
    expect((await getChapter(chapterId))!.segmentIds).toEqual([s1, s3]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports a failed delete as segment-delete, shows nothing extra, and restores the row via reload", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const cause = new Error("UnknownError: the transaction was aborted");
    vi.mocked(deleteSegment).mockRejectedValueOnce(cause);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().deleteSegment(s2);
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));

    expect(ok).toBe(false);
    expect(reportFailure).toHaveBeenCalledWith(cause, "segment-delete");
    // Nothing extra on screen (#172) — the row's return is the signal.
    expect(hook().error).toBeNull();
    expect(hook().staleTarget).toBe(false);
    expect(rowsNow()).toEqual([
      [s1, 1],
      [s2, 2],
      [s3, 3],
    ]);
  });

  it("treats a vanished chapter as a stale target, not a failure to log", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    vi.mocked(deleteSegment).mockRejectedValueOnce(
      new Error(`No such chapter: ${chapterId}`)
    );

    await act(async () => {
      await hook().deleteSegment(segmentIds[0]!);
    });

    expect(hook().staleTarget).toBe(true);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("does not let a load that read the pre-delete list repaint the deleted row", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    // Snapshot taken before the delete — all three segments still resolve.
    const stale = await getSegmentsOfChapter(chapterId);

    let releaseLoad!: (segments: Segment[]) => void;
    vi.mocked(getSegmentsOfChapter).mockImplementationOnce(
      () => new Promise<Segment[]>((resolve) => (releaseLoad = resolve))
    );
    await act(async () => {
      hook().reload();
    });
    await vi.waitFor(() => expect(releaseLoad).toBeDefined());

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = hook().deleteSegment(s2);
    });

    // The held load resolves with the STALE, pre-delete list — s2 included —
    // while the delete's own write is (for this instant) still in flight.
    await act(async () => {
      releaseLoad(stale);
      await pending;
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));

    expect(rowsNow()).toEqual([
      [s1, 1],
      [s3, 2],
    ]);
  });

  it("does not let a repeated (no-op) delete replace the landed order a stale load is corrected from", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const stale = await getSegmentsOfChapter(chapterId);

    let releaseLoad!: (segments: Segment[]) => void;
    vi.mocked(getSegmentsOfChapter).mockImplementationOnce(
      () => new Promise<Segment[]>((resolve) => (releaseLoad = resolve))
    );
    await act(async () => {
      hook().reload();
    });
    await vi.waitFor(() => expect(releaseLoad).toBeDefined());

    await act(async () => {
      await hook().deleteSegment(s2);
    });
    let again: boolean | undefined;
    await act(async () => {
      again = await hook().deleteSegment(s2);
    });
    await act(async () => {
      releaseLoad(stale);
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));

    expect(again).toBe(true);
    expect(rowsNow()).toEqual([
      [s1, 1],
      [s3, 2],
    ]);
  });

  it("does not let a failed move's older restore read paint over a delete that landed during it", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const stale = await getSegmentsOfChapter(chapterId);

    vi.mocked(moveSegment).mockRejectedValueOnce(new Error("aborted"));
    let releaseRestore!: (segments: Segment[]) => void;
    vi.mocked(getSegmentsOfChapter).mockImplementationOnce(
      () => new Promise<Segment[]>((resolve) => (releaseRestore = resolve))
    );
    let moved!: Promise<boolean>;
    await act(async () => {
      moved = hook().moveSegment(s3, 1);
    });
    await vi.waitFor(() => expect(releaseRestore).toBeDefined());

    await act(async () => {
      await hook().deleteSegment(s2);
    });
    await act(async () => {
      releaseRestore(stale);
      await moved;
    });

    expect(rowsNow()).toEqual([
      [s1, 1],
      [s3, 2],
    ]);
  });

  it("still ends on an empty list when the only segment is deleted", async () => {
    const { segmentIds } = await mountChapter();
    for (const id of segmentIds) {
      await act(async () => {
        await hook().deleteSegment(id);
      });
    }
    expect(hook().rows).toEqual([]);
  });
});
