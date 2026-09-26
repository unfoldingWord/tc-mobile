import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { shareProgressText } from "@/components/share-error-copy";
import { shareO4View, type ShareO4View } from "@/components/share-o4-view";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * The O4 share circle as the panel actually emits it (#947, states 15/G7):
 * the numbered chips (D21), the 140 core inside the 176 frame, the filling
 * ring, and the core's progress bar (D22). `shareO4View`
 * (tests/share-o4-view.test.ts) decides WHAT to draw; this proves the panel
 * draws it, and that with no `o4` view the panel draws only the current
 * look's glyph and text. It does not compare against the base branch's
 * markup; tests/share-progress-design-switch.test.ts proves the switch is
 * what withholds the `o4` view.
 */

const TEXT = "Preparing the chapter to share";

function current() {
  return render(
    createElement(ShareProgressPanel, {
      role: "status",
      icon: "share-busy",
      text: TEXT,
    })
  );
}

function o4(view: Partial<ShareO4View>, role: "status" | "alert" = "status") {
  return render(
    createElement(ShareProgressPanel, {
      role,
      icon: "share-busy",
      text: TEXT,
      o4: { icon: "share", ring: null, meter: null, chips: [], ...view },
    })
  );
}

describe("ShareProgressPanel with the switch off", () => {
  it("renders only the current look's glyph and text, with no O4 node", () => {
    const container = current();
    const panel = one(container, ".share-progress");
    expect([...panel.children].map((c) => c.getAttribute("class"))).toEqual([
      "share-progress-glyph",
      "share-progress-text",
    ]);
    expect(container.querySelector("[class*='share-o4']")).toBeNull();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
  });

  it("is identical whether `o4` is left out or passed as undefined", () => {
    const withUndefined = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: TEXT,
        o4: undefined,
      })
    );
    expect(withUndefined.innerHTML).toBe(current().innerHTML);
  });
});

describe("ShareProgressPanel under O4", () => {
  it("draws the glyph inside the core, inside the 176 frame", () => {
    const container = o4({});
    const frame = one(container, ".share-o4-frame");
    const core = one(frame, ".share-o4-core");
    one(core, "svg.share-o4-glyph");
    // The current look's glyph class is absent, so none of its per-outcome
    // inks or its spin reach the O4 glyph.
    expect(container.querySelector(".share-progress-glyph")).toBeNull();
    // The line under the circle is unchanged and still carries the words.
    expect(one(container, ".share-progress-text").textContent).toBe(TEXT);
  });

  it("with no count, draws no ring and no chip row (D15: no interim look)", () => {
    const container = o4({ meter: { now: null } });
    expect(container.querySelector(".share-o4-ring")).toBeNull();
    expect(container.querySelector(".share-o4-chips")).toBeNull();
  });

  it("fills the ring by the fraction, on a 176 circle of radius 84", () => {
    const container = o4({ ring: 0.25 });
    const ring = one(container, "svg.share-o4-ring");
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    one(ring, "circle.share-o4-track");
    const fill = one(ring, "circle.share-o4-fill");
    const length = 2 * Math.PI * 84;
    expect(Number(fill.getAttribute("stroke-dasharray"))).toBeCloseTo(length);
    expect(Number(fill.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      length * 0.75
    );
  });

  it("a full ring leaves no gap, and an empty one shows none of the fill", () => {
    const offset = (ring: number) =>
      Number(
        one(o4({ ring }), "circle.share-o4-fill").getAttribute(
          "stroke-dashoffset"
        )
      );
    expect(offset(1)).toBeCloseTo(0);
    expect(offset(0)).toBeCloseTo(2 * Math.PI * 84);
  });
});

describe("the core's progress bar (D22)", () => {
  it("is the core, labelled from strings.ts, valued 0 to 100", () => {
    const container = o4({ ring: 0.5, meter: { now: 50 } });
    const bar = one(container, "[role='progressbar']");
    expect(bar.classList.contains("share-o4-core")).toBe(true);
    expect(bar.getAttribute("aria-label")).toBe(strings.sharePreparingLabel);
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("carries no value before the first count", () => {
    const bar = one(o4({ meter: { now: null } }), "[role='progressbar']");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("is absent when the view has no meter (an outcome other than handed over)", () => {
    const container = o4({ meter: null });
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(one(container, ".share-o4-core").hasAttribute("aria-label")).toBe(
      false
    );
  });

  it("keeps the panel's role, focus target and words; the ring and chips stay hidden", () => {
    const container = o4(
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
    one(container, "svg.share-o4-ring[aria-hidden='true']");
    for (const chip of container.querySelectorAll(".share-o4-chip"))
      expect(chip.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the numbered chips (D21)", () => {
  const chips: ShareO4View["chips"] = [
    { label: 1, state: "finished" },
    { label: 2, state: "stays" },
    { label: 3, state: "current" },
    { label: 4, state: "waiting" },
  ];

  it("draws one chip per item, in order, above the circle", () => {
    const container = o4({ ring: 0.2, meter: { now: 20 }, chips });
    const panel = one(container, ".share-progress");
    const kids = [...panel.children].map((c) => c.getAttribute("class"));
    expect(kids.indexOf("share-o4-chips")).toBeLessThan(
      kids.indexOf("share-o4-frame")
    );
    const drawn = [...container.querySelectorAll(".share-o4-chip")];
    expect(drawn.map((c) => c.getAttribute("data-chip"))).toEqual([
      "finished",
      "stays",
      "current",
      "waiting",
    ]);
  });

  it("a finished chip shows a check; every other chip shows its own number", () => {
    const drawn = [...o4({ chips }).querySelectorAll(".share-o4-chip")];
    expect(drawn[0]!.querySelector("svg")).not.toBeNull();
    expect(drawn[0]!.textContent).toBe("");
    expect(drawn.slice(1).map((c) => c.textContent)).toEqual(["2", "3", "4"]);
  });

  it("the group is labelled with how many of all the items go out", () => {
    const group = one(o4({ chips }), ".share-o4-chips");
    // One announced image: the chips inside it are decorative.
    expect(group.getAttribute("role")).toBe("img");
    expect(group.getAttribute("aria-label")).toBe(
      strings.shareItemsGoOut(3, 4)
    );
    expect(strings.shareItemsGoOut(3, 4)).toBe("3 of 4 go out");
  });
});

describe("the progress bar's name at 100 follows the visible status (DRI pick (c))", () => {
  it("uses the panel's own status words when the view says so (send and sent)", () => {
    const bar = one(
      o4({ meter: { now: 100 }, meterFromStatus: true }),
      "[role='progressbar']"
    );
    expect(bar.getAttribute("aria-label")).toBe(TEXT);
  });

  it("keeps the preparing label otherwise", () => {
    const bar = one(o4({ meter: { now: 100 } }), "[role='progressbar']");
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
          icon: "share",
          text,
          o4: shareO4View(progress, "book", []),
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
        icon: "share",
        text: TEXT,
        o4: shareO4View(
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
    const drawn = [...container.querySelectorAll(".share-o4-chip")];
    expect(drawn.map((c) => c.getAttribute("data-chip"))).toEqual([
      "finished",
      "stays",
      "finished",
    ]);
    expect(one(container, ".share-o4-chips").getAttribute("aria-label")).toBe(
      strings.shareItemsGoOut(2, 3)
    );
  });
});

describe("a long book's chips (DRI pick (a), bounded and scrolling)", () => {
  it("keeps every chip, and still draws the circle and the status line", () => {
    const chips: ShareO4View["chips"] = Array.from({ length: 150 }, (_, i) => ({
      label: i + 1,
      state: i === 120 ? "current" : "waiting",
    }));
    const container = o4({ ring: 0.8, meter: { now: 80 }, chips });
    const group = one(container, ".share-o4-chips");
    expect(group.querySelectorAll(".share-o4-chip")).toHaveLength(150);
    one(container, ".share-o4-frame .share-o4-core");
    expect(one(container, ".share-progress-text").textContent).toBe(TEXT);
  });
});
