import { describe, expect, it } from "vitest";

import { viewportWindow } from "@/lib/audio/viewport";

/**
 * The recorder viewport is pure geometry, so the pan/zoom cases that would need
 * a phone and a thumb are just arithmetic here. `centerFraction` is passed
 * explicitly rather than baked in: the right-of-centre position is a UI
 * constant the component owns, and the math must honour whatever it is given.
 */
describe("viewportWindow", () => {
  it("shows the whole clip at zoom 1 and a quarter at zoom 4", () => {
    expect(viewportWindow(1000, 500, 1, 0.5).visibleSamples).toBe(1000);
    expect(viewportWindow(1000, 500, 4, 0.5).visibleSamples).toBe(250);
  });

  it("clamps the centerline sample to the clip, above and below", () => {
    // Pan past the end: the centerline (and so the insertion offset) rests at
    // the last sample, not beyond it.
    expect(viewportWindow(1000, 4000, 1, 0.5).centerlineSample).toBe(1000);
    // Pan before the start.
    expect(viewportWindow(1000, -300, 1, 0.5).centerlineSample).toBe(0);
    // In range: untouched.
    expect(viewportWindow(1000, 600, 1, 0.5).centerlineSample).toBe(600);
  });

  it("splits the window around the centerline by centerFraction", () => {
    // centerFraction 0.66 puts most of the viewport to the LEFT of the line,
    // so more recorded audio shows behind the centerline than ahead of it.
    const v = viewportWindow(1000, 500, 1, 0.66);
    expect(v.start).toBeCloseTo(500 - 0.66 * 1000); // -160
    expect(v.end).toBeCloseTo(500 + 0.34 * 1000); // 840
    // The window always spans exactly visibleSamples regardless of the split.
    expect(v.end - v.start).toBeCloseTo(v.visibleSamples);
  });

  it("leaves blank room to the right when panned to the end (append)", () => {
    // Centerline at the end of the audio: the recorded waveform is entirely to
    // the left of the line, and the window runs past `length` — the blank the
    // appended take grows into (mockup 3).
    const v = viewportWindow(1000, 1000, 1, 0.66);
    expect(v.centerlineSample).toBe(1000);
    expect(v.start).toBeCloseTo(1000 - 0.66 * 1000); // 340 — audio to the left
    expect(v.end).toBeGreaterThan(1000); // blank to the right
  });
});
