import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { ShareProgressPanel } from "@/components/share-progress-panel";

import { one, render } from "./render";

/**
 * The O4 share circle as the panel actually emits it (#947, states 15/G7):
 * the 140 core inside the 176 frame, the filling ring, and one dot per item.
 * `shareO4View` (tests/share-o4-view.test.ts) decides WHAT to draw; this
 * proves the panel draws it, and that with no `o4` view the panel's markup is
 * exactly what it was, which is how the switch-off look stays unchanged.
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

describe("ShareProgressPanel with the switch off", () => {
  it("renders the same markup it always did, with no O4 node", () => {
    const container = current();
    const panel = one(container, ".share-progress");
    expect([...panel.children].map((c) => c.getAttribute("class"))).toEqual([
      "share-progress-glyph",
      "share-progress-text",
    ]);
    expect(container.querySelector("[class*='share-o4']")).toBeNull();
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
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: TEXT,
        o4: { icon: "share", ring: null, dots: [] },
      })
    );
    const frame = one(container, ".share-o4-frame");
    const core = one(frame, ".share-o4-core");
    one(core, "svg.share-o4-glyph");
    // The current look's glyph class is absent, so none of its per-outcome
    // inks or its spin reach the O4 glyph.
    expect(container.querySelector(".share-progress-glyph")).toBeNull();
    // The line under the circle is unchanged and still carries the words.
    expect(one(container, ".share-progress-text").textContent).toBe(TEXT);
  });

  it("with no count, draws no ring and no dot row (D15: no interim look)", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: TEXT,
        o4: { icon: "share", ring: null, dots: [] },
      })
    );
    expect(container.querySelector(".share-o4-ring")).toBeNull();
    expect(container.querySelector(".share-o4-dots")).toBeNull();
  });

  it("fills the ring by the fraction, on a 176 circle of radius 84", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: TEXT,
        o4: { icon: "share", ring: 0.25, dots: ["filled", "empty"] },
      })
    );
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
        one(
          render(
            createElement(ShareProgressPanel, {
              role: "status",
              icon: "share-busy",
              text: TEXT,
              o4: { icon: "share", ring, dots: ["filled"] },
            })
          ),
          "circle.share-o4-fill"
        ).getAttribute("stroke-dashoffset")
      );
    expect(offset(1)).toBeCloseTo(0);
    expect(offset(0)).toBeCloseTo(2 * Math.PI * 84);
  });

  it("draws one dot per item, each carrying its state; hollow for skipped (D13)", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: TEXT,
        o4: {
          icon: "share",
          ring: 0.5,
          dots: ["filled", "hollow", "empty", "empty"],
        },
      })
    );
    const row = one(container, ".share-o4-dots");
    expect(row.getAttribute("aria-hidden")).toBe("true");
    expect(
      [...row.querySelectorAll(".share-o4-dot")].map((d) =>
        d.getAttribute("data-dot")
      )
    ).toEqual(["filled", "hollow", "empty", "empty"]);
  });

  it("keeps the panel's role, focus target and words, so the accessibility tree matches the current look", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "alert",
        icon: "share-empty",
        text: "Nothing to share",
        o4: { icon: "share-empty", ring: null, dots: [] },
      })
    );
    const panel = one(container, ".share-progress");
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.getAttribute("tabindex")).toBe("-1");
    expect(panel.textContent).toBe("Nothing to share");
    one(container, ".share-o4-frame[aria-hidden='true']");
  });
});
