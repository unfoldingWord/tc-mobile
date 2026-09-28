import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { CutAnchor } from "@/components/cut-anchor";
import type { WaveformViewport } from "@/lib/audio/viewport";
import type { SampleRange } from "@/types/audio";

import { one, render } from "./render";

/**
 * #1102: the Cut affordance's wrapper carries the selection's midpoint as
 * `--o4-cut-left`, the same table `tests/recorder-stage.test.ts`'s
 * `cutAnchorPercent` describe block pins at the pure-function level. This
 * file pins it at the component's actual rendered attribute — the same split
 * `tests/selection-overlay-hit.test.ts` and `tests/centerline-overlay.test.ts`
 * use — so a wiring bug between the two (the wrong prop passed, the style key
 * misspelled, the wrapper only rendered some of the time) fails here even
 * though the pure percentage is still right.
 *
 * `o4/recorder.css`'s `clamp()` — the button's own half-width kept on screen
 * at either edge — is a stylesheet rule this harness has no layout engine to
 * resolve; `tests/o4-recorder-css.test.ts` pins that expression by text, and
 * `e2e/recorder-selection.spec.ts` is the resolved-pixel check.
 */

// The same #705 fixture `tests/selection-overlay-hit.test.ts` and
// `tests/recorder-stage.test.ts`'s `cutAnchorPercent` block use: L = 1000 at
// quarter zoom, window 750..1000.
const FITTED: WaveformViewport = {
  start: 750,
  end: 1000,
  visibleSamples: 250,
  centerlineSample: 875,
};

const MARKER = "cut test child";

function anchor(selection: SampleRange | null, win: WaveformViewport = FITTED) {
  return render(
    createElement(CutAnchor, {
      selection,
      win,
      children: createElement("button", null, MARKER),
    })
  );
}

const cutLeft = (el: Element) =>
  // The raw declaration, like `selection-overlay-hit.test.ts`'s `left()`:
  // jsdom's CSSOM does not parse `clamp()` with `var()`, and there is none to
  // parse here anyway — the wrapper only ever carries the one custom
  // property, not the stylesheet's clamp.
  /(?:^|;)\s*--o4-cut-left:\s*([^;]+)/
    .exec(el.getAttribute("style") ?? "")?.[1]
    ?.trim();

describe("CutAnchor — the Cut wrapper follows the selection midpoint (#1102)", () => {
  it("carries the selection's midpoint as --o4-cut-left", () => {
    // 800..900 inside 750..1000: midpoint 850, (850-750)/250 = 40%.
    const root = anchor({ start: 800, end: 900 });
    expect(cutLeft(one(root, ".cut-anchor"))).toBe("40%");
  });

  it("agrees on a reversed selection — the midpoint of [a, b] and [b, a] is the same number", () => {
    const root = anchor({ start: 900, end: 800 });
    expect(cutLeft(one(root, ".cut-anchor"))).toBe("40%");
  });

  it("clamps to the viewport's own left edge when the midpoint falls off screen", () => {
    const root = anchor({ start: 0, end: 100 });
    expect(cutLeft(one(root, ".cut-anchor"))).toBe("0%");
  });

  it("clamps to the viewport's own right edge when the midpoint falls off screen", () => {
    const root = anchor({ start: 1_100, end: 1_300 });
    expect(cutLeft(one(root, ".cut-anchor"))).toBe("100%");
  });

  it("renders the child unwrapped, at no fixed position, with no selection (the bin, #862)", () => {
    // Not just "no --o4-cut-left" — no `.cut-anchor` element at all, so the
    // bin keeps `.recorder-cut`'s own `justify-content: center` rather than
    // being wrapped in a positioned box that happens to carry no property
    // (the same "swap the gated content for an empty fragment" trap
    // `centerline-overlay.test.ts` names, #513 round 4).
    const root = anchor(null);
    expect(root.querySelector(".cut-anchor")).toBeNull();
    expect(one(root, "button").textContent).toBe(MARKER);
  });

  it("still renders the child when wrapped", () => {
    const root = anchor({ start: 800, end: 900 });
    expect(one(root, ".cut-anchor button").textContent).toBe(MARKER);
  });
});
