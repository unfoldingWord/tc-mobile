import { describe, expect, it } from "vitest";

import { shareOverlayGlyph } from "@/components/share-overlay-glyph";
import { shareO4View } from "@/components/share-o4-view";
import { SHARE_SETTLED, type ShareProgress } from "@/hooks/share-progress";
import { ENCODE_STEPS } from "@/lib/export/chapter";

/**
 * What the O4 share circle draws for each overlay phase (#947, epic #936):
 * which glyph sits in the 140 core, how far the filling ring has gone, and
 * one dot per item. A plain function, so the D13/D14/D15/D16 choices are
 * behaviour a test calls, not JSX a test reads.
 *
 * D13: the ring and dots are driven by real progress (#986/#996), and
 * skipped items draw as hollow dots. D14: after the hand-off the circle shows
 * the plain `check`, not #850's `share-sent`. D15: while packing, the share
 * glyph, with the filling ring, and no interim look (no dots, no static ring)
 * before a real count exists. D16: the other outcomes keep their #850 glyph.
 */

type Busy = Extract<ShareProgress, { phase: "busy" }>;

function busy(steps?: Busy["steps"], work: Busy["work"] = "prepare"): Busy {
  return steps === undefined
    ? { phase: "busy", work, since: 0, pending: null }
    : { phase: "busy", work, since: 0, pending: null, steps };
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
  it("draws no ring and no dots before a real count exists (D15: no interim look)", () => {
    for (const progress of [busy(), busy(undefined, "send")]) {
      const view = shareO4View(progress, "chapter");
      expect(view.ring).toBeNull();
      expect(view.dots).toEqual([]);
    }
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
      expect(view.dots).toEqual([]);
    }
  });
});

describe("shareO4View: one dot per item", () => {
  it("a book has one dot per chapter: finished filled, the rest empty", () => {
    expect(shareO4View(busy({ done: 2, total: 5 }), "book").dots).toEqual([
      "filled",
      "filled",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("skipped items draw hollow (D13), and the count still completes", () => {
    expect(
      shareO4View(busy({ done: 3, total: 4, skipped: 1 }), "book").dots
    ).toEqual(["filled", "filled", "hollow", "empty"]);
    expect(
      shareO4View(busy({ done: 4, total: 4, skipped: 4 }), "book").dots
    ).toEqual(["hollow", "hollow", "hollow", "hollow"]);
    expect(
      shareO4View(busy({ done: 0, total: 2, skipped: 0 }), "book").dots
    ).toEqual(["empty", "empty"]);
  });

  it("a chapter has one dot per segment: the encode steps are not items", () => {
    const total = 3 + ENCODE_STEPS;
    expect(shareO4View(busy({ done: 1, total }), "chapter").dots).toEqual([
      "filled",
      "empty",
      "empty",
    ]);
    // Every segment gathered, half the encode done: every dot is finished
    // while the ring is still short of full.
    const halfway = shareO4View(
      busy({ done: 3 + ENCODE_STEPS / 2, total, skipped: 1 }),
      "chapter"
    );
    expect(halfway.dots).toEqual(["filled", "filled", "hollow"]);
    expect(halfway.ring).toBeLessThan(1);
  });

  it("a chapter count with no segments in it draws no dots", () => {
    expect(
      shareO4View(busy({ done: 0, total: ENCODE_STEPS }), "chapter").dots
    ).toEqual([]);
  });
});
