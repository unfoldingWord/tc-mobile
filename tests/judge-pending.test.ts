import { describe, expect, it } from "vitest";

import { judgePending } from "@/lib/takes/judge-pending";
import type {
  ClipId,
  Segment,
  SegmentId,
  StoredPendingTake,
  TakeDisposition,
} from "@/types/domain";

/**
 * `judgePending`, the one ownership verdict (#38, #1557;
 * docs/design/pending-take-lifecycle.md §4): each row of the note's table,
 * and the order between rows that can both hold.
 */

const C = "clip-c" as ClipId;
const D = "clip-d" as ClipId;
const S = "seg" as SegmentId;

const segment = (audioRevision: number): Segment =>
  ({ id: S, activeTakeId: null, audioRevision }) as unknown as Segment;

const row = (
  clipId: ClipId,
  refusal?: StoredPendingTake["refusal"]
): StoredPendingTake =>
  ({
    segmentId: S,
    clipId,
    ...(refusal ? { refusal } : {}),
  }) as unknown as StoredPendingTake;

const record = (kind: TakeDisposition["kind"]): TakeDisposition => ({
  clipId: C,
  segmentId: S,
  kind,
  at: 0,
});

const take = { clipId: C, baseRevision: 3 };

describe("judgePending", () => {
  it("gone: the segment is missing, whatever else holds", () => {
    expect(judgePending(undefined, C, row(C), record("saved"), take)).toBe(
      "gone"
    );
  });

  it("done: the take is the active clip, or a record says saved", () => {
    expect(judgePending(segment(3), C, undefined, undefined, take)).toBe(
      "done"
    );
    expect(
      judgePending(segment(3), null, undefined, record("saved"), take)
    ).toBe("done");
  });

  it("done comes before moved: a take another copy saved moved the revision itself", () => {
    expect(judgePending(segment(4), C, undefined, record("saved"), take)).toBe(
      "done"
    );
  });

  it("discarded: a record says so, or this copy asked, and a given-up record never hides the ask", () => {
    expect(
      judgePending(segment(3), null, undefined, record("discarded"), take)
    ).toBe("discarded");
    expect(
      judgePending(segment(3), null, row(C), record("given-up"), take, true)
    ).toBe("discarded");
  });

  it("discarded comes before moved and free", () => {
    expect(
      judgePending(segment(9), null, row(C), record("discarded"), take)
    ).toBe("discarded");
  });

  it("moved: the revision is not the one the base was read at, even with the take's own row", () => {
    expect(judgePending(segment(4), null, row(C), undefined, take)).toBe(
      "moved"
    );
    expect(judgePending(segment(2), D, row(C), undefined, take)).toBe("moved");
  });

  it("free: the take's own unmarked row", () => {
    expect(judgePending(segment(3), null, row(C), undefined, take)).toBe(
      "free"
    );
  });

  it("free: no row at all, and a record says the row was given up for quota", () => {
    expect(
      judgePending(segment(3), null, undefined, record("given-up"), take)
    ).toBe("free");
  });

  it("unexplained: no row and no record (absence is never consent)", () => {
    expect(judgePending(segment(3), null, undefined, undefined, take)).toBe(
      "unexplained"
    );
  });

  it("unexplained: another clip's row holds the segment, even after a give-up", () => {
    expect(judgePending(segment(3), null, row(D), undefined, take)).toBe(
      "unexplained"
    );
    expect(
      judgePending(segment(3), null, row(D), record("given-up"), take)
    ).toBe("unexplained");
  });

  it("unexplained: the take's own row, already marked refused", () => {
    expect(
      judgePending(segment(3), null, row(C, "superseded"), undefined, take)
    ).toBe("unexplained");
  });
});
