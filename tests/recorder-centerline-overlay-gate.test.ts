import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * #513 — three source-shape rounds (Frank round-2, -3, -4) each tightened a
 * TEXT match of the centerline overlay's JSX and each time the next round
 * found the next leak: the predicate was tested but the rendered gate was
 * not (r2); the test checked identifier NAMES, not the argument VALUES
 * (r3); the test never proved the gate actually wrapped the centerline
 * element, so swapping its content for an empty fragment (or moving the
 * element outside the conditional) still passed (r4). Text-matching the
 * JSX does not converge — the dev lead's cap pick (round-4 stop,
 * issuecomment-5742347381) was to extract the overlay into its own
 * component and test its RENDERED output instead;
 * `tests/centerline-overlay.test.ts` does that, with
 * `renderToStaticMarkup`, over the same 3-axis table
 * `tests/recorder-stage.test.ts`'s `centerlineOverlayShown` describe block
 * pins at the pure-function level.
 *
 * What is left here is the one source-shape guarantee a render test cannot
 * make: that `recorder.tsx` actually renders `<CenterlineOverlay>` (not the
 * old inline `<div>`, not some other element) with exactly the right props.
 * A render test exercises whatever element you hand it — it cannot notice
 * that `recorder.tsx` stopped calling the component at all, or started
 * passing it different values, without something reading the call site
 * itself. Source-shape, the same reason `tests/recorder-cut-drag-gate.test.ts`
 * and `tests/nav-commit-close-race-guards.test.ts` are: there is no DOM
 * runner here (AGENTS.md), so `recorder.tsx` itself cannot be rendered and
 * inspected — only read as text.
 */

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const recorder = stripComments(
  readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  )
);

describe("recorder.tsx renders CenterlineOverlay with exactly the right props (#513 round-4 stop)", () => {
  it("passes mode, selectionActive: editor.selectionActive, liveScope — an exact match, once, nothing substituted", () => {
    const startIdx = recorder.indexOf("<CenterlineOverlay");
    expect(
      startIdx,
      "<CenterlineOverlay not found in recorder.tsx"
    ).toBeGreaterThan(-1);
    expect(recorder.indexOf("<CenterlineOverlay", startIdx + 1)).toBe(-1);

    const closeIdx = recorder.indexOf("/>", startIdx);
    expect(
      closeIdx,
      "no self-closing `/>` found for <CenterlineOverlay"
    ).toBeGreaterThan(-1);

    const tag = recorder.slice(startIdx, closeIdx + 2);
    const normalized = tag.replace(/\s+/g, " ").trim();
    expect(normalized).toBe(
      "<CenterlineOverlay mode={mode} selectionActive={editor.selectionActive} liveScope={liveScope} />"
    );
  });
});
