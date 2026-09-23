import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Pins the Recorder call site's CenterlineOverlay props (#513).
 * `tests/centerline-overlay.test.ts` checks the component's static markup;
 * `tests/recorder-stage.test.ts` checks the visibility predicate.
 * Neither checks which values Recorder passes to the component, so this
 * source-shape test reads that call site. It does not exercise hook effects,
 * interactions, layout, or the mounted Recorder.
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
