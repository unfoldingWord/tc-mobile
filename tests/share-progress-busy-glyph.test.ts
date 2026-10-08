import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { shareOverlayGlyph } from "@/components/share-overlay-glyph";
import { shareO4View } from "@/components/share-o4-view";
import { shareSettledGlyph } from "@/components/share-outcome-glyph";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import {
  SHARE_SETTLED,
  type ShareProgress as ShareProgressState,
} from "@/hooks/share-progress";

import { one, render } from "./render";

/**
 * `shareOverlayGlyph` (#850, `share-overlay-glyph.ts`) is the plain function
 * that makes the busy-vs-settled CHOICE testable as behaviour: called with a
 * `busy` progress value or with an `outcome` one, it is exercised the same
 * way `share-progress.tsx` exercises it, not matched against that
 * component's source text.
 *
 * `ShareProgress` itself cannot be rendered through `tests/render.ts`: it
 * portals to `document.body`, and `renderToStaticMarkup` refuses a portal
 * outright ("Portals are not currently supported by the server renderer").
 * `ShareProgressPanel` is the presentational split that makes the panel
 * render-testable — the same reason `RecorderStatus` exists as its own
 * component.
 *
 * The panel draws `shareO4View`'s glyph in its core, and while busy that is
 * the share glyph (D15, `tests/share-o4-view.test.ts`); the busy entry's
 * TONE sets the panel's role.
 */
/** The panel as `ShareProgress` draws it for `progress`: the view's glyph in the core. */
function panelFor(
  progress: Exclude<ShareProgressState, { readonly phase: "hidden" }>,
  role: "status" | "alert",
  text: string
) {
  return render(
    createElement(ShareProgressPanel, {
      role,
      text,
      o4: shareO4View(progress, "chapter", []),
    })
  );
}

describe("shareOverlayGlyph picks the overlay's mark (#850)", () => {
  it('a busy progress gives the plain "share" glyph (D15), never the shared busy retry arc', () => {
    const glyph = shareOverlayGlyph({
      phase: "busy",
      work: "prepare",
      since: 0,
      pending: null,
    });
    expect(glyph.icon).toBe("share");
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

describe("ShareProgressPanel (#850)", () => {
  it("renders role and text as plain props — the panel drives no focus or keyboard logic of its own", () => {
    const container = panelFor(
      { phase: "outcome", settled: "nothing", since: 0 },
      "alert",
      "Nothing to share"
    );
    const panel = one(container, ".share-progress");
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.getAttribute("tabindex")).toBe("-1");
    expect(panel.textContent).toContain("Nothing to share");
  });
});
