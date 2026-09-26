import { describe, expect, it } from "vitest";

import { shareOverlayGlyph } from "@/components/share-overlay-glyph";
import {
  bookShareItems,
  chapterShareItems,
  shareO4View,
  type ShareChip,
  type ShareItem,
} from "@/components/share-o4-view";
import { SHARE_SETTLED, type ShareProgress } from "@/hooks/share-progress";
import { ENCODE_STEPS } from "@/lib/export/chapter";
import type { ChapterId, SegmentId } from "@/types/domain";
import type { ChapterRow, SegmentRow } from "@/types/view";

/**
 * What the O4 share circle draws for each overlay phase (#947, epic #936):
 * which glyph sits in the 140 core, how far the filling ring has gone, what
 * the core's progress bar reads, and one numbered chip per item. A plain
 * function, so the DRI's choices are behaviour a test calls, not JSX a test
 * reads.
 *
 * D13: the ring is driven by real progress (#986/#996). D14: after the
 * hand-off the circle shows the plain `check`, not #850's `share-sent`. D15:
 * while packing, the share glyph with the filling ring, and no interim look
 * (no chips, no static ring) before a real count exists. D16: the other
 * outcomes keep their #850 glyph. D21: one chip per item in order; an item
 * that does not go out stays grey with its number, finished ones show a
 * check, the one in progress is amber, and everything that goes out shows a
 * check once the file is handed over. D22: the core is a progress bar whose
 * value is done over total.
 */

type Busy = Extract<ShareProgress, { phase: "busy" }>;

function busy(steps?: Busy["steps"], work: Busy["work"] = "prepare"): Busy {
  return steps === undefined
    ? { phase: "busy", work, since: 0, pending: null }
    : { phase: "busy", work, since: 0, pending: null, steps };
}

/** Items from a compact pattern: `x` goes out, `.` does not; labels 1, 2, ... */
function items(pattern: string): ShareItem[] {
  return [...pattern].map((c, i) => ({ label: i + 1, goesOut: c === "x" }));
}

/** A chip row as a compact string: `-` stays, `o` waiting, `v` finished, `*` current. */
function row(chips: readonly ShareChip[]): string {
  const mark = { stays: "-", waiting: "o", finished: "v", current: "*" };
  return chips.map((c) => mark[c.state]).join("");
}

describe("shareO4View: the glyph in the core", () => {
  it("busy wears the plain share glyph (D15), not the current look's share-busy", () => {
    expect(shareO4View(busy(), "chapter").icon).toBe("share");
    expect(shareO4View(busy(undefined, "send"), "book").icon).toBe("share");
  });

  it("handed over wears the plain check (D14), not share-sent", () => {
    const view = shareO4View(
      { phase: "outcome", settled: "sent", since: 0 },
      "chapter"
    );
    expect(view.icon).toBe("check");
  });

  it("every other outcome keeps its #850 glyph unchanged (D16)", () => {
    for (const settled of SHARE_SETTLED) {
      if (settled === "sent") continue;
      const progress = { phase: "outcome", settled, since: 0 } as const;
      expect(shareO4View(progress, "book").icon).toBe(
        shareOverlayGlyph(progress).icon
      );
    }
  });
});

describe("shareO4View: the filling ring", () => {
  it("draws no ring and no chips before a real count exists (D15: no interim look)", () => {
    for (const progress of [busy(), busy(undefined, "send")]) {
      const view = shareO4View(progress, "chapter", items("xx"));
      expect(view.ring).toBeNull();
    }
    expect(shareO4View(busy(), "chapter", items("xx")).chips).toEqual([]);
  });

  it("fills by done over total, the whole count including the encode (#996)", () => {
    expect(shareO4View(busy({ done: 0, total: 4 }), "book").ring).toBe(0);
    expect(shareO4View(busy({ done: 1, total: 4 }), "book").ring).toBe(0.25);
    expect(shareO4View(busy({ done: 4, total: 4 }), "book").ring).toBe(1);
    const total = 3 + ENCODE_STEPS;
    expect(shareO4View(busy({ done: 3, total }), "chapter").ring).toBe(
      3 / total
    );
  });

  it("an outcome carries no progress ring — its rings are the outcome's own look", () => {
    for (const settled of SHARE_SETTLED) {
      const view = shareO4View({ phase: "outcome", settled, since: 0 }, "book");
      expect(view.ring).toBeNull();
    }
  });
});

describe("shareO4View: the core's progress bar (D22)", () => {
  it("reads done over total as a whole percent while a prepare counts", () => {
    expect(shareO4View(busy({ done: 1, total: 3 }), "book").meter).toEqual({
      now: 33,
    });
    expect(shareO4View(busy({ done: 2, total: 3 }), "book").meter).toEqual({
      now: 67,
    });
    expect(shareO4View(busy({ done: 0, total: 4 }), "book").meter).toEqual({
      now: 0,
    });
    const total = 3 + ENCODE_STEPS;
    expect(
      shareO4View(busy({ done: total, total, items: 3 }), "chapter").meter
    ).toEqual({ now: 100 });
  });

  it("is a progress bar with no value before the first count", () => {
    expect(shareO4View(busy(), "chapter").meter).toEqual({ now: null });
  });

  it("reads full while the file is being handed over", () => {
    expect(shareO4View(busy(undefined, "send"), "book").meter).toEqual({
      now: 100,
    });
  });

  it("is not a progress bar once an outcome shows", () => {
    for (const settled of SHARE_SETTLED)
      expect(
        shareO4View({ phase: "outcome", settled, since: 0 }, "book").meter
      ).toBeNull();
  });
});

describe("shareO4View: one numbered chip per item, in order (D21)", () => {
  it("keeps every item's own number and order, including the ones that stay", () => {
    const chips = shareO4View(
      busy({ done: 0, total: 2 + ENCODE_STEPS, items: 2 }),
      "chapter",
      items(".x.x")
    ).chips;
    expect(chips.map((c) => c.label)).toEqual([1, 2, 3, 4]);
    expect(row(chips)).toBe("-*-o");
  });

  it("a chapter counts only the segments that go out: done moves through them in order", () => {
    const total = 3 + ENCODE_STEPS;
    const view = (done: number) =>
      row(
        shareO4View(busy({ done, total, items: 3 }), "chapter", items("x.xx."))
          .chips
      );
    expect(view(0)).toBe("*-oo-");
    expect(view(1)).toBe("v-*o-");
    expect(view(2)).toBe("v-v*-");
    // Every segment gathered: all finished, none current, while the encode
    // still fills the ring.
    expect(view(3)).toBe("v-vv-");
    expect(view(3 + ENCODE_STEPS / 2)).toBe("v-vv-");
  });

  it("a book counts every chapter: an empty chapter passes as a grey step", () => {
    const view = (done: number) =>
      row(shareO4View(busy({ done, total: 4 }), "book", items("x.xx")).chips);
    expect(view(0)).toBe("*-oo");
    // Chapter 1 done; chapter 2 has no audio, so chapter 3 is the next to go.
    expect(view(1)).toBe("v-*o");
    expect(view(2)).toBe("v-*o");
    expect(view(3)).toBe("v-v*");
    expect(view(4)).toBe("v-vv");
  });

  it("everything that goes out shows a check at hand-over (busy send and sent)", () => {
    expect(
      row(shareO4View(busy(undefined, "send"), "book", items("x.x")).chips)
    ).toBe("v-v");
    expect(
      row(
        shareO4View(
          { phase: "outcome", settled: "sent", since: 0 },
          "chapter",
          items("x.x")
        ).chips
      )
    ).toBe("v-v");
  });

  it("draws no chips for any other outcome", () => {
    for (const settled of SHARE_SETTLED)
      if (settled !== "sent")
        expect(
          shareO4View(
            { phase: "outcome", settled, since: 0 },
            "book",
            items("xx")
          ).chips
        ).toEqual([]);
  });

  it("draws no chips without the screen's items", () => {
    expect(shareO4View(busy({ done: 1, total: 4 }), "book").chips).toEqual([]);
    expect(shareO4View(busy({ done: 1, total: 4 }), "book", []).chips).toEqual(
      []
    );
  });

  it("marks no chip current once the count is past its items, even if the screen holds more", () => {
    // The screen shows three segments with audio but the gather counted two
    // (one clip's record went missing between the two reads). In the encode
    // stretch nothing is being packed, so the third is not amber.
    expect(
      row(
        shareO4View(
          busy({
            done: 2 + ENCODE_STEPS / 2,
            total: 2 + ENCODE_STEPS,
            items: 2,
          }),
          "chapter",
          items("xxx")
        ).chips
      )
    ).toBe("vvo");
  });

  it("a count longer than the items the screen holds never runs past them", () => {
    expect(
      row(
        shareO4View(
          busy({ done: 3, total: 3 + ENCODE_STEPS, items: 3 }),
          "chapter",
          items("xx")
        ).chips
      )
    ).toBe("vv");
  });
});

describe("the items each screen hands the chips (D21)", () => {
  function segment(ordinal: number, hasClip: boolean): SegmentRow {
    return {
      segmentId: `s${ordinal}` as SegmentId,
      ordinal,
      label: null,
      hasClip,
      // A finished segment with no clip: `finished` must not decide it.
      finished: !hasClip,
      clipId: null,
      peaks: null,
      durationMs: null,
    };
  }

  function chapter(n: number, recordedCount: number): ChapterRow {
    return {
      chapterId: `c${n}` as ChapterId,
      number: n,
      name: null,
      // Finished and total counts that disagree with recordedCount, so
      // neither can stand in for it.
      finishedCount: recordedCount === 0 ? 2 : 0,
      totalCount: 3,
      recordedCount,
    };
  }

  it("Share Chapter: every segment row in order, out when it has playable audio", () => {
    expect(
      chapterShareItems([segment(1, true), segment(2, false), segment(3, true)])
    ).toEqual([
      { label: 1, goesOut: true },
      { label: 2, goesOut: false },
      { label: 3, goesOut: true },
    ]);
  });

  it("Share Book: every chapter in order, out when it holds a recorded take", () => {
    expect(
      bookShareItems([chapter(1, 2), chapter(2, 0), chapter(5, 1)])
    ).toEqual([
      { label: 1, goesOut: true },
      { label: 2, goesOut: false },
      { label: 5, goesOut: true },
    ]);
  });
});
