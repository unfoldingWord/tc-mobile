import { describe, expect, it } from "vitest";

import { playheadViewportX } from "@/lib/audio/viewport";

/**
 * The recorder draws its playback playhead through the same window transform the
 * bars ride: a playback position given as a fraction of the WHOLE clip maps to a
 * fraction of the viewport width. Pure arithmetic, so the cases that would need a
 * phone and a finger are just numbers here. A result outside `[0,1]` means the
 * playhead is off-screen (in the blank head/tail), and the draw code skips it.
 */
describe("playheadViewportX", () => {
  // A window covering the first half of the clip: [0, 0.5].
  it("maps the window's left edge to 0", () => {
    expect(playheadViewportX(0, 0, 0.5)).toBeCloseTo(0);
  });

  it("maps the window's right edge to 1", () => {
    expect(playheadViewportX(0.5, 0, 0.5)).toBeCloseTo(1);
  });

  it("maps the centre of a centered window to 0.5", () => {
    // Window [0.25, 0.75] (a quarter-zoom centred at the clip midpoint); the
    // clip's 0.5 mark sits dead centre.
    expect(playheadViewportX(0.5, 0.25, 0.75)).toBeCloseTo(0.5);
  });

  it("returns < 0 for a playhead left of the window", () => {
    // Window [0.4, 0.8]; a playhead at 0.2 is off-screen to the left.
    expect(playheadViewportX(0.2, 0.4, 0.8)).toBeLessThan(0);
  });

  it("returns > 1 for a playhead right of the window", () => {
    // Window [0.4, 0.8]; a playhead at 0.9 is off-screen to the right.
    expect(playheadViewportX(0.9, 0.4, 0.8)).toBeGreaterThan(1);
  });

  it("honours a window whose edges overhang the clip (blank head)", () => {
    // The recorder's window fractions may fall outside [0,1] — the blank the
    // audio pans over. A clip-start playhead within such a window still maps
    // linearly.
    expect(playheadViewportX(0, -0.2, 0.2)).toBeCloseTo(0.5);
  });
});
