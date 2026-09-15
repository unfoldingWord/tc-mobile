import { describe, expect, it } from "vitest";

import { stageView } from "@/components/recorder-stage";

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
