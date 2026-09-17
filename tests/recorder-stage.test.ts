import { describe, expect, it } from "vitest";

import {
  liveScopeShown,
  panGesture,
  resumesOnLift,
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
 * The recorder stage's view-coupled decisions, as a truth table.
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
 * whether a paused-take preview is on the stage. The answer is now ONE value —
 * `render`, the four ways the stage can be drawn — rather than a bag of
 * booleans that could disagree with each other (#415).
 *
 * A fourth decision, `centerlineHidden`, lived in this table from R2 through
 * R4 P3. #316 (requirements owner, 2026-09-16) retired it: the centerline is
 * visible in every state, so `Waveform` now draws it unconditionally
 * whenever a recorder `view` is present, with nothing left for this pure
 * module to decide — see the module docblock above `stageView`. There is
 * deliberately no test here pinning "always visible": that claim now lives
 * entirely in `Waveform`'s canvas draw, which this repo's convention treats
 * as review-only (see this PR's body for what is and is not verified).
 */

const base = {
  mode: "edit",
  playingBuffer: false,
  selectionActive: false,
  previewShown: false,
} as const;

describe("stageView", () => {
  it("draws the pan window when nothing is sounding", () => {
    // Edit mode, idle: the ordinary editing state.
    expect(stageView(base)).toEqual({
      render: "static",
      windowControlsInert: false,
    });
    expect(stageView({ ...base, selectionActive: true })).toEqual({
      render: "static",
      windowControlsInert: false,
    });
  });

  it("scrolls the waveform under the centerline for a record-mode play", () => {
    // #415: one playhead — the red centerline — with the waveform moving under
    // it. Before this the same input returned the whole clip with a second,
    // travelling line over it, which is the two-lines screenshot the issue was
    // filed from.
    expect(stageView({ ...base, mode: "record", playingBuffer: true })).toEqual(
      {
        render: "scroll",
        windowControlsInert: true,
      }
    );
  });

  it("scrolls for an audition with no span picked, at whatever zoom is set", () => {
    // #417. "Zoomed in, then Play" is THIS input: `ZOOM_QUARTER` is reachable
    // only from the edit toolbar, and with no span picked `auditionPlan` sounds
    // the working buffer from the centerline on. It used to force the whole
    // clip, which is the snap-back the issue reports; the zoom itself was never
    // touched by the play path.
    expect(stageView({ ...base, playingBuffer: true })).toEqual({
      render: "scroll",
      windowControlsInert: true,
    });
  });

  it("keeps the pan window for an audition of a picked span, in place", () => {
    // The band is positioned through that window, and hearing exactly the span
    // it marks is the point — so the view stays put and the travelling overlay
    // stays the cue. `"inPlace"` is what tells that overlay to clamp a position
    // outside the (unswapped) window to the edge rather than hide (George R7):
    // a picked span wider than the pan/zoom window sounds all of it, but the
    // window never widens, so without this the moving cue this feature exists
    // to add vanishes the moment playback crosses `win.end`.
    //
    // Deliberately NOT scrolled with the rest of #415: scrolling would slide
    // the band — and its two drag handles — out from under the audio they mark,
    // which is the one thing #284 exists to keep together. Flagged for the
    // requirements owner on #415 rather than decided silently.
    expect(
      stageView({ ...base, playingBuffer: true, selectionActive: true })
    ).toEqual({
      render: "inPlace",
      windowControlsInert: true,
    });
  });

  it("plays in place only in EDIT mode, never on a stale record-mode span", () => {
    // Playing in place is an EDIT-mode idea: a record-mode play scrolls,
    // whatever the selection flag says. This input is not reachable in the app
    // today — the one other `setMode("record")` call site (`onRetryRecord`)
    // does leave the frame open, but it only runs while `denied`, which
    // requires `!hasAudio`, and Select needs audio — so no frame can be open
    // there. It is pinned anyway because this is a pure function: it is asked
    // questions by its type, not by today's call sites. Mutation is what
    // surfaced the original gap — dropping `mode === "edit"` from the in-place
    // rule left the suite green.
    expect(
      stageView({
        ...base,
        mode: "record",
        playingBuffer: true,
        selectionActive: true,
      })
    ).toEqual({
      render: "scroll",
      windowControlsInert: true,
    });
  });

  it("draws the whole clip for a paused-take preview, span or not", () => {
    // The preview draws its own peaks across the whole stage (#101), so it is
    // never shown through the pan window — and it is the ONE state that still
    // does, now that a sounding buffer scrolls instead of swapping.
    expect(stageView({ ...base, mode: "record", previewShown: true })).toEqual({
      render: "whole",
      windowControlsInert: false,
    });
    expect(
      stageView({ ...base, previewShown: true, selectionActive: true })
    ).toEqual({
      render: "whole",
      windowControlsInert: false,
    });
  });

  it("a sounding preview is whole, never in-place and never scrolled", () => {
    // A preview outranks both: it is a different buffer (the merged take, #101)
    // whose samples have no relationship to the working buffer's pan, so
    // neither the pan window nor a position within `working` means anything
    // here. Mutation: ordering the preview test after the sounding ones — or
    // dropping it from the scroll rule — flips exactly this case, since nothing
    // else in the table sets `playingBuffer` and `previewShown` together.
    expect(
      stageView({
        ...base,
        playingBuffer: true,
        previewShown: true,
        selectionActive: true,
      }).render
    ).toBe("whole");
    expect(
      stageView({
        ...base,
        mode: "record",
        playingBuffer: true,
        previewShown: true,
      }).render
    ).toBe("whole");
  });

  it("never draws the whole clip for a sounding buffer (the #415 regression)", () => {
    // The pin for the defect itself, across every mode/selection combination:
    // with no preview on the stage, a sounding buffer must never swap the view.
    // Restore `playingBuffer && !inPlace` to the whole-view rule and this dies.
    for (const mode of ["record", "edit"] as const) {
      for (const selectionActive of [false, true]) {
        expect(
          stageView({ ...base, mode, selectionActive, playingBuffer: true })
            .render
        ).not.toBe("whole");
      }
    }
  });

  it("inerts the window controls for every sounding buffer, in both modes", () => {
    // The one predicate behind the class: while audio sounds, no control may
    // read or move the pan/zoom window. Mode-independent on purpose.
    //
    // The stage PAN is no longer in the class (#317, the requirements owner,
    // 2026-09-16): touching the waveform pauses playback first, so the drag
    // never runs against a moving window. It carries its own guard in
    // `recorder.tsx`; this flag still speaks for Zoom, Select and the paste
    // marker.
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

/**
 * What a finger landing on the waveform does (#317), and what lifting it does.
 *
 * The requirements owner's 16 Sep answer reversed D4 ("playback is listen-only
 * — no scrub in v1") for exactly one gesture: "dragging while playing is fine.
 * The moment the finger touches the waveform, playback PAUSES; the waveform
 * follows the finger; when the finger lifts, playback RESUMES from the sample
 * under the centerline. Playback never runs while the finger is down."
 *
 * A reversal that narrow is a rule, not a condition to inline: it has to hold
 * for one sounding state and keep holding for the two it did not reverse. So it
 * is pure and enumerated here, which is also the only way any of #317 can be
 * covered without a phone — the gesture itself is pointer events on a canvas.
 */
const gesture = {
  hasAudio: true,
  recording: false,
  paused: false,
  busy: false,
  playingBuffer: false,
  render: "static",
} as const;

describe("panGesture", () => {
  it("pans when nothing is sounding — the gesture as it always was", () => {
    expect(panGesture(gesture)).toBe("pan");
    // Edit mode with a frame open pans too: a span can grow past the viewport,
    // and panning is the only way to bring an off-screen handle back in reach.
    expect(panGesture({ ...gesture, render: "static" })).toBe("pan");
  });

  it("refuses without audio, and through a live or committing take", () => {
    // F11 (nothing to slide), #61 (the insertion offset is locked at the Record
    // tap, so the line must not move out from under it during `requesting`),
    // and a paused take for the same reason.
    expect(panGesture({ ...gesture, hasAudio: false })).toBe("ignore");
    expect(panGesture({ ...gesture, recording: true })).toBe("ignore");
    expect(panGesture({ ...gesture, paused: true })).toBe("ignore");
    expect(panGesture({ ...gesture, busy: true })).toBe("ignore");
  });

  it("takes a scrolling playback over: the touch pauses it (#317)", () => {
    expect(
      panGesture({ ...gesture, playingBuffer: true, render: "scroll" })
    ).toBe("interrupt");
  });

  it("still refuses the two sounding states #317 did not reverse", () => {
    // A paused-take preview draws a DIFFERENT buffer, whose pan means nothing;
    // a picked-span audition would slide the band and its handles off the audio
    // they mark while that audio sounds. Neither is what the requirements owner
    // described, and D4 stands for both. Mutation: widen the rule to "any
    // sounding buffer can be taken over" and both of these die.
    expect(
      panGesture({ ...gesture, playingBuffer: true, render: "whole" })
    ).toBe("ignore");
    expect(
      panGesture({ ...gesture, playingBuffer: true, render: "inPlace" })
    ).toBe("ignore");
  });

  it("never takes over a take — the mic outranks the gesture", () => {
    // `render` cannot be "scroll" during a live take today (Record and Play are
    // mutually exclusive), but the take terms are checked FIRST regardless: a
    // gesture that stopped playback while the mic was live would still be
    // moving the locked insertion offset. Mutation: order the playback branch
    // above the take terms and this dies.
    expect(
      panGesture({
        ...gesture,
        recording: true,
        playingBuffer: true,
        render: "scroll",
      })
    ).toBe("ignore");
  });

  it("does not take over a NON-sounding preview left on the stage", () => {
    // `previewShown` outlives the sound (it stays up through `busy` and the
    // close window, #101). With nothing sounding there is nothing to pause, so
    // this is an ordinary pan, exactly as it was before #317.
    expect(panGesture({ ...gesture, render: "whole" })).toBe("pan");
  });
});

describe("resumesOnLift", () => {
  const LEN = 1000;

  it("resumes only when this gesture was the one that paused playback", () => {
    expect(resumesOnLift(true, 500, LEN)).toBe(true);
    // A pan that began at idle has nothing to resume: starting playback on a
    // lift the translator never associated with a sound would be the app
    // speaking unasked.
    expect(resumesOnLift(false, 500, LEN)).toBe(false);
  });

  it("does not resume with the line dragged to the very end", () => {
    // There is nothing left to sound, and the take stays parked where the line
    // is — which is the position Record and Paste then act on, the point of the
    // gesture. Deliberately NOT `auditionPlan`'s rest fallback (at the end,
    // "from the line" sounds the WHOLE buffer): as a fresh Play that reads as
    // "play the segment", but as a resume it would restart from the beginning.
    expect(resumesOnLift(true, LEN, LEN)).toBe(false);
    // Past the end (a stale pan after a cut) is the same answer.
    expect(resumesOnLift(true, LEN + 500, LEN)).toBe(false);
  });

  it("resumes from the first sample", () => {
    // Dragged all the way back: there is a whole clip to play.
    expect(resumesOnLift(true, 0, LEN)).toBe(true);
  });

  it("never resumes on an empty segment", () => {
    expect(resumesOnLift(true, 0, 0)).toBe(false);
  });
});
