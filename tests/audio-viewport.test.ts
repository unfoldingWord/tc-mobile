import { describe, expect, it } from "vitest";

import {
  panAfterCut,
  panForZoom,
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

describe("panAfterCut", () => {
  // Pan at sample 1000 throughout.
  it("shifts the pan left by a cut entirely before it", () => {
    expect(panAfterCut(1000, { start: 100, end: 300 })).toBe(800);
  });

  it("leaves the pan when the cut is entirely after it", () => {
    expect(panAfterCut(1000, { start: 1200, end: 1500 })).toBe(1000);
  });

  it("lands the pan at the cut start when the cut straddles it", () => {
    // Removes [900, 1100); the 100 samples before the pan (900–1000) go, so the
    // pan drops to 900 — the start of the removed span.
    expect(panAfterCut(1000, { start: 900, end: 1100 })).toBe(900);
  });

  it("ignores order (a reversed range is normalised)", () => {
    expect(panAfterCut(1000, { start: 300, end: 100 })).toBe(800);
  });

  it("is a no-op for a cut touching the pan from the right", () => {
    expect(panAfterCut(1000, { start: 1000, end: 1200 })).toBe(1000);
  });
});

/**
 * Keeping the selection in view across a zoom (#91).
 *
 * The first external tester zoomed with a span picked and reported that it
 * "seemed to extend the selection off screen": the pan stayed put while the
 * window shrank around it, so the thing being edited left the viewport and the
 * control read as if it had acted on the selection rather than on the view.
 * These are the four cases that fix has to satisfy, plus the clamps at both
 * ends.
 *
 * Expectations are stated as properties of the RESULTING window wherever they
 * can be, not as magic numbers, so the test survives a change of centre
 * fraction.
 */
describe("panForZoom", () => {
  const LENGTH = 1000;
  const CF = 0.5;
  const win = (pan: number, zoom: number) =>
    viewportWindow(LENGTH, pan, zoom, CF);

  it("leaves the pan alone when the selection already fits the new window", () => {
    // Quarter view around 500 spans [375, 625]; the span sits inside it.
    expect(panForZoom(LENGTH, 500, 4, CF, { start: 400, end: 600 })).toBe(500);
  });

  it("brings a selection off the RIGHT edge back into view", () => {
    // Pan 300 at quarter view spans [175, 425] — the span is entirely past it.
    const next = panForZoom(LENGTH, 300, 4, CF, { start: 700, end: 800 });
    const v = win(next, 4);
    expect(v.start).toBeLessThanOrEqual(700);
    expect(v.end).toBeGreaterThanOrEqual(800);
    // Minimal travel: the pan moves only as far as it must, so the span lands
    // against the edge it came in over rather than jumping to the centre.
    expect(next).toBeCloseTo(800 - (1 - CF) * v.visibleSamples);
  });

  it("brings a selection off the LEFT edge back into view", () => {
    // Pan 900 at quarter view spans [775, 1025].
    const next = panForZoom(LENGTH, 900, 4, CF, { start: 100, end: 200 });
    const v = win(next, 4);
    expect(v.start).toBeLessThanOrEqual(100);
    expect(v.end).toBeGreaterThanOrEqual(200);
    expect(next).toBeCloseTo(100 + CF * v.visibleSamples);
  });

  it("shows the START of a selection wider than the window", () => {
    // 500 samples of span into a 250-sample window: it cannot all fit, so the
    // start edge is the one that must be on screen — that is the handle the
    // translator reaches for first, and the end is a pan away.
    const next = panForZoom(LENGTH, 900, 4, CF, { start: 100, end: 600 });
    const v = win(next, 4);
    expect(v.start).toBeCloseTo(100);
    expect(v.end).toBeLessThan(600);
  });

  it("clamps at the START of the clip", () => {
    // The unclamped answer for a span at sample 0 would pan before the clip.
    const next = panForZoom(LENGTH, 1000, 4, CF, { start: 0, end: 50 });
    expect(next).toBeGreaterThanOrEqual(0);
    const v = win(next, 4);
    expect(v.start).toBeLessThanOrEqual(0);
    expect(v.end).toBeGreaterThanOrEqual(50);
  });

  it("clamps at the END of the clip", () => {
    // Unclamped this wants pan 1075 — past the last sample, which would put the
    // record insertion offset beyond the buffer.
    const next = panForZoom(LENGTH, 0, 4, CF, { start: 950, end: 1000 });
    expect(next).toBeLessThanOrEqual(LENGTH);
    const v = win(next, 4);
    expect(v.start).toBeLessThanOrEqual(950);
    expect(v.end).toBeGreaterThanOrEqual(1000);
  });

  it("fits any selection when zooming back out to the whole segment", () => {
    // At zoom 1 the window spans the whole clip, so nothing can be left off
    // screen — including a span that covers the entire buffer.
    for (const span of [
      { start: 100, end: 900 },
      { start: 0, end: LENGTH },
      { start: 0, end: 1 },
      { start: LENGTH - 1, end: LENGTH },
    ]) {
      const next = panForZoom(LENGTH, LENGTH, 1, CF, span);
      const v = win(next, 1);
      expect(v.start).toBeLessThanOrEqual(span.start);
      expect(v.end).toBeGreaterThanOrEqual(span.end);
    }
  });

  it("honours an off-centre centerline on BOTH edges", () => {
    // At centerFraction 0.5 the two edge formulas are indistinguishable —
    // `centerFraction` and `1 - centerFraction` are the same number — so a
    // swapped one passes every case above. The centerline is a UI constant this
    // module must honour whatever it is, so pin it off centre (the same reason
    // `viewportWindow`'s own cases use 0.66).
    const off = 0.75; // 3/4 of the viewport lies LEFT of the line
    const visible = LENGTH / 4; // 250

    // Off the right edge: the end lands on the right edge, a quarter-window
    // ahead of the line.
    const right = panForZoom(LENGTH, 300, 4, off, { start: 700, end: 800 });
    expect(right).toBeCloseTo(800 - (1 - off) * visible); // 737.5, not 612.5
    const rightWin = viewportWindow(LENGTH, right, 4, off);
    expect(rightWin.start).toBeLessThanOrEqual(700);
    expect(rightWin.end).toBeGreaterThanOrEqual(800);

    // Off the left edge: the start lands on the left edge, three quarters of a
    // window behind the line.
    const left = panForZoom(LENGTH, 900, 4, off, { start: 100, end: 200 });
    expect(left).toBeCloseTo(100 + off * visible); // 287.5, not 162.5
    expect(viewportWindow(LENGTH, left, 4, off).start).toBeCloseTo(100);

    // Wider than the window: still the start edge, under the same off-centre
    // line.
    const wide = panForZoom(LENGTH, 900, 4, off, { start: 100, end: 600 });
    expect(viewportWindow(LENGTH, wide, 4, off).start).toBeCloseTo(100);
  });

  it("leaves the pan where it is when nothing is selected", () => {
    expect(panForZoom(LENGTH, 400, 4, CF, null)).toBe(400);
    // Still clamped to the clip — the caller's pan may be stale past a cut.
    expect(panForZoom(LENGTH, 1200, 4, CF, null)).toBe(LENGTH);
    expect(panForZoom(LENGTH, -50, 4, CF, null)).toBe(0);
  });

  it("ignores order (a reversed selection is normalised)", () => {
    const forward = panForZoom(LENGTH, 300, 4, CF, { start: 700, end: 800 });
    const reversed = panForZoom(LENGTH, 300, 4, CF, { start: 800, end: 700 });
    expect(reversed).toBe(forward);
  });

  it("clamps a pan that starts outside the clip", () => {
    // The final clamp is the one guard on every path. A span at sample 0 and a
    // pan below the clip would otherwise return a negative pan — and the pan is
    // also the record insertion offset, so that is not merely a drawing bug.
    expect(panForZoom(LENGTH, -50, 4, CF, { start: 0, end: 50 })).toBe(0);
  });

  it("measures a selection by its real extent, not its raw handles", () => {
    // `editor.selection` is the RAW picked span; only the editor's own `canCut`
    // reader clamps it, so a handle dragged into the blank head or tail runs
    // outside [0, length]. Measured raw, both of these read as "wider than the
    // window" and pin the viewport into blank space — when the audio each one
    // actually covers (100 samples) fits the 250-sample window easily.
    const tail = panForZoom(LENGTH, 0, 4, CF, { start: 900, end: 4000 });
    const tailWin = win(tail, 4);
    expect(tailWin.start).toBeLessThanOrEqual(900);
    // No blank tail wasted: the window ends at the clip, not past it.
    expect(tailWin.end).toBeLessThanOrEqual(LENGTH);

    const head = panForZoom(LENGTH, 900, 4, CF, { start: -4000, end: 100 });
    const headWin = win(head, 4);
    expect(headWin.end).toBeGreaterThanOrEqual(100);
    // ...and no blank head wasted.
    expect(headWin.start).toBeGreaterThanOrEqual(0);
  });

  it("is safe on an empty segment", () => {
    expect(panForZoom(0, 0, 4, CF, { start: 0, end: 0 })).toBe(0);
    expect(panForZoom(0, 50, 1, CF, null)).toBe(0);
  });
});
