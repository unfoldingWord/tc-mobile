import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { shareProgressText } from "@/components/share-error-copy";
import { shareView, type ShareView } from "@/components/share-view";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * The share circle as the panel actually emits it (#947, states 15/G7):
 * the numbered chips (D21), the 140 core inside the 176 frame, the filling
 * ring, and the core's progress bar (D22). `shareView`
 * (tests/share-view.test.ts) decides WHAT to draw; this proves the panel
 * draws it. tests/share-progress-design-switch.test.ts proves the real
 * `ShareProgress` hands the panel that view.
 */

const TEXT = "Preparing the chapter to share";

function drawPanel(
  view: Partial<ShareView>,
  role: "status" | "alert" = "status"
) {
  return render(
    createElement(ShareProgressPanel, {
      role,
      text: TEXT,
      view: { icon: "share", ring: null, meter: null, chips: [], ...view },
    })
  );
}

describe("ShareProgressPanel draws the O4 circle", () => {
  it("draws the glyph inside the core, inside the 176 frame", () => {
    const container = drawPanel({});
    const frame = one(container, ".share-frame");
    const core = one(frame, ".share-core");
    one(core, "svg.share-glyph");
    // The line under the circle is unchanged and still carries the words.
    expect(one(container, ".share-progress-text").textContent).toBe(TEXT);
  });

  it("with no count, draws no ring and no chip row (D15: no interim look)", () => {
    const container = drawPanel({ meter: { now: null } });
    expect(container.querySelector(".share-ring")).toBeNull();
    expect(container.querySelector(".share-chips")).toBeNull();
  });

  it("fills the ring by the fraction, on a 176 circle of radius 84", () => {
    const container = drawPanel({ ring: 0.25 });
    const ring = one(container, "svg.share-ring");
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    one(ring, "circle.share-track");
    const fill = one(ring, "circle.share-fill");
    const length = 2 * Math.PI * 84;
    expect(Number(fill.getAttribute("stroke-dasharray"))).toBeCloseTo(length);
    expect(Number(fill.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      length * 0.75
    );
  });

  it("a full ring leaves no gap, and an empty one shows none of the fill", () => {
    const offset = (ring: number) =>
      Number(
        one(drawPanel({ ring }), "circle.share-fill").getAttribute(
          "stroke-dashoffset"
        )
      );
    expect(offset(1)).toBeCloseTo(0);
    expect(offset(0)).toBeCloseTo(2 * Math.PI * 84);
  });
});

describe("the core's progress bar (D22)", () => {
  it("is the core, labelled from strings.ts, valued 0 to 100", () => {
    const container = drawPanel({ ring: 0.5, meter: { now: 50 } });
    const bar = one(container, "[role='progressbar']");
    expect(bar.classList.contains("share-core")).toBe(true);
    expect(bar.getAttribute("aria-label")).toBe(strings.sharePreparingLabel);
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("carries no value before the first count", () => {
    const bar = one(
      drawPanel({ meter: { now: null } }),
      "[role='progressbar']"
    );
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("is absent when the view has no meter (an outcome other than handed over)", () => {
    const container = drawPanel({ meter: null });
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(one(container, ".share-core").hasAttribute("aria-label")).toBe(
      false
    );
  });

  it("keeps the panel's role, focus target and words; the ring and chips stay hidden", () => {
    const container = drawPanel(
      {
        ring: 0.5,
        meter: { now: 50 },
        chips: [{ label: 1, state: "finished" }],
      },
      "alert"
    );
    const panel = one(container, ".share-progress");
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.getAttribute("tabindex")).toBe("-1");
    expect(panel.textContent).toBe(TEXT);
    one(container, "svg.share-ring[aria-hidden='true']");
    for (const chip of container.querySelectorAll(".share-chip"))
      expect(chip.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the numbered chips (D21)", () => {
  const chips: ShareView["chips"] = [
    { label: 1, state: "finished" },
    { label: 2, state: "stays" },
    { label: 3, state: "current" },
    { label: 4, state: "waiting" },
  ];

  it("draws one chip per item, in order, above the circle", () => {
    const container = drawPanel({ ring: 0.2, meter: { now: 20 }, chips });
    const panel = one(container, ".share-progress");
    const kids = [...panel.children].map((c) => c.getAttribute("class"));
    expect(kids.indexOf("share-chips")).toBeLessThan(
      kids.indexOf("share-frame")
    );
    const drawn = [...container.querySelectorAll(".share-chip")];
    expect(drawn.map((c) => c.getAttribute("data-chip"))).toEqual([
      "finished",
      "stays",
      "current",
      "waiting",
    ]);
  });

  it("a finished chip shows a check; every other chip shows its own number", () => {
    const drawn = [...drawPanel({ chips }).querySelectorAll(".share-chip")];
    expect(drawn[0]!.querySelector("svg")).not.toBeNull();
    expect(drawn[0]!.textContent).toBe("");
    expect(drawn.slice(1).map((c) => c.textContent)).toEqual(["2", "3", "4"]);
  });

  it("the group is labelled with how many of all the items go out", () => {
    const group = one(drawPanel({ chips }), ".share-chips");
    // One announced image: the chips inside it are decorative.
    expect(group.getAttribute("role")).toBe("img");
    expect(group.getAttribute("aria-label")).toBe(
      strings.shareItemsGoOut(3, 4)
    );
    expect(strings.shareItemsGoOut(3, 4)).toBe("3 of 4 go out");
  });

  /**
   * The verb agrees with how many go out, not with how many there are, and
   * the choice is `plural`'s rather than a fixed English "go" (#169). A
   * one-chapter book that goes out whole is "1 of 1", the commonest single
   * case, and read "1 of 1 go out" while the label was one template.
   */
  it("agrees the verb with the count that goes out", () => {
    expect(strings.shareItemsGoOut(1, 1)).toBe("1 of 1 goes out");
    expect(strings.shareItemsGoOut(1, 4)).toBe("1 of 4 goes out");
    expect(strings.shareItemsGoOut(0, 4)).toBe("0 of 4 go out");
    expect(strings.shareItemsGoOut(2, 2)).toBe("2 of 2 go out");
  });
});

describe("the progress bar's name at 100 follows the visible status (DRI pick (c))", () => {
  it("uses the panel's own status words when the view says so (send and sent)", () => {
    const bar = one(
      drawPanel({ meter: { now: 100 }, meterFromStatus: true }),
      "[role='progressbar']"
    );
    expect(bar.getAttribute("aria-label")).toBe(TEXT);
  });

  it("keeps the preparing label otherwise", () => {
    const bar = one(drawPanel({ meter: { now: 100 } }), "[role='progressbar']");
    expect(bar.getAttribute("aria-label")).toBe(strings.sharePreparingLabel);
  });

  it("names the hand-off and sent meters with the words shareProgressText shows", () => {
    for (const progress of [
      { phase: "busy", work: "send", since: 0, pending: null } as const,
      { phase: "outcome", settled: "sent", since: 0 } as const,
    ]) {
      const text = shareProgressText(progress, "book");
      const container = render(
        createElement(ShareProgressPanel, {
          role: "status",
          text,
          view: shareView(progress, "book", []),
        })
      );
      const bar = one(container, "[role='progressbar']");
      expect(bar.getAttribute("aria-label")).toBe(text);
      expect(bar.getAttribute("aria-label")).not.toBe(
        strings.sharePreparingLabel
      );
    }
  });
});

describe("a skipped item at the hand-off (the carried hollow snapshot)", () => {
  it("is neither checked nor counted in 'N of M go out'", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        text: TEXT,
        view: shareView(
          {
            phase: "busy",
            work: "send",
            since: 0,
            pending: null,
            carried: { hollow: [1] },
          },
          "book",
          [1, 2, 3].map((label) => ({ label, goesOut: true, key: `c${label}` }))
        ),
      })
    );
    const drawn = [...container.querySelectorAll(".share-chip")];
    expect(drawn.map((c) => c.getAttribute("data-chip"))).toEqual([
      "finished",
      "stays",
      "finished",
    ]);
    expect(one(container, ".share-chips").getAttribute("aria-label")).toBe(
      strings.shareItemsGoOut(2, 3)
    );
  });
});

describe("a long book's chips (DRI pick (a), bounded and scrolling)", () => {
  it("keeps every chip, and still draws the circle and the status line", () => {
    const chips: ShareView["chips"] = Array.from({ length: 150 }, (_, i) => ({
      label: i + 1,
      state: i === 120 ? "current" : "waiting",
    }));
    const container = drawPanel({ ring: 0.8, meter: { now: 80 }, chips });
    const group = one(container, ".share-chips");
    expect(group.querySelectorAll(".share-chip")).toHaveLength(150);
    one(container, ".share-frame .share-core");
    expect(one(container, ".share-progress-text").textContent).toBe(TEXT);
  });
});
