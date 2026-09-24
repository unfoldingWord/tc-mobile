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
  // The Zoom control moved to the toolbars when #160's L-1 split them out, so
  // the gate is now spread over TWO files: the terms are joined here, and the
  // sheet is what feeds the stage's half in. Both halves are read, because
  // either one alone can be broken without the other noticing.
  // Both are stripped of comments AT READ TIME, before anything locates an
  // element in them. Three holes have now been found on pins of this shape:
  // a slice running to end of file, a comment INSIDE the slice, and the one
  // a slice-level strip cannot reach — a block comment whose `/*` opens
  // BEFORE the element, leaving no `/*` in the slice, so `indexOf` lands on
  // the decoy and the live code is never read. Proven here by mutation.
  // Read, strip, then search, as `tests/menu-hamburger-header.test.ts` and
  // `tests/recorder-menu.test.ts` do: the ORDER is the guarantee, not the
  // regexes. Both reads get it — each one is searched and sliced.
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const toolbars = strip(
    readFileSync(
      new URL("../src/components/recorder-toolbars.tsx", import.meta.url),
      "utf8"
    )
  );
  const sheet = strip(
    readFileSync(
      new URL("../src/components/recorder.tsx", import.meta.url),
      "utf8"
    )
  );

  const zoomDisabledExpr = (() => {
    // Isolate the Zoom control by its unique icon expression and read the
    // `disabled={...}` that follows — the same idiom the Cut-gate test
    // above documents.
    const iconIdx = toolbars.indexOf(
      'icon={zoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}'
    );
    expect(
      iconIdx,
      "no Control carrying the zoom icon pair in recorder-toolbars.tsx"
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
    // so the close window above stood enabled. The stage's half arrives as
    // the `windowControlsInert` PROP since the toolbar split; the next case
    // is what keeps that prop wired to the real thing.
    //
    // The EXACT string, not two loose matches (George R4). `/windowControls
    // Inert/` also matches `!windowControlsInert`, so inverting the stage
    // term — zoom ENABLED precisely during the committing window, which is
    // #396's defect — passed this case. Proven by mutation.
    //
    // It is `toBe` on the WHOLE expression, not `toContain`: a containment
    // check on the same string is still a substring match, so prepending `!`
    // slips through it too. That was measured, not assumed — the first repair
    // here used `toContain` and the negation mutant stayed green.
    expect(zoomDisabledExpr.trim()).toBe(
      "windowControlsInert || !idleEditable"
    );
  });

  it("is fed the STAGE's inert flag, not something else named like it", () => {
    // The half the rename could silently lose: a prop is only as good as what
    // the sheet passes into it, and `windowControlsInert={false}` would leave
    // every assertion above green while the gate did nothing.
    // Bounded to the ELEMENT, not to end-of-file (George R1); comments are
    // already gone from `sheet` by the strip at read time above.
    const open = sheet.indexOf("<RecorderToolbar");
    const end = sheet.indexOf("/>", open);
    expect(open, "no <RecorderToolbar in the sheet").toBeGreaterThan(-1);
    expect(end, "unterminated <RecorderToolbar").toBeGreaterThan(open);
    // Strip comments before matching. Bounding the slice to the element (the
    // fix that closed the earlier slice-to-EOF hole) only excluded comments
    // AFTER it — a comment INSIDE the tag still satisfies the positive
    // matches below while the live prop says something else. Proven by
    // mutation: a commented `windowControlsInert={stage.windowControlsInert}`
    // ahead of a hard-wired `{false}` kept this green. Same strip
    // `tests/menu-hamburger-header.test.ts` and `tests/recorder-menu.test.ts`
    // use; any test that slices a region out of source needs it.
    const toolbarTag = sheet.slice(open, end);
    expect(toolbarTag).toMatch(
      /windowControlsInert=\{stage\.windowControlsInert\}/
    );
    expect(toolbarTag).toMatch(/idleEditable=\{idleEditable\}/);
  });

  it("the close-window term ORs with the inert term — neither masks the other", () => {
    expect(zoomDisabledExpr).toMatch(/\|\|/);
  });
});
