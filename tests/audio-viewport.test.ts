import { describe, expect, it } from "vitest";

import {
  sampleToViewportX,
  viewportWindow,
  viewportXToSample,
} from "@/lib/audio/viewport";

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

/**
 * The two conversions B5's selection handles ride on. They must be exact
 * inverses across the viewport, and must agree with the pan drag's own scale
 * (a pixel of travel moves the same number of samples either way), or a handle
 * would grab a different sample than the one drawn under the finger.
 */
describe("viewportXToSample / sampleToViewportX", () => {
  const win = viewportWindow(1000, 500, 1, 0.66); // start -160, visible 1000
  const width = 400;

  it("maps the left edge to the first visible sample and the right edge past it", () => {
    expect(viewportXToSample(0, width, win)).toBeCloseTo(win.start);
    expect(viewportXToSample(width, width, win)).toBeCloseTo(win.end);
  });

  it("places a sample at the centerline's x and back", () => {
    // The centerline sits at centerFraction of the width; the sample under it
    // is centerlineSample. Round-trips through both conversions.
    const centerX = 0.66 * width;
    expect(sampleToViewportX(win.centerlineSample, width, win)).toBeCloseTo(
      centerX
    );
    expect(viewportXToSample(centerX, width, win)).toBeCloseTo(
      win.centerlineSample
    );
  });

  it("is an exact inverse for arbitrary samples and pixels", () => {
    for (const s of [-160, 0, 250, 500, 840]) {
      expect(
        viewportXToSample(sampleToViewportX(s, width, win), width, win)
      ).toBeCloseTo(s);
    }
    for (const x of [0, 137, 200, 400]) {
      expect(
        sampleToViewportX(viewportXToSample(x, width, win), width, win)
      ).toBeCloseTo(x);
    }
  });

  it("moves the same samples-per-pixel as the pan drag scale", () => {
    // The pan drag uses delta = -(dx / width) * visibleSamples
    // (recorder.tsx). A handle dragged dx pixels must cover the same span.
    const dx = 40;
    const span =
      viewportXToSample(dx, width, win) - viewportXToSample(0, width, win);
    expect(span).toBeCloseTo((dx / width) * win.visibleSamples);
  });

  it("tracks zoom: a quarter-view pixel covers a quarter of the samples", () => {
    const zoomed = viewportWindow(1000, 500, 4, 0.66); // visible 250
    const span =
      viewportXToSample(width, width, zoomed) -
      viewportXToSample(0, width, zoomed);
    expect(span).toBeCloseTo(250);
  });
});
