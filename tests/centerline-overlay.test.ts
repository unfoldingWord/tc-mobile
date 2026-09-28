import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CenterlineOverlay } from "@/components/centerline-overlay";

/**
 * Checks the component's first-render HTML with `renderToStaticMarkup`.
 * Rendering the component exercises the gate and its content together; a
 * source-text match of the gate's call site cannot establish that relationship.
 * Effects, events, layout and CSS cascade are outside this test's scope.
 *
 * Full 3-axis table (mode x selectionActive x liveScope) — the same 8 cases
 * `tests/recorder-stage.test.ts`'s `centerlineOverlayShown` describe block
 * pins at the pure-function level. This file pins the same table at the
 * component's actual DOM output, which is what `recorder.tsx` renders.
 */
describe("CenterlineOverlay — the rendered marker, not just the gate's call site (#513 round-4 stop)", () => {
  const MARKER = 'data-testid="centerline-overlay"';

  const cases: {
    mode: "record" | "edit";
    selectionActive: boolean;
    liveScope: boolean;
    shown: boolean;
  }[] = [
    { mode: "edit", selectionActive: true, liveScope: false, shown: false },
    { mode: "edit", selectionActive: false, liveScope: false, shown: true },
    { mode: "record", selectionActive: true, liveScope: false, shown: true },
    { mode: "record", selectionActive: false, liveScope: false, shown: true },
    { mode: "edit", selectionActive: false, liveScope: true, shown: false },
    { mode: "record", selectionActive: false, liveScope: true, shown: false },
    { mode: "record", selectionActive: true, liveScope: true, shown: false },
    { mode: "edit", selectionActive: true, liveScope: true, shown: false },
  ];

  it.each(cases)(
    "mode=$mode selectionActive=$selectionActive liveScope=$liveScope -> shown=$shown",
    ({ mode, selectionActive, liveScope, shown }) => {
      const html = renderToStaticMarkup(
        createElement(CenterlineOverlay, { mode, selectionActive, liveScope })
      );
      if (shown) {
        expect(html).toContain(MARKER);
      } else {
        // Renders nothing at all — not just "no marker", so swapping the
        // gated content for an empty fragment (or any other placeholder)
        // still fails this half of the table (#513 Frank round-4 P2's
        // exact concrete scenario).
        expect(html).toBe("");
      }
    }
  );
});
