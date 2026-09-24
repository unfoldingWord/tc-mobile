import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Edit-mode Zoom must not fire during the committing `isClosing` window
 * (#396, George P3 on PR #345's rebase round).
 *
 * The defect that put the guard there: a `displayedZoom` substituted the
 * whole-clip level whenever a paused-take preview was on the stage, so the
 * control's CHROME could name a window the handler did not act on. On Back,
 * `close()` set `isClosing`, the leftover preview came back up, and
 * `stage.windowControlsInert` (the buffer was silent) went false — Zoom stood
 * enabled drawing the "whole" chrome while `onToggleZoom` read and wrote the
 * REAL `zoom`. A tap flipped the stored zoom with no visible change, and a
 * failed save reopened the editor in the flipped mode.
 *
 * #614 removed BOTH halves of that particular split — the paused take, and
 * with it the preview and `displayedZoom` itself. The guard stays and this
 * test with it, because the guard is not about the preview: `!idleEditable` is
 * false for the whole of ANY commit, so a window control cannot be tapped
 * while the buffer under it is being replaced. Reverting the prop to
 * `stage.windowControlsInert` alone re-opens that window for every commit,
 * which is strictly more than the one this was filed for.
 *
 * Source-shape, the reason `tests/recorder-cut-drag-gate.test.ts` documents:
 * `recorder.tsx` mounts the audio hook graph, there is no DOM runner for it,
 * and a `disabled` prop on one Control cannot be rendered and inspected —
 * only read as text. The assertion below names the kill condition (reverting
 * the prop to `stage.windowControlsInert` alone fails it), which the
 * recorder's own commit-window e2e cannot reach today.
 */
describe("Zoom's disabled gate covers the leftover-preview close window (#396)", () => {
  const recorder = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  );

  const zoomDisabledExpr = (() => {
    // Isolate the Zoom control by its unique icon expression and read the
    // `disabled={...}` that follows — the same idiom the Cut-gate test
    // above documents.
    const iconIdx = recorder.indexOf(
      'icon={zoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}'
    );
    expect(
      iconIdx,
      "no Control carrying the zoom icon pair in recorder.tsx"
    ).toBeGreaterThan(-1);
    const match = /disabled=\{([^}]*)\}/.exec(recorder.slice(iconIdx));
    if (!match) {
      throw new Error(
        "the Zoom control's disabled={...} prop was not found after its icon"
      );
    }
    return match[1] ?? "";
  })();

  it("carries !idleEditable alongside stage.windowControlsInert", () => {
    // RED-FIRST kill: on develop's pre-fix head this expression was
    // `stage.windowControlsInert` alone — no `idleEditable` term at all —
    // so the close window above stood enabled. Both terms must be present,
    // and joined so EITHER disables.
    expect(zoomDisabledExpr).toMatch(/stage\.windowControlsInert/);
    expect(zoomDisabledExpr).toMatch(/!\s*idleEditable/);
  });

  it("the close-window term ORs with the inert term — neither masks the other", () => {
    expect(zoomDisabledExpr).toMatch(/\|\|/);
  });
});
