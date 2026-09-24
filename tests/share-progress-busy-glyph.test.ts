import { readFileSync } from "node:fs";
import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { ShareProgressPanel } from "@/components/share-progress-panel";

import { one, render } from "./render";

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/**
 * The share overlay's busy state used to wear a STATIC glyph — the same
 * `retry` mark `notice-tone.ts`'s shared `busy` entry gives every other wait
 * in the app — with no animation of its own (#850's premise). It is now a
 * dedicated ring-of-dots mark (`icon.tsx`'s "share-busy"), scoped to the
 * share overlay only.
 *
 * `ShareProgress` itself cannot be rendered through `tests/render.ts`: it
 * portals to `document.body`, and `renderToStaticMarkup` refuses a portal
 * outright ("Portals are not currently supported by the server renderer").
 * `ShareProgressPanel` is the presentational split that makes this
 * render-testable at all (see that file's own header) — the same reason
 * `RecorderStatus` exists as its own component.
 */
describe("the share overlay's busy glyph is a dedicated mark, not the shared retry arc (#850)", () => {
  it("share-progress.tsx's busy branch picks the dedicated share-busy mark", () => {
    const source = read("src/components/share-progress.tsx");
    expect(source).toMatch(/icon:\s*"share-busy"/);
    // The old wiring must be gone, not merely shadowed by a new branch above
    // it — this is the assertion that actually distinguishes "replaced" from
    // "added a second, unused path".
    expect(source).not.toMatch(/noticePresentation\("busy"\)\.icon/);
  });

  it('renders a ring-of-dots for icon="share-busy" — not the two-path retry arrow', () => {
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
