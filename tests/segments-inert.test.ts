import { describe, expect, it } from "vitest";

import {
  segmentsListInert,
  type SegmentsOverlayState,
} from "@/components/segments-inert";

/**
 * The Segments screen's `inert` decision (#452 PR4, Frank R1 P2-1).
 *
 * **What this file is for, said before the rows so nobody mistakes it for
 * testing a disjunction.** The operator is `||` and nobody needed a test for
 * that. What these rows pin is the SET of terms — that these four conditions,
 * and no fewer, take the header and list out of the focus and pointer tree.
 *
 * That set is load-bearing beyond accessibility. `dismissOverlays()`
 * (`segments-screen.tsx`) deliberately leaves an erase confirm standing while
 * its `clearSegmentTake` commits, rather than tearing the dialog down over a
 * write it cannot recall — and the reason that is safe, rather than a window in
 * which the confirm has lost its `Layer`, is that `eraseConfirmOpen` keeps the
 * Record control unreachable for exactly as long as the erase runs. Delete that
 * term and the argument is silently false: a tap on Record would open the
 * recorder over a committing delete of the very row it opens.
 *
 * Each row isolates one term of the predicate. These pure-function tests do
 * not establish that the screen applies the result to the DOM or that the
 * browser blocks focus and pointer events during an erase.
 */

const nothingOpen: SegmentsOverlayState = {
  eraseConfirmOpen: false,
  rowMenuOpen: false,
  chapterMenuOpen: false,
  shareOwnsScreen: false,
};

describe("segmentsListInert", () => {
  it("leaves the screen live when nothing is open — the resting state, and the row that stops every other row passing vacuously", () => {
    expect(segmentsListInert(nothingOpen)).toBe(false);
  });

  /**
   * One row per term. The mutation each kills is the deletion of its own term:
   * with that term removed from `segmentsListInert`, its row reads `false` and
   * dies, and no other row moves.
   */
  const terms: readonly {
    readonly term: keyof SegmentsOverlayState;
    readonly why: string;
  }[] = [
    {
      term: "eraseConfirmOpen",
      why: "the term Amendment C's erase-in-flight decision rests on: it must hold for the whole of `clearSegmentTake`, not just while the dialog awaits a tap",
    },
    {
      term: "rowMenuOpen",
      why: "the menu is portalled out of the list, so the list behind it stays reachable unless this says otherwise",
    },
    {
      term: "chapterMenuOpen",
      why: "the same, for the chapter-level menu — the one term case (m) also proves end to end in a browser",
    },
    {
      term: "shareOwnsScreen",
      why: "the share modal outlives `chapterMenuOpen` (#491), through the busy hold and the outcome hold, and a screen reader's gesture navigation never dispatches the Tab keydowns it intercepts",
    },
  ];

  for (const { term, why } of terms) {
    it(`inerts the screen on ${term} alone — ${why}`, () => {
      expect(segmentsListInert({ ...nothingOpen, [term]: true })).toBe(true);
    });
  }

  it("inerts on any combination — an overlay opening over another never un-inerts the screen between them", () => {
    expect(
      segmentsListInert({
        eraseConfirmOpen: true,
        rowMenuOpen: true,
        chapterMenuOpen: false,
        shareOwnsScreen: false,
      })
    ).toBe(true);
    expect(
      segmentsListInert({
        eraseConfirmOpen: false,
        rowMenuOpen: false,
        chapterMenuOpen: true,
        shareOwnsScreen: true,
      })
    ).toBe(true);
  });
});
