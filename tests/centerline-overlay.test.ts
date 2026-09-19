import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CenterlineOverlay } from "@/components/centerline-overlay";

/**
 * #513 — dev lead's cap pick at the round-4 stop (issuecomment-5742347381).
 *
 * Three rounds of `tests/recorder-centerline-overlay-gate.test.ts` each
 * tightened a source-TEXT match of the JSX gate, and Frank found the next
 * leak each time: the predicate was tested but not the rendered gate (r2),
 * the test checked identifier names rather than argument values (r3), the
 * test never proved the gate actually wrapped the centerline element (r4).
 * Text-matching the JSX does not converge. This asserts the component's
 * actual rendered HTML instead — the same `renderToStaticMarkup` pattern
 * `tests/save-failed.test.ts` uses, for the same reason: no jsdom, no
 * renderer (`vitest.config.ts` sets `environment: "node"`), so only the
 * markup a first render produces is checked here.
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
