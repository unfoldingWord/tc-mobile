import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { SelectionOverlay } from "@/components/selection-overlay";
import type { WaveformViewport } from "@/lib/audio/viewport";
import type { SampleRange } from "@/types/audio";

import { one, render } from "./render";

/**
 * A selection handle's touch target stays inside the clipping canvas (#707).
 *
 * `.recorder-canvas` is `overflow-hidden`, and a zoom fit (`panForZoom`) can
 * put a selection edge exactly on the stage edge. A 24px target centred on
 * that edge loses half of itself off the stage. The overlay therefore draws
 * each edge twice: a stem that stays on the sample, and a hit box whose `left`
 * is clamped to half the box's width inside either edge while the sample is on
 * screen. An edge panned off screen keeps its box with it, so the bare canvas
 * at the stage edges still pans.
 *
 * What this reads is the attribute the component emits, through the static
 * render harness: no layout, so the clamp is checked as the expression it is.
 * The resolved pixel geometry is `e2e/recorder-selection.spec.ts`'s job.
 */

// The #705 case: L = 1000 at quarter zoom, the seed {750, 1000} fitted edge to
// edge by `panForZoom` (window 750..1000).
const FITTED: WaveformViewport = {
  start: 750,
  end: 1000,
  visibleSamples: 250,
  centerlineSample: 875,
};

const HIT = (x: string) =>
  `clamp(calc(var(--c-selection-hit) / 2), ${x}, calc(100% - var(--c-selection-hit) / 2))`;

function overlay(selection: SampleRange, win: WaveformViewport = FITTED) {
  return render(
    createElement(SelectionOverlay, {
      win,
      selection,
      workingLength: 1000,
      onChange: () => {},
      startLabel: "Selection start",
      endLabel: "Selection end",
    })
  );
}

const left = (el: Element) =>
  // The raw declaration: jsdom's CSSOM does not parse clamp() with var().
  /(?:^|;)\s*left:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1]?.trim();

describe("selection handle hit boxes stay inside the canvas (#707)", () => {
  it("clamps both hit boxes inside the stage when the span is fitted edge to edge", () => {
    const root = overlay({ start: 750, end: 1000 });
    expect(left(one(root, '[aria-label="Selection start"]'))).toBe(HIT("0%"));
    expect(left(one(root, '[aria-label="Selection end"]'))).toBe(HIT("100%"));
  });

  it("keeps each stem on its sample, unclamped", () => {
    const root = overlay({ start: 750, end: 1000 });
    expect(left(one(root, '.selection-stem[data-edge="start"]'))).toBe("0%");
    expect(left(one(root, '.selection-stem[data-edge="end"]'))).toBe("100%");
  });

  it("leaves the stems out of the accessibility tree and out of hit testing", () => {
    const root = overlay({ start: 750, end: 1000 });
    for (const edge of ["start", "end"]) {
      const stem = one(root, `.selection-stem[data-edge="${edge}"]`);
      expect(stem.getAttribute("aria-hidden")).toBe("true");
      expect(stem.hasAttribute("role")).toBe(false);
    }
    expect(root.querySelectorAll('[role="slider"]')).toHaveLength(2);
  });

  it("puts a mid-window edge's box on its stem (the clamp is a no-op there)", () => {
    const root = overlay({ start: 800, end: 900 });
    expect(left(one(root, '[aria-label="Selection start"]'))).toBe(HIT("20%"));
    expect(left(one(root, '.selection-stem[data-edge="start"]'))).toBe("20%");
    expect(left(one(root, '[aria-label="Selection end"]'))).toBe(HIT("60%"));
    expect(left(one(root, '.selection-stem[data-edge="end"]'))).toBe("60%");
  });

  it("lets an off-screen edge's box leave with it, so the stage edge still pans", () => {
    // A span wider than the window: both samples are off screen.
    const root = overlay(
      { start: 500, end: 1000 },
      {
        start: 600,
        end: 850,
        visibleSamples: 250,
        centerlineSample: 725,
      }
    );
    expect(left(one(root, '[aria-label="Selection start"]'))).toBe("-40%");
    expect(left(one(root, '[aria-label="Selection end"]'))).toBe("160%");
  });
});
