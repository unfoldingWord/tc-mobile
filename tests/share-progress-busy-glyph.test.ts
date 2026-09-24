import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { shareOverlayGlyph } from "@/components/share-overlay-glyph";
import { shareSettledGlyph } from "@/components/share-outcome-glyph";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import { SHARE_SETTLED } from "@/hooks/share-progress";

import { one, render } from "./render";

/**
 * The share overlay's busy state used to wear a STATIC glyph — the same
 * `retry` mark `notice-tone.ts`'s shared `busy` entry gives every other wait
 * in the app — with no dedicated animation of its own. It is now a dedicated
 * ring-of-dots mark (`icon.tsx`'s "share-busy"), scoped to the share overlay
 * only.
 *
 * `shareOverlayGlyph` (#850, `share-overlay-glyph.ts`) is the plain function
 * that makes the busy-vs-settled CHOICE testable as behaviour: called with a
 * `busy` progress value or with an `outcome` one, it is exercised the same
 * way `share-progress.tsx` exercises it, not matched against that
 * component's source text.
 *
 * `ShareProgress` itself cannot be rendered through `tests/render.ts`: it
 * portals to `document.body`, and `renderToStaticMarkup` refuses a portal
 * outright ("Portals are not currently supported by the server renderer").
 * `ShareProgressPanel` is the presentational split that makes the RESULT of
 * that choice render-testable — the same reason `RecorderStatus` exists as
 * its own component.
 */
describe("shareOverlayGlyph picks the overlay's mark (#850)", () => {
  it('a busy progress gives "share-busy", never the shared busy retry arc', () => {
    const glyph = shareOverlayGlyph({
      phase: "busy",
      work: "prepare",
      since: 0,
      pending: null,
    });
    expect(glyph.icon).toBe("share-busy");
    expect(glyph.tone).toBe("busy");
  });

  it("every settled outcome gives the same mark the outcome table gives it", () => {
    // Ties this function to `shareSettledGlyph` rather than re-asserting its
    // table: `tests/share-outcome-glyph.test.ts` already pins which mark
    // each settled value gets, and which two settled values must differ
    // (#178) — this only has to prove the busy/outcome DISPATCH is correct,
    // not re-prove the table underneath it.
    for (const settled of SHARE_SETTLED) {
      const glyph = shareOverlayGlyph({ phase: "outcome", settled, since: 0 });
      expect(glyph).toEqual(shareSettledGlyph(settled));
    }
  });
});

describe("the busy mark renders as a ring of dots, not the two-path retry arrow (#850)", () => {
  it('renders a ring-of-dots for icon="share-busy"', () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: "Preparing the chapter to share",
      })
    );
    const svg = one(container, "svg.share-progress-glyph");
    // The retry arrow `icon.tsx` draws for `notice-tone.ts`'s `busy` entry is
    // two `<path>` elements and no `<circle>`; the ring of dots is the
    // opposite shape entirely — all circles, no paths — so a caller that
    // reverted to the old name could never satisfy both counts at once.
    const circles = svg.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(6);
    expect(svg.querySelectorAll("path").length).toBe(0);
  });

  it("the dots fade around the ring, so the mark still reads as a spinner at rest under prefers-reduced-motion", () => {
    // `.share-scrim[data-outcome="busy"] .share-progress-glyph`
    // (3-components.css) drops the rotation to `none` under reduced motion;
    // nothing in CSS can un-flatten eight equally lit dots at that point, so
    // the fade has to be baked into the glyph itself.
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: "Preparing the chapter to share",
      })
    );
    const svg = one(container, "svg.share-progress-glyph");
    const opacities = [...svg.querySelectorAll("circle")].map((c) =>
      c.getAttribute("opacity")
    );
    expect(new Set(opacities).size).toBeGreaterThan(1);
  });

  it("renders role, icon and text as plain props — the panel drives no focus or keyboard logic of its own", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "alert",
        icon: "share-empty",
        text: "Nothing to share",
      })
    );
    const panel = one(container, ".share-progress");
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.getAttribute("tabindex")).toBe("-1");
    expect(panel.textContent).toContain("Nothing to share");
  });
});
