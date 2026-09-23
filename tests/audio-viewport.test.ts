import { describe, expect, it } from "vitest";

import { spansWholeSample } from "@/lib/audio/edit";
import {
  effectivePan,
  panAfterCut,
  panForZoom,
  playbackStrip,
  playbackStripOffset,
  sampleToViewportX,
  seedSelection,
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
/**
 * Which pan the recorder actually draws and splices through (#91, round-1 P1).
 *
 * The round-1 P1 was that the zoom's view fit reached `panState`, which is also
 * the record insertion offset — so a zoom with a selection open moved where the
 * next take spliced. The fix is a second, view-only value that the record path
 * must never see, and until now that separation lived only in a JSX-adjacent
 * expression inside a 2000-line component, where nothing could test it. The
 * George stand-in demonstrated the cost: mutating the WRITER (`setZoomPan` →
 * `setPanState`) reintroduced the P1 verbatim and all 512 tests stayed green.
 *
 * This table pins the READER half of that guarantee — above all the first case,
 * which is the invariant itself: in record mode the view pan is not consulted,
 * whatever it holds. See the note in the round-3 triage for what this does and
 * does not catch; the writer half is still structural.
 */
describe("effectivePan", () => {
  const LENGTH = 1000;

  it("IGNORES the view pan in record mode, whatever it holds", () => {
    // The P1 invariant. `zoomPan` is deliberately a value that would be obvious
    // if it leaked: nothing else in these cases is 123.
    expect(
      effectivePan({
        mode: "record",
        selectionActive: false,
        zoomPan: 123,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(600);
    // Even with a selection somehow still open — the two terms are independent,
    // so neither alone is load-bearing.
    expect(
      effectivePan({
        mode: "record",
        selectionActive: true,
        zoomPan: 123,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(600);
    // ...and with no pan of its own, record mode rests at the end (append).
    expect(
      effectivePan({
        mode: "record",
        selectionActive: true,
        zoomPan: 123,
        panState: null,
        length: LENGTH,
      })
    ).toBe(LENGTH);
  });

  it("uses the view pan only in edit mode WITH a selection open", () => {
    expect(
      effectivePan({
        mode: "edit",
        selectionActive: true,
        zoomPan: 475,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(475);
  });

  it("ignores the view pan in edit mode with NO selection open", () => {
    // A stale `zoomPan` from an earlier selection must not reach the view; the
    // recorder clears it, but the gate must not depend on that having happened.
    expect(
      effectivePan({
        mode: "edit",
        selectionActive: false,
        zoomPan: 475,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(600);
  });

  it("falls back through the view pan, then the real pan, then the end", () => {
    // Selection open but never zoomed: the real pan shows.
    expect(
      effectivePan({
        mode: "edit",
        selectionActive: true,
        zoomPan: null,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(600);
    // Neither set: the append rest, at the end of the buffer.
    expect(
      effectivePan({
        mode: "edit",
        selectionActive: true,
        zoomPan: null,
        panState: null,
        length: LENGTH,
      })
    ).toBe(LENGTH);
  });

  it("honours a pan of exactly 0 (nullish fallback, not falsy)", () => {
    // `||` here would silently replace the start of the clip with its end —
    // the whole buffer's width of error, and in record mode that is the splice
    // point, not just the view.
    expect(
      effectivePan({
        mode: "edit",
        selectionActive: true,
        zoomPan: 0,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(0);
    expect(
      effectivePan({
        mode: "record",
        selectionActive: false,
        zoomPan: null,
        panState: 0,
        length: LENGTH,
      })
    ).toBe(0);
  });

  it("clamps to the current length", () => {
    // A cut can shorten the buffer past a pan set before it; a stale pan beyond
    // the end would sit the record offset past the last sample.
    expect(
      effectivePan({
        mode: "record",
        selectionActive: false,
        zoomPan: null,
        panState: 4000,
        length: LENGTH,
      })
    ).toBe(LENGTH);
    expect(
      effectivePan({
        mode: "edit",
        selectionActive: true,
        zoomPan: 4000,
        panState: 600,
        length: LENGTH,
      })
    ).toBe(LENGTH);
  });
});

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

  it("fits any selection when zooming back out to the whole-segment zoom", () => {
    // At zoom 1 the window SPANS the clip, so any selection fits and the pan can
    // always be found that shows all of it — including a span covering the whole
    // buffer. Note this is not the same as "the whole clip is on screen": the
    // window can still sit over the blank head or tail, which is the append view
    // `viewportWindow`'s own case above pins.
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
    // Measured raw, both of these read as "wider than the window" and pin the
    // viewport into blank space — when the audio each one actually covers (100
    // samples) fits the 250-sample window easily. `SegmentEditor` clamps its own
    // endpoints, so the recorder cannot produce these spans today; this pins the
    // function as total, which is what lets the branch above be trusted by the
    // next caller rather than re-derived.
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

/**
 * The seed span the edit toggle opens with (#554, tail rule C).
 *
 * The requirements owner's report: the frame used to open CENTERED on the
 * playhead, so the line sat inside the span it had just created. A span a
 * translator is about to cut or audition runs from the line FORWARD, which is
 * also the record/paste mental model — the line is where the next thing
 * begins.
 *
 * Two properties carry the whole rule, and the cases below are chosen to pin
 * them rather than to enumerate coordinates: the left edge is AT the playhead
 * wherever there is room to the right, and the span never leaves the buffer —
 * it slides back off the end instead (rule C). At the append rest
 * (`pan === length`, the state every fresh open of the sheet starts in) that
 * is the difference between a usable span and an empty one.
 */
describe("seedSelection", () => {
  const LENGTH = 1000;
  // Whole zoom: the viewport spans the clip, so the seed is a quarter of it.
  const WHOLE_SPAN = 250;

  it("puts the left edge AT the playhead when there is room to the right", () => {
    // The #554 assertion itself. The centred rule put the span at `{250, 550}`
    // around 400, which is what the report is about.
    expect(seedSelection(LENGTH, 400, LENGTH)).toEqual({
      start: 400,
      end: 650,
    });
  });

  it("anchors at the very start of the clip", () => {
    expect(seedSelection(LENGTH, 0, LENGTH)).toEqual({ start: 0, end: 250 });
  });

  it("anchors at the last playhead position that still fits a full span", () => {
    // 750 = length - span: the boundary between "left edge at the playhead"
    // and the slid tail below. Both rules must agree here, or the seed would
    // jump as the playhead crossed it.
    expect(seedSelection(LENGTH, 750, LENGTH)).toEqual({
      start: 750,
      end: 1000,
    });
  });

  it("at the append rest the seed is the last span of the buffer, not empty", () => {
    // A rule that anchored the left edge here and let the right run past the
    // end would be clamped to `{1000, 1000}` by `openSelection`, which
    // `spansWholeSample` calls "nothing selected": Cut and Play would open
    // dead. The span slides left instead and stays full width.
    const seed = seedSelection(LENGTH, LENGTH, LENGTH);
    expect(seed).toEqual({ start: 750, end: 1000 });
    expect(spansWholeSample(seed)).toBe(true);
  });

  it("slides left through the tail rather than narrowing to a hairline", () => {
    // Anywhere in the last span-width the playhead sits INSIDE the span — there
    // is not a full span of audio to its right — but the width is constant, so
    // the two handles never land on top of each other.
    const seed = seedSelection(LENGTH, 900, LENGTH);
    expect(seed).toEqual({ start: 750, end: 1000 });
    expect(seed.end - seed.start).toBe(WHOLE_SPAN);
  });

  it("is a fraction of the VISIBLE window, not of the clip", () => {
    // Quarter zoom: 250 visible, so a 62.5-sample seed.
    expect(seedSelection(LENGTH, 100, 250)).toEqual({
      start: 100,
      end: 162.5,
    });
    // And the same tail slide, measured against the buffer rather than the view.
    expect(seedSelection(LENGTH, LENGTH, 250)).toEqual({
      start: 937.5,
      end: 1000,
    });
  });

  it("fits the quarter-zoom window when zoomed from the append rest (#567)", () => {
    // Edit mode opens at whole zoom with the line at the append rest, so this
    // seed is the one every fresh open starts with. Zooming to a quarter then
    // fits the view to it through `panForZoom`; a seed wider than the quarter
    // window takes its wider-than-the-window branch, which pins the START and
    // leaves the END handle off the right of the stage. Both edges must land
    // inside the window the zoom produces.
    const CF = 0.5;
    const seed = seedSelection(LENGTH, LENGTH, LENGTH);
    const pan = panForZoom(LENGTH, LENGTH, 4, CF, seed);
    const view = viewportWindow(LENGTH, pan, 4, CF);
    expect(seed.start).toBeGreaterThanOrEqual(view.start);
    expect(seed.end).toBeLessThanOrEqual(view.end);
  });

  it("is total on an empty buffer", () => {
    // Unreachable in the app — the seed is only taken when there is audio —
    // but the function has no guard, so pin that it degenerates rather than
    // producing NaN.
    expect(seedSelection(0, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("never runs past either end of the buffer, at either zoom", () => {
    // The invariant, so a later edit cannot reintroduce an overrun that
    // `openSelection`'s per-endpoint clamp would silently truncate.
    for (const zoom of [1, 4]) {
      const visible = LENGTH / zoom;
      for (let c = 0; c <= LENGTH; c += 25) {
        const seed = seedSelection(LENGTH, c, visible);
        expect(seed.start).toBeGreaterThanOrEqual(0);
        expect(seed.end).toBeLessThanOrEqual(LENGTH);
        expect(seed.end - seed.start).toBeCloseTo(0.25 * visible);
      }
    }
  });
});

/**
 * The playback strip (#415/#416/#417): during playback the waveform scrolls
 * under a centerline that never moves, so the drawn geometry stops being "a
 * window that follows the pan" and becomes "one strip, translated".
 *
 * The strip is drawn ONCE per play — the clip plus a viewport's worth of blank
 * split across its two ends — and each frame moves it by a single transform.
 * That is why both halves are here as arithmetic: `playbackStrip` says what to
 * draw and how wide it is, `playbackStripOffset` says where to put it, and the
 * property that matters (the sounding sample sits under the line, always) is a
 * composition of the two rather than something either can promise alone.
 */
describe("playbackStrip / playbackStripOffset", () => {
  const CENTER = 0.5;
  const LEN = 1000;

  /**
   * Where a sample lands across the STAGE, as a fraction of the stage width —
   * 0 the left edge, 1 the right, `CENTER` the centerline. This is the
   * composition the component performs in CSS (`width: widthFactor * 100%`
   * plus `translateX(offset * 100%)` of the strip's own width), written out
   * here so the invariant is asserted end to end rather than one function at a
   * time. It calls the production functions; it does not restate their math.
   */
  function stageX(sample: number, position: number, zoom: number): number {
    const visible = LEN / zoom;
    const strip = playbackStrip(LEN, visible, CENTER);
    const offset = playbackStripOffset(position, LEN, visible);
    const withinStrip =
      (sample / LEN - strip.startFraction) /
      (strip.endFraction - strip.startFraction);
    return (withinStrip + offset) * strip.widthFactor;
  }

  it("pads the clip with a viewport of blank, split at the centerline", () => {
    // Whole zoom: half a viewport (= half the clip) of blank at each end.
    const whole = playbackStrip(LEN, LEN, CENTER);
    expect(whole.startFraction).toBeCloseTo(-0.5);
    expect(whole.endFraction).toBeCloseTo(1.5);
    expect(whole.widthFactor).toBeCloseTo(2);

    // Quarter zoom: the blank is half a VIEWPORT, not half a clip, so the strip
    // is five viewports wide and the overhang is an eighth of the clip.
    const quarter = playbackStrip(LEN, LEN / 4, CENTER);
    expect(quarter.startFraction).toBeCloseTo(-0.125);
    expect(quarter.endFraction).toBeCloseTo(1.125);
    expect(quarter.widthFactor).toBeCloseTo(5);
  });

  it("splits the blank by centerFraction, keeping the width the same", () => {
    // A line at a quarter of the width needs only a quarter viewport of blank
    // ahead of the clip's start, and three quarters after its end. The total
    // padding — and so the strip's width — is one viewport either way.
    const strip = playbackStrip(LEN, LEN, 0.25);
    expect(strip.startFraction).toBeCloseTo(-0.25);
    expect(strip.endFraction).toBeCloseTo(1.75);
    expect(strip.widthFactor).toBeCloseTo(2);
  });

  it("puts the sounding sample under the centerline, at every position and zoom", () => {
    for (const zoom of [1, 4]) {
      for (const position of [0, 1, 250, 500, 999, LEN]) {
        expect(stageX(position, position, zoom)).toBeCloseTo(CENTER);
      }
    }
  });

  it("clamps the position to the clip — the line never runs past either end", () => {
    // #416: "The playhead must not scroll past the end of the recorded
    // waveform. The end sample is the clamp... Symmetrically, it cannot scroll
    // before the first sample."
    expect(playbackStripOffset(LEN * 3, LEN, LEN)).toBeCloseTo(
      playbackStripOffset(LEN, LEN, LEN)
    );
    expect(playbackStripOffset(-LEN, LEN, LEN)).toBeCloseTo(
      playbackStripOffset(0, LEN, LEN)
    );
    // And the clamp is what keeps the clip's own edge on the line rather than
    // letting blank space drift under it.
    expect(stageX(LEN, LEN * 3, 1)).toBeCloseTo(CENTER);
    expect(stageX(0, -LEN, 1)).toBeCloseTo(CENTER);
  });

  it("starts with the clip's first sample on the line and blank to its left", () => {
    // #415, "at the start": the waveform begins under the red line, there is no
    // audio to the left of it, and the clip runs off the right edge.
    expect(stageX(0, 0, 1)).toBeCloseTo(0.5);
    expect(stageX(LEN, 0, 1)).toBeCloseTo(1.5);
  });

  it("shows the whole clip exactly once, at the midpoint (whole zoom)", () => {
    // #415, "at the exact midpoint: the whole waveform is on screen (half left
    // of centre, half right). This is the ONLY moment the entire segment is
    // visible in the editor." Both edges land on the stage edges.
    expect(stageX(0, LEN / 2, 1)).toBeCloseTo(0);
    expect(stageX(LEN, LEN / 2, 1)).toBeCloseTo(1);
    // A hair either side and one edge has left the screen, which is what makes
    // the midpoint the only such moment.
    expect(stageX(0, LEN / 2 + 10, 1)).toBeLessThan(0);
    expect(stageX(LEN, LEN / 2 - 10, 1)).toBeGreaterThan(1);
  });

  it("ends with the clip's last sample on the line and blank to its right", () => {
    // #415, "at the end": the waveform has scrolled off the left, and the blank
    // runs from the line to the right edge.
    expect(stageX(LEN, LEN, 1)).toBeCloseTo(0.5);
    expect(stageX(0, LEN, 1)).toBeCloseTo(-0.5);
  });

  it("scrolls the waveform leftward as playback advances, never rightward", () => {
    let previous = Infinity;
    for (const position of [0, 100, 200, 500, 800, LEN]) {
      const offset = playbackStripOffset(position, LEN, LEN);
      expect(offset).toBeLessThan(previous);
      previous = offset;
    }
  });
});
