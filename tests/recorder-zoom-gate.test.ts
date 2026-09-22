import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Edit-mode Zoom must not fire during the leftover-preview `isClosing`
 * window (#396, George P3 on PR #345's rebase round).
 *
 * `displayedZoom = wholeView ? ZOOM_WHOLE : zoom` exists to make the
 * control's CHROME name the window actually drawn — while a paused-take
 * preview is up, the canvas is swapped for the whole buffer even though the
 * stored `zoom` says quarter. That is harmless when the control cannot be
 * tapped: during playback `stage.windowControlsInert` covers it. The hole
 * was the close window. Entering edit mode from a paused take after a
 * Pause+Play preview keeps the preview object; on Back, `close()` sets
 * `isClosing`, `previewShown` picks the leftover preview back up, `wholeView`
 * goes true, `stage.windowControlsInert` (the buffer is silent) goes false —
 * and Zoom stands enabled, drawing the "whole" chrome, while `onToggleZoom`
 * still reads and writes the REAL `zoom`. A tap there flips the stored zoom
 * with no visible change, and if the save then fails and the sheet reopens,
 * the editor comes back in the flipped mode — state the chrome never showed
 * and the translator never asked for.
 *
 * George's minimal fix, and the one taken: add `!idleEditable` to the Zoom
 * control's `disabled`, matching the guard Select, Undo, Redo, Cut and the
 * audition all already carry. `idleEditable` is false exactly while the
 * sheet is committing (the `isClosing` window the preview can outlive), so
 * the chrome/handler split — chrome claiming the whole view while the
 * handler flips the real zoom — can no longer be acted on.
 *
 * Source-shape, the reason `tests/recorder-cut-drag-gate.test.ts` documents:
 * `recorder.tsx` mounts the audio hook graph, there is no DOM runner for it,
 * and a `disabled` prop on one Control cannot be rendered and inspected —
 * only read as text. The assertion below names the kill condition (reverting
 * the prop to `stage.windowControlsInert` alone fails it), which the
 * recorder's own commit-window e2e cannot reach today.
 */
describe("Zoom's disabled gate covers the leftover-preview close window (#396)", () => {
  // The Zoom control moved to the toolbars when #160's L-1 split them out, so
  // the gate is now spread over TWO files: the terms are joined here, and the
  // sheet is what feeds the stage's half in. Both halves are read, because
  // either one alone can be broken without the other noticing.
  const toolbars = readFileSync(
    new URL("../src/components/recorder-toolbars.tsx", import.meta.url),
    "utf8"
  );
  const sheet = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  );

  const zoomDisabledExpr = (() => {
    // Isolate the Zoom control by its unique icon expression and read the
    // `disabled={...}` that follows — the same idiom the Cut-gate test
    // above documents.
    const iconIdx = toolbars.indexOf(
      'icon={displayedZoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}'
    );
    expect(
      iconIdx,
      "no Control carrying the displayedZoom icon pair in recorder-toolbars.tsx"
    ).toBeGreaterThan(-1);
    const match = /disabled=\{([^}]*)\}/.exec(toolbars.slice(iconIdx));
    if (!match) {
      throw new Error(
        "the Zoom control's disabled={...} prop was not found after its icon"
      );
    }
    return match[1] ?? "";
  })();

  it("carries !idleEditable alongside the stage's inert term", () => {
    // RED-FIRST kill: on develop's pre-fix head this expression was
    // `stage.windowControlsInert` alone — no `idleEditable` term at all —
    // so the close window above stood enabled. Both terms must be present,
    // and joined so EITHER disables. The stage's half arrives as the
    // `windowControlsInert` PROP since the toolbar split; the next case is
    // what keeps that prop wired to the real thing.
    expect(zoomDisabledExpr).toMatch(/windowControlsInert/);
    expect(zoomDisabledExpr).toMatch(/!\s*idleEditable/);
  });

  it("is fed the STAGE's inert flag, not something else named like it", () => {
    // The half the rename could silently lose: a prop is only as good as what
    // the sheet passes into it, and `windowControlsInert={false}` would leave
    // every assertion above green while the gate did nothing.
    const toolbarTag = sheet.slice(sheet.indexOf("<RecorderToolbar"));
    expect(toolbarTag).toMatch(
      /windowControlsInert=\{stage\.windowControlsInert\}/
    );
    expect(toolbarTag).toMatch(/idleEditable=\{idleEditable\}/);
  });

  it("the close-window term ORs with the inert term — neither masks the other", () => {
    expect(zoomDisabledExpr).toMatch(/\|\|/);
  });
});
