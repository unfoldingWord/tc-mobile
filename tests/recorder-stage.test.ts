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
 * The recorder stage's four view-coupled decisions, as a truth table.
 *
 * Rounds 3, 4, 5 and 7 of this PR's review each found the same defect wearing
 * a different hat — the paste marker, then zoom, then Select, then the
 * playhead's own hide rule — and each time the answer was "this control (or
 * overlay) assumes the pan/zoom window while something else is drawn, or
 * assumes every sounding buffer swapped to the whole clip when this one
 * didn't". Repetition is a class, not a coincidence, so the decision is made
 * once, here, where it can be enumerated and pinned; `recorder.tsx` reads the
 * answers rather than re-deriving them per control.
 *
 * The axes are the four the recorder actually varies: which mode the sheet is
 * in, whether a buffer is sounding, whether a selection frame is up, and
 * whether a paused-take preview is on the stage.
 *
 * `centerlineHidden` is pinned `false` in every row below as of #316
 * (requirements owner, 2026-09-16): the vertical centerline is visible
 * ALWAYS in record/edit mode, which reverses this table's own prior values
 * for a swapped whole-clip view and a picked-span in-place audition (both
 * used to be `true`). Mutation check: reintroducing
 * `wholeView || input.playingBuffer` as `centerlineHidden`'s derivation
 * flips every case below except the two idle/no-selection rows back to
 * `true`, and this table dies.
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
      inPlaceAudition: false,
    });
    expect(stageView({ ...base, selectionActive: true })).toEqual({
      wholeView: false,
      centerlineHidden: false,
      windowControlsInert: false,
      inPlaceAudition: false,
    });
  });

  it("swaps to the whole clip for a record-mode play, but keeps the centerline (#316)", () => {
    // The playhead must stay on screen and the pan window is not what a
    // listener is following (George R1 G1 on #102). The centerline used to
    // hide here too (George R2: it would mark a sample no longer drawn under
    // it) — the requirements owner reversed that in #316, so the line is
    // visible regardless.
    expect(stageView({ ...base, mode: "record", playingBuffer: true })).toEqual(
      {
        wholeView: true,
        centerlineHidden: false,
        windowControlsInert: true,
        inPlaceAudition: false,
      }
    );
  });

  it("swaps to the whole clip for an audition with no span picked, but keeps the centerline (#316)", () => {
    // "line"/"whole": nothing is drawn through the pan window that has to stay
    // aligned, and keeping that window would sound audio that is off screen.
    expect(stageView({ ...base, playingBuffer: true })).toEqual({
      wholeView: true,
      centerlineHidden: false,
      windowControlsInert: true,
      inPlaceAudition: false,
    });
  });

  it("keeps the pan window for an audition of a picked span, marks it in-place, and keeps the centerline (#316)", () => {
    // The band is positioned through that window, and hearing exactly the span
    // it marks is the point — so the view stays put. The line used to hide
    // here too: a second static vertical line beside a travelling playhead
    // read as "insert here" to someone who cannot read the screen (George R4
    // P3) — reversed by the requirements owner in #316, so it stays visible.
    //
    // `inPlaceAudition: true` is the ONLY case it is — it is what tells the
    // playhead overlay to clamp a position outside the (unswapped) window to
    // the edge rather than hide (George R7): a picked span wider than the
    // pan/zoom window sounds all of it, but the window itself never widens,
    // so without this the moving cue this whole feature exists to add
    // vanishes the moment playback crosses `win.end`.
    expect(
      stageView({ ...base, playingBuffer: true, selectionActive: true })
    ).toEqual({
      wholeView: false,
      centerlineHidden: false,
      windowControlsInert: true,
      inPlaceAudition: true,
    });
  });

  it("plays in place only in EDIT mode, never on a stale record-mode span", () => {
    // Playing in place is an EDIT-mode idea: a record-mode play must always get
    // the whole-clip view, whatever the selection flag says. This input is not
    // reachable in the app today — the one other `setMode("record")` call site
    // (`onRetryRecord`) does leave the frame open, but it only runs while
    // `denied`, which requires `!hasAudio`, and Select needs audio — so no frame
    // can be open there. It is pinned anyway because this is a pure function:
    // it is asked questions by its type, not by today's call sites, and the
    // answer for this one is the whole-clip view — never in-place, either.
    // Mutation is what surfaced the original gap — dropping `mode === "edit"`
    // from the in-place rule left the suite green.
    expect(
      stageView({
        ...base,
        mode: "record",
        playingBuffer: true,
        selectionActive: true,
      })
    ).toEqual({
      wholeView: true,
      centerlineHidden: false,
      windowControlsInert: true,
      inPlaceAudition: false,
    });
  });

  it("swaps to the whole clip for a paused-take preview, span or not, but keeps the centerline (#316)", () => {
    // The preview draws its own peaks across the whole stage (#101), so it is
    // never shown through the pan window.
    expect(stageView({ ...base, mode: "record", previewShown: true })).toEqual({
      wholeView: true,
      centerlineHidden: false,
      windowControlsInert: false,
      inPlaceAudition: false,
    });
    expect(
      stageView({ ...base, previewShown: true, selectionActive: true })
    ).toEqual({
      wholeView: true,
      centerlineHidden: false,
      windowControlsInert: false,
      inPlaceAudition: false,
    });
  });

  it("never marks a preview in-place, even with a stale selection open", () => {
    // `previewShown` forces `wholeView` regardless of `inPlace`, so
    // `inPlaceAudition` (which requires `!wholeView`) must be false here too —
    // a preview is not a sounding BUFFER in the sense this flag means (Play is
    // what sounds it; the paused transport owns those controls). Mutation:
    // dropping the `!wholeView` half of `inPlaceAudition` and leaving only
    // `input.playingBuffer` would pass every case above but flip this one,
    // since nothing else in the table sets `playingBuffer` and `previewShown`
    // together — this is the case that catches it.
    expect(
      stageView({
        ...base,
        playingBuffer: true,
        previewShown: true,
        selectionActive: true,
      }).inPlaceAudition
    ).toBe(false);
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

describe("stageView — the centerline is visible in EVERY record/edit state (#316)", () => {
  // Requirements owner, 2026-09-16, on #316: "having the line always visible
  // is important in segment record/edit mode" — reversing two decisions this
  // module used to encode (a swapped whole-clip view, George R2; a
  // picked-span in-place audition, George R4 P3). Exhaustive over every
  // `StageInput` combination `stageView` accepts, not just the named
  // scenarios above, so a future edit cannot reintroduce a suppressed case
  // this table happens not to enumerate by name. Mutation check: restoring
  // `centerlineHidden: wholeView || input.playingBuffer` fails every case
  // below where `wholeView` or `playingBuffer` is true.
  const modes = ["record", "edit"] as const;
  const bools = [false, true] as const;

  for (const mode of modes) {
    for (const playingBuffer of bools) {
      for (const selectionActive of bools) {
        for (const previewShown of bools) {
          it(`stays visible for mode=${mode} playingBuffer=${playingBuffer} selectionActive=${selectionActive} previewShown=${previewShown}`, () => {
            expect(
              stageView({ mode, playingBuffer, selectionActive, previewShown })
                .centerlineHidden
            ).toBe(false);
          });
        }
      }
    }
  }
});
