import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applySegmentOrder,
  patchMovedSegment,
  useChapterSegments,
} from "@/hooks/use-chapter-segments";
import { reportFailure } from "@/hooks/report-failure";
import {
  addChapter,
  addSegment,
  createBook,
  getChapter,
  getSegmentsOfChapter,
  moveSegment,
} from "@/lib/storage/books";
import type { ChapterId, Segment, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";
import { clearAllStores } from "./support";

/**
 * `useChapterSegments().moveSegment` (#953 PR1) — the hook half of segment
 * reorder.
 *
 * The hook runs for real over fake-indexeddb (the `segment-rename-failure`
 * harness); the store's `moveSegment` and `getSegmentsOfChapter` are wrapped
 * so a test can make one reject or hold. The gesture is PR2.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    getSegmentsOfChapter: vi.fn(actual.getSegmentsOfChapter),
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

describe("patchMovedSegment", () => {
  const rows = [row("a", 1), row("b", 2), row("c", 3)];

  it("moves the row and renumbers the ordinals densely", () => {
    expect(
      patchMovedSegment(rows, "c" as SegmentId, 0).map((r) => [
        r.segmentId,
        r.ordinal,
      ])
    ).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("returns the rows themselves for a drop where it started, or an unknown row", () => {
    expect(patchMovedSegment(rows, "b" as SegmentId, 1)).toBe(rows);
    expect(patchMovedSegment(rows, "zz" as SegmentId, 0)).toBe(rows);
  });
});

describe("applySegmentOrder", () => {
  it("orders the rows as the store does and takes the stored index", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 3)];
    const next = applySegmentOrder(rows, [
      { id: "b" as SegmentId, index: 1 },
      { id: "a" as SegmentId, index: 2 },
    ]);
    // "c" was not returned: it keeps a place after the returned rows.
    expect(next.map((r) => [r.segmentId, r.ordinal])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
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

describe("useChapterSegments().moveSegment (#953)", () => {
  it("moves and renumbers the rows and writes the store, without a reload", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().moveSegment(s3, 0);
    });

    expect(ok).toBe(true);
    expect(rowsNow()).toEqual([
      [s3, 1],
      [s1, 2],
      [s2, 3],
    ]);
    expect(hook().refreshing).toBe(false);
    expect((await getChapter(chapterId))!.segmentIds).toEqual([s3, s1, s2]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("aligns with the store's order when another copy moved a segment first", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const real = (
      await vi.importActual<typeof import("@/lib/storage/books")>(
        "@/lib/storage/books"
      )
    ).moveSegment;
    // A second copy of the app moves s1 to the end; this screen still shows
    // [s1, s2, s3]. Stored visible order is now [s2, s3, s1].
    await real(s1, 2);

    await act(async () => {
      await hook().moveSegment(s3, 0);
    });

    // The store applied s3 -> 0 to ITS order: [s3, s2, s1].
    expect(rowsNow()).toEqual([
      [s3, 1],
      [s2, 2],
      [s1, 3],
    ]);
  });

  it("reports a failed move as segment-reorder, shows nothing, and restores the stored order", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const cause = new Error("UnknownError: the transaction was aborted");
    vi.mocked(moveSegment).mockRejectedValueOnce(cause);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().moveSegment(s3, 0);
    });

    expect(ok).toBe(false);
    expect(reportFailure).toHaveBeenCalledWith(cause, "segment-reorder");
    // Nothing extra on screen (#172).
    expect(hook().error).toBeNull();
    expect(hook().staleTarget).toBe(false);
    expect(rowsNow()).toEqual([
      [s1, 1],
      [s2, 2],
      [s3, 3],
    ]);
  });

  it("treats a vanished segment as a stale target, not a failure to log", async () => {
    const { segmentIds } = await mountChapter();
    vi.mocked(moveSegment).mockRejectedValueOnce(
      new Error(`No such segment: ${segmentIds[2]}`)
    );

    await act(async () => {
      await hook().moveSegment(segmentIds[2]!, 0);
    });

    expect(hook().staleTarget).toBe(true);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("does not let a load that read the pre-move order snap the row back", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];

    // A reload is in flight, holding a segment read taken BEFORE the move.
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
      await hook().moveSegment(s3, 0);
    });
    await act(async () => {
      releaseLoad(stale);
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));

    expect(rowsNow()).toEqual([
      [s3, 1],
      [s1, 2],
      [s2, 3],
    ]);
  });

  it("replays the move over a load that starts DURING the write", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const real = (
      await vi.importActual<typeof import("@/lib/storage/books")>(
        "@/lib/storage/books"
      )
    ).moveSegment;
    let releaseWrite!: () => void;
    vi.mocked(moveSegment).mockImplementationOnce(
      (id, to) =>
        new Promise((resolve, reject) => {
          releaseWrite = () => {
            real(id, to).then(resolve, reject);
          };
        })
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = hook().moveSegment(s3, 0);
    });

    // The write has not been issued, so this load reads the pre-move order.
    await act(async () => {
      hook().reload();
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));
    expect(rowsNow()).toEqual([
      [s3, 1],
      [s1, 2],
      [s2, 3],
    ]);

    await act(async () => {
      releaseWrite();
      await pending;
    });
  });

  it("stops replaying a landed move once a later load has read the store", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    await act(async () => {
      await hook().moveSegment(s3, 0);
    });
    // A second copy moves s3 back to the end after this move landed.
    const real = (
      await vi.importActual<typeof import("@/lib/storage/books")>(
        "@/lib/storage/books"
      )
    ).moveSegment;
    await real(s3, 2);

    await act(async () => {
      hook().reload();
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));

    // The load's read is newer than the move: the store wins.
    expect(rowsNow()).toEqual([
      [s1, 1],
      [s2, 2],
      [s3, 3],
    ]);
  });

  // Frank round 1 (bench fix): a load that started before two moves may read
  // the store before, between, or after them. Replaying both absolute moves
  // over a read that already holds them put s3 first — [s3, s1, s2] — while
  // the store held [s1, s3, s2].
  for (const readAt of ["before", "between", "after"] as const) {
    it(`shows the stored order when a racing load read ${readAt} two landed moves`, async () => {
      const { chapterId, segmentIds } = await mountChapter();
      const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
      const real = (
        await vi.importActual<typeof import("@/lib/storage/books")>(
          "@/lib/storage/books"
        )
      ).getSegmentsOfChapter;
      let releaseLoad!: (segments: Segment[]) => void;
      vi.mocked(getSegmentsOfChapter).mockImplementationOnce(
        () => new Promise<Segment[]>((resolve) => (releaseLoad = resolve))
      );
      await act(async () => {
        hook().reload();
      });
      await vi.waitFor(() => expect(releaseLoad).toBeDefined());

      let read: Segment[] | undefined;
      if (readAt === "before") read = await real(chapterId);
      await act(async () => {
        await hook().moveSegment(s1, 1); // [s2, s1, s3]
      });
      if (readAt === "between") read = await real(chapterId);
      await act(async () => {
        await hook().moveSegment(s2, 2); // [s1, s3, s2]
      });
      if (readAt === "after") read = await real(chapterId);
      await act(async () => {
        releaseLoad(read!);
      });
      await vi.waitFor(() => expect(hook().refreshing).toBe(false));

      expect((await getChapter(chapterId))!.segmentIds).toEqual([s1, s3, s2]);
      expect(rowsNow()).toEqual([
        [s1, 1],
        [s3, 2],
        [s2, 3],
      ]);
    });
  }

  // George round 1 #1 (bench fix): the first move landing must not paint
  // over a second move whose write is still in flight.
  it("keeps a still-in-flight move on screen when an earlier move lands", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    const real = (
      await vi.importActual<typeof import("@/lib/storage/books")>(
        "@/lib/storage/books"
      )
    ).moveSegment;
    const releases: (() => void)[] = [];
    const held = (id: SegmentId, to: number) =>
      new Promise<Awaited<ReturnType<typeof real>>>((resolve, reject) => {
        releases.push(() => {
          real(id, to).then(resolve, reject);
        });
      });
    vi.mocked(moveSegment)
      .mockImplementationOnce(held)
      .mockImplementationOnce(held);

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = hook().moveSegment(s3, 0); // [s3, s1, s2]
      second = hook().moveSegment(s1, 2); // [s3, s2, s1]
    });
    await act(async () => {
      releases[0]!();
      await first;
    });
    expect(rowsNow()).toEqual([
      [s3, 1],
      [s2, 2],
      [s1, 3],
    ]);

    await act(async () => {
      releases[1]!();
      await second;
    });
    expect(rowsNow()).toEqual([
      [s3, 1],
      [s2, 2],
      [s1, 3],
    ]);
  });

  // George round 1 #2 (bench fix): a non-integer target is refused before
  // any state is touched, not thrown from inside a React updater.
  it("refuses a non-integer target without touching the rows", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook().moveSegment(s3, 0.5);
    });

    expect(ok).toBe(false);
    expect(moveSegment).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(
      expect.any(RangeError),
      "segment-reorder"
    );
    expect(rowsNow()).toEqual([
      [s1, 1],
      [s2, 2],
      [s3, 3],
    ]);
  });

  // Frank round 2 (bench fix): a failed move's restore read that began
  // before a later move landed must not paint the rows back over that move.
  it("does not let a failed move's restore overwrite a move that landed during it", async () => {
    const { chapterId, segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    vi.mocked(moveSegment).mockRejectedValueOnce(new Error("aborted"));
    // The restore reads [s1, s2, s3] and is held there.
    const stale = await getSegmentsOfChapter(chapterId);
    let releaseRestore!: () => void;
    vi.mocked(getSegmentsOfChapter).mockImplementationOnce(
      () =>
        new Promise<Segment[]>((resolve) => {
          releaseRestore = () => resolve(stale);
        })
    );

    let failed!: Promise<boolean>;
    await act(async () => {
      failed = hook().moveSegment(s3, 0);
    });
    await vi.waitFor(() => expect(releaseRestore).toBeDefined());

    // A later move lands while the restore is held: [s2, s3, s1].
    await act(async () => {
      expect(await hook().moveSegment(s1, 2)).toBe(true);
    });
    await act(async () => {
      releaseRestore();
      expect(await failed).toBe(false);
    });

    expect(rowsNow()).toEqual([
      [s2, 1],
      [s3, 2],
      [s1, 3],
    ]);
  });

  it("never replays a move that failed", async () => {
    const { segmentIds } = await mountChapter();
    const [s1, s2, s3] = segmentIds as [SegmentId, SegmentId, SegmentId];
    vi.mocked(moveSegment).mockRejectedValueOnce(new Error("aborted"));
    await act(async () => {
      await hook().moveSegment(s3, 0);
    });

    await act(async () => {
      hook().reload();
    });
    await vi.waitFor(() => expect(hook().refreshing).toBe(false));

    expect(rowsNow()).toEqual([
      [s1, 1],
      [s2, 2],
      [s3, 3],
    ]);
  });
});
