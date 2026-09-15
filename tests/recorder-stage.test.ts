import { describe, expect, it } from "vitest";

import {
  liveScopeShown,
  stageView,
  type StageState,
} from "@/components/recorder-stage";

/**
 * Base state: idle, empty segment, tap healthy, no preview. Every case overrides
 * only the fields it is about, so a reader sees exactly what drives the branch.
 */
function stage(overrides: Partial<StageState> = {}): StageState {
  return {
    recording: false,
    paused: false,
    processing: false,
    isClosing: false,
    hasAudio: false,
    meterFailed: false,
    previewShown: false,
    ...overrides,
  };
}

/** The four take-in-flight states, each of which should drive the live scope. */
const IN_FLIGHT: Array<Partial<StageState>> = [
  { recording: true },
  { paused: true },
  { processing: true },
  { isClosing: true },
];

describe("liveScopeShown — the live scope drives the whole take-in-flight window", () => {
  it.each(IN_FLIGHT)("shows the live scope while %o", (s) => {
    expect(liveScopeShown(stage(s))).toBe(true);
  });

  it("shows nothing at idle, with or without existing audio", () => {
    expect(liveScopeShown(stage())).toBe(false);
    expect(liveScopeShown(stage({ hasAudio: true }))).toBe(false);
  });
});

describe("liveScopeShown — an append renders exactly like a first take (#283)", () => {
  // The regression guard for #283. The first take path already worked; the bug
  // was that an append (existing audio) was routed to Waveform and never grew.
  // Prior audio must NEVER change the decision — reintroduce any `hasAudio` gate
  // and one of these dies.
  it.each(IN_FLIGHT)("ignores hasAudio in the %o state", (s) => {
    expect(liveScopeShown(stage({ ...s, hasAudio: true }))).toBe(
      liveScopeShown(stage({ ...s, hasAudio: false }))
    );
  });

  it("grows live while recording a second take (the #283 symptom)", () => {
    expect(liveScopeShown(stage({ recording: true, hasAudio: true }))).toBe(
      true
    );
  });

  it("freezes (not blank / not the old clip) when a second take pauses or closes", () => {
    // George R1 P2: gating the frozen arm on hasAudio swapped LiveScope→Waveform
    // here and flashed blank then the pre-take clip. The live scope must stay.
    expect(liveScopeShown(stage({ paused: true, hasAudio: true }))).toBe(true);
    expect(liveScopeShown(stage({ processing: true, hasAudio: true }))).toBe(
      true
    );
    expect(liveScopeShown(stage({ isClosing: true, hasAudio: true }))).toBe(
      true
    );
  });
});

describe("liveScopeShown — the stage-owning states win", () => {
  it("never shows the live scope when the tap failed", () => {
    for (const s of IN_FLIGHT) {
      expect(liveScopeShown(stage({ ...s, meterFailed: true }))).toBe(false);
    }
  });

  it("never shows it when a preview is up, with or without existing audio", () => {
    // George round 2 (the re-run after `a96a81e`): an append's own preview must
    // ALSO win the stage, not just a first take's. `#101` Play-while-paused
    // `mergeTake`s and sounds the merged buffer regardless of `hasAudio`, so
    // leaving the live scope up here would play audio the stage does not draw,
    // with no playhead over it. Reintroduce a `!hasAudio` condition on this
    // guard (the round-1, `a96a81e` mistake) and the `hasAudio: true` half of
    // this table dies.
    for (const s of IN_FLIGHT) {
      expect(
        liveScopeShown(stage({ ...s, previewShown: true, hasAudio: false }))
      ).toBe(false);
      expect(
        liveScopeShown(stage({ ...s, previewShown: true, hasAudio: true }))
      ).toBe(false);
    }
  });
});

/**
 * The recorder stage's three view-coupled decisions, as a truth table.
 *
 * Rounds 3, 4 and 5 of this PR's review each found the same defect wearing a
 * different hat — the paste marker, then zoom, then Select — and each time the
 * answer was "this control assumes the pan/zoom window while something else is
 * drawn". Three instances is a class, not a coincidence, so the decision is
 * made once, here, where it can be enumerated and pinned; `recorder.tsx` reads
 * the answers rather than re-deriving them per control.
 *
 * The axes are the four the recorder actually varies: which mode the sheet is
 * in, whether a buffer is sounding, whether a selection frame is up, and
 * whether a paused-take preview is on the stage.
 */

const base = {
  mode: "edit",
  playingBuffer: false,
  selectionActive: false,
  previewShown: false,
} as const;

describe("stageView", () => {
  it("draws the pan window and shows the line when nothing is sounding", () => {
    // Edit mode, idle: the ordinary editing state.
    expect(stageView(base)).toEqual({
      wholeView: false,
      centerlineHidden: false,
      windowControlsInert: false,
    });
    expect(stageView({ ...base, selectionActive: true })).toEqual({
      wholeView: false,
      centerlineHidden: false,
      windowControlsInert: false,
    });
  });

  it("swaps to the whole clip for a record-mode play", () => {
    // The playhead must stay on screen and the pan window is not what a
    // listener is following (George R1 G1 on #102).
    expect(stageView({ ...base, mode: "record", playingBuffer: true })).toEqual(
      {
        wholeView: true,
        centerlineHidden: true,
        windowControlsInert: true,
      }
    );
  });

  it("swaps to the whole clip for an audition with no span picked", () => {
    // "line"/"whole": nothing is drawn through the pan window that has to stay
    // aligned, and keeping that window would sound audio that is off screen.
    expect(stageView({ ...base, playingBuffer: true })).toEqual({
      wholeView: true,
      centerlineHidden: true,
      windowControlsInert: true,
    });
  });

  it("keeps the pan window for an audition of a picked span", () => {
    // The band is positioned through that window, and hearing exactly the span
    // it marks is the point — so the view stays put. The line still hides:
    // a second static vertical line beside a travelling playhead reads as
    // "insert here" to someone who cannot read the screen (George R4 P3).
    expect(
      stageView({ ...base, playingBuffer: true, selectionActive: true })
    ).toEqual({
      wholeView: false,
      centerlineHidden: true,
      windowControlsInert: true,
    });
  });

  it("plays in place only in EDIT mode, never on a stale record-mode span", () => {
    // A selection can survive into record mode: the permission panel's Retry
    // (`onRetryRecord`) flips the mode and starts the mic without closing the
    // frame, unlike every other route out of edit. Playing in place on that
    // stale flag would hand a record-mode play the pan window — the exact defect
    // the whole-clip swap exists to prevent. Mutation found this: dropping the
    // mode test from the in-place rule left the suite green until this case.
    expect(
      stageView({
        ...base,
        mode: "record",
        playingBuffer: true,
        selectionActive: true,
      })
    ).toEqual({
      wholeView: true,
      centerlineHidden: true,
      windowControlsInert: true,
    });
  });

  it("swaps to the whole clip for a paused-take preview, span or not", () => {
    // The preview draws its own peaks across the whole stage (#101), so it is
    // never shown through the pan window.
    expect(stageView({ ...base, mode: "record", previewShown: true })).toEqual({
      wholeView: true,
      centerlineHidden: true,
      windowControlsInert: false,
    });
    expect(
      stageView({ ...base, previewShown: true, selectionActive: true })
    ).toEqual({
      wholeView: true,
      centerlineHidden: true,
      windowControlsInert: false,
    });
  });

  it("inerts the window controls for every sounding buffer, in both modes", () => {
    // The one predicate behind the class: while audio sounds, no control may
    // read or move the pan/zoom window. Mode-independent on purpose — it is the
    // same condition the stage pan has always used, which is why the pan is the
    // one control that never had this bug.
    expect(
      stageView({ ...base, playingBuffer: true }).windowControlsInert
    ).toBe(true);
    expect(
      stageView({ ...base, mode: "record", playingBuffer: true })
        .windowControlsInert
    ).toBe(true);
    expect(
      stageView({ ...base, playingBuffer: true, selectionActive: true })
        .windowControlsInert
    ).toBe(true);
    // A preview on the stage is not a sounding buffer: Play is what sounds it,
    // and the paused transport owns those controls (`idleEditable` is already
    // false there).
    expect(stageView({ ...base, previewShown: true }).windowControlsInert).toBe(
      false
    );
  });
});
