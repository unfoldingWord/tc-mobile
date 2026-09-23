import { describe, expect, it } from "vitest";

import {
  centerlineOverlayShown,
  dragOriginAfterInterrupt,
  frozenPan,
  heldByDrag,
  liftOutcome,
  liveScopeShown,
  panAfterCommit,
  panAfterCutCollapse,
  panAfterDragMove,
  panAfterInsert,
  panAfterRedo,
  panAfterUndo,
  panOrRest,
  panGesture,
  recordDisabled,
  resumesOnLift,
  stageView,
  type StageState,
} from "@/components/recorder-stage";
import {
  emptyLog,
  materialize,
  opRedone,
  opUndone,
  pushOp,
  undo as logUndo,
  type EditOp,
} from "@/lib/audio/edit-log";
import {
  effectivePan,
  panAfterCut,
  viewportWindow,
} from "@/lib/audio/viewport";

/**
 * Base state: idle, empty segment, tap healthy. Every case overrides only the
 * fields it is about, so a reader sees exactly what drives the branch.
 */
function stage(overrides: Partial<StageState> = {}): StageState {
  return {
    recording: false,
    processing: false,
    isClosing: false,
    hasAudio: false,
    meterFailed: false,
    ...overrides,
  };
}

/**
 * The take-in-flight states, each of which should drive the live scope.
 *
 * It was four. `{ paused: true }` was the fourth, and #614 removed the state
 * itself: the tap that ends a recording commits it, so a take is live, being
 * committed, or on the waveform — never suspended.
 */
const IN_FLIGHT: Array<Partial<StageState>> = [
  { recording: true },
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

  it("freezes (not blank / not the old clip) while a second take commits", () => {
    // George R1 P2: gating the frozen arm on hasAudio swapped LiveScope→Waveform
    // here and flashed blank then the pre-take clip. The live scope must stay.
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

  it("hands the stage back the moment the take leaves the in-flight window", () => {
    // #614's visible half. Everything that made the recorder's own state
    // special — the frozen ring, the refused pan, the preview — ended at the
    // commit; the second `liveScopeShown` term used to keep it alive through an
    // open paused take instead. With every in-flight flag down the ordinary
    // `Waveform` path drives the stage, which is what makes the just-recorded
    // take pannable, playable and editable at once.
    expect(liveScopeShown(stage({ hasAudio: true }))).toBe(false);
    expect(liveScopeShown(stage())).toBe(false);
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
 * R4 P3. #316 (requirements owner, 2026-09-16) retired it as a decision made
 * HERE: the line is always visible in this table's terms, with one exception
 * carved out later and kept in its own pure function instead —
 * `centerlineOverlayShown`, below, hides the line for a selection span
 * loaded in edit mode (#418) or while `liveScope` owns the stage — see the
 * module docblock above `stageView`.
 *
 * Since #415 the line is not painted into the canvas AT ALL. A strip that
 * translates would carry a painted line with it — the travelling second
 * playhead the issue was filed against — so the line is a fixed DOM element on
 * the stage, a sibling of the canvas (`recorder.tsx`'s centerline overlay),
 * mounted wherever the `Waveform` path is. `LiveScope` still paints its own
 * record head during capture, which is a different line on a different path.
 * Restoring a `drawCenterline` on the canvas would bring #415's defect straight
 * back, which is why this paragraph says where the line lives rather than
 * leaving it to be rediscovered (George R6 P3).
 *
 * There is deliberately no test here pinning "always visible": that claim lives
 * in JSX and CSS, which this repo's convention treats as review-only (see this
 * PR's body for what is and is not verified).
 */

const base = {
  mode: "edit",
  playingBuffer: false,
  selectionActive: false,
  previewShown: false,
  dragging: false,
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

  it("has no fourth, whole-clip render left (#614)", () => {
    // `"whole"` drew the #101 paused-take preview at clip fractions 0..1, and
    // it was the ONE render in which the pan meant nothing — which is why
    // `panGesture` had to refuse a drag under it. The preview went with the
    // paused take, so every state this table can reach is drawn THROUGH the pan
    // window or scrolled under the line, and a finger always has something real
    // to move. Mutation: reintroduce any arm that answers `"whole"` and this
    // dies, because nothing else can produce it.
    const renders = new Set(
      [
        stageView(base),
        stageView({ ...base, mode: "record" }),
        stageView({ ...base, playingBuffer: true }),
        stageView({ ...base, playingBuffer: true, selectionActive: true }),
        stageView({ ...base, selectionActive: true }),
        stageView({ ...base, dragging: true }),
      ].map((v) => v.render)
    );
    expect(renders).toEqual(new Set(["static", "scroll", "inPlace"]));
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
  });

  it("inerts the window controls while a finger owns the stage (#317)", () => {
    // George R2 P1. The #317 touch PAUSES playback before the drag starts, so
    // `playingBuffer` — the term this flag used to be — goes false while the
    // finger is still down and the pan is still moving. Zoom, Select and the
    // paste marker would come back to life mid-gesture, each acting on a window
    // that slides out from under it a frame later.
    expect(stageView({ ...base, dragging: true }).windowControlsInert).toBe(
      true
    );
    expect(
      stageView({ ...base, mode: "record", dragging: true }).windowControlsInert
    ).toBe(true);
  });

  it("does not change WHAT is drawn while dragging", () => {
    // A drag pans the static window; it is not a fourth way of drawing the
    // stage. Fold `dragging` into `render` and a pan would swap the view out
    // from under the finger.
    expect(stageView({ ...base, dragging: true }).render).toBe("static");
    expect(
      stageView({ ...base, dragging: true, playingBuffer: true }).render
    ).toBe("scroll");
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
  busy: false,
  isClosing: false,
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
    // F11 (nothing to slide) and #61 (the insertion offset is locked at the
    // Record tap, so the line must not move out from under it while the
    // capture or its commit is in flight).
    expect(panGesture({ ...gesture, hasAudio: false })).toBe("ignore");
    expect(panGesture({ ...gesture, recording: true })).toBe("ignore");
    expect(panGesture({ ...gesture, busy: true })).toBe("ignore");
  });

  it("refuses through the COMMIT, which `busy` does not cover (George pass C P1)", () => {
    // `stop()` returns the recorder to `idle` before `saveRecording` and
    // `reloadView` have run, so this whole multi-megabyte window has
    // `recording` and `busy` both false — and #614 keeps the sheet open across
    // it, frozen scope and "Saving…" notice, with a waveform under the finger.
    // A pan started here would be rebased over `panAfterCommit`'s rest on the
    // next move, putting the next Record's splice inside the take being saved.
    // Mutation: drop `isClosing` from `captureLocksPan` and this dies while
    // every case around it stays green — which is exactly how it was missed.
    expect(panGesture({ ...gesture, isClosing: true })).toBe("ignore");
    // And it is the take term, not a playback term: it refuses ahead of the
    // one sounding state #317 reversed, the same way `recording` does.
    expect(
      panGesture({
        ...gesture,
        isClosing: true,
        playingBuffer: true,
        render: "scroll",
      })
    ).toBe("ignore");
  });

  it("pans a take that has just been committed — #614's whole point", () => {
    // The reported bug: right after recording, the waveform would not scroll.
    // The refusal that caused it was a fourth term, `paused`, beside the three
    // above — the take was still open with its offset locked for a Resume, so
    // the line could not move. Option A ends the take at the tap, so with the
    // mic idle and nothing sounding a finger on the stage PANS. Mutation: add
    // any term that stays true after the tap that ends a recording and this
    // dies; the other three cases above stay green, which is exactly how the
    // bug survived.
    expect(
      panGesture({
        hasAudio: true,
        recording: false,
        busy: false,
        // COMMITTED, not committing: the write has landed. The case above is
        // the other half of that line.
        isClosing: false,
        playingBuffer: false,
        render: "static",
      })
    ).toBe("pan");
  });

  it("takes a scrolling playback over: the touch pauses it (#317)", () => {
    expect(
      panGesture({ ...gesture, playingBuffer: true, render: "scroll" })
    ).toBe("interrupt");
  });

  it("still refuses the sounding state #317 did not reverse", () => {
    // A picked-span audition would slide the band and its handles off the audio
    // they mark while that audio sounds. That is not what the requirements
    // owner described, and D4 stands. Mutation: widen the rule to "any sounding
    // buffer can be taken over" and this dies. (The other refused state,
    // `"whole"`, went with the #101 preview at #614.)
    expect(
      panGesture({ ...gesture, playingBuffer: true, render: "inPlace" })
    ).toBe("ignore");
  });

  it("never takes over a take — the mic outranks the gesture", () => {
    // `render` cannot be "scroll" during a live take today (Record and Play are
    // mutually exclusive), but the take term is checked FIRST regardless: a
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
});

describe("resumesOnLift", () => {
  const LEN = 1000;
  const lift = {
    interrupted: true,
    pan: 500,
    length: LEN,
    takeActive: false,
    othersDown: false,
  };

  it("resumes only when this gesture was the one that paused playback", () => {
    expect(resumesOnLift(lift)).toBe(true);
    // A pan that began at idle has nothing to resume: starting playback on a
    // lift the translator never associated with a sound would be the app
    // speaking unasked.
    expect(resumesOnLift({ ...lift, interrupted: false })).toBe(false);
  });

  it("never sounds over a take that started during the drag (#61)", () => {
    // George R1 P2 #3, the second half. Record is dead while a finger owns the
    // stage, but a tap landing in the same frame as the pointer-down is ahead
    // of that render — and a resume into a live or paused mic would either be
    // refused by the floor (a silent failure the translator cannot explain) or
    // sound over a capture. The lift simply owes nothing once a take exists.
    expect(resumesOnLift({ ...lift, takeActive: true })).toBe(false);
  });

  it("does not resume with the line dragged to the very end", () => {
    // There is nothing left to sound, and the take stays parked where the line
    // is — which is the position Record and Paste then act on, the point of the
    // gesture. Deliberately NOT `auditionPlan`'s rest fallback (at the end,
    // "from the line" sounds the WHOLE buffer): as a fresh Play that reads as
    // "play the segment", but as a resume it would restart from the beginning.
    expect(resumesOnLift({ ...lift, pan: LEN })).toBe(false);
    // Past the end (a stale pan after a cut) is the same answer.
    expect(resumesOnLift({ ...lift, pan: LEN + 500 })).toBe(false);
  });

  it("resumes from the first sample", () => {
    // Dragged all the way back: there is a whole clip to play.
    expect(resumesOnLift({ ...lift, pan: 0 })).toBe(true);
  });

  it("never resumes on an empty segment", () => {
    expect(resumesOnLift({ ...lift, pan: 0, length: 0 })).toBe(false);
  });

  it("never sounds while another finger is still on the stage (#317)", () => {
    // The requirements owner's rule is about FINGERS, not about the one this
    // gesture happens to track: "playback never runs while the finger is down"
    // (George R3 P1-2). A second contact that the stage ignored is still a
    // finger on the waveform, so the owner lifting first must leave silence —
    // the resume is owed until the stage is clear, and a later Play is how it
    // is collected.
    expect(resumesOnLift({ ...lift, othersDown: true })).toBe(false);
  });
});

/**
 * What a lift leaves behind (Frank R3 P2, twice).
 *
 * `resumesOnLift` answers one question — does sound start? — and a lift asks
 * three, because the stage can outlive the pointer that owned it. The lock has
 * to hold while ANY finger is on the waveform (otherwise the owner lifting
 * first re-enables Play, Record, Undo, Zoom and Select with a finger still
 * down), and a resume the lift cannot perform has to survive as a debt rather
 * than be consumed into silence. Those are state transitions, not a predicate,
 * and there is no renderer in this suite — so they are enumerated here, where
 * the owner-up-before-non-owner-up order is a test rather than a phone.
 */
describe("liftOutcome", () => {
  const LEN = 1000;
  const base = {
    wasOwner: true,
    ownerActive: false,
    contactsRemaining: 0,
    interrupted: true,
    pan: 500,
    length: LEN,
    takeActive: false,
  };

  it("resumes and unlocks when the last finger leaves", () => {
    expect(liftOutcome(base)).toEqual({
      dragging: false,
      resume: true,
      keepOwed: false,
      // The stage is clear but SOUNDING: a frame seeded here would draw a
      // band over the resumed tail (#613, Frank R1 P2).
      reopenFrame: false,
    });
  });

  it("keeps the lock AND the debt when the owner lifts first", () => {
    // The exact order Frank named: finger A owns the drag, finger B lands, A
    // lifts. B is still on the waveform, so nothing may sound and no control
    // may come back to life — a third finger tapping Play here is the
    // requirement broken with the app's own help.
    expect(liftOutcome({ ...base, contactsRemaining: 1 })).toEqual({
      dragging: true,
      resume: false,
      keepOwed: true,
      // A finger is still down: the gesture has not ended, so no frame.
      reopenFrame: false,
    });
  });

  it("collects the debt on the lift that finally clears the stage", () => {
    // B's own lift, after A is gone: not the owner, but the moment the stage
    // goes clear, which is when the owed resume is finally due.
    expect(
      liftOutcome({ ...base, wasOwner: false, contactsRemaining: 0 })
    ).toEqual({
      dragging: false,
      resume: true,
      keepOwed: false,
      reopenFrame: false,
    });
  });

  it("ignores a non-owner's lift while the owner is still dragging", () => {
    // The debt is untouched and the lock stands: the owner has not lifted.
    expect(
      liftOutcome({
        ...base,
        wasOwner: false,
        ownerActive: true,
        contactsRemaining: 1,
      })
    ).toEqual({
      dragging: true,
      resume: false,
      keepOwed: true,
      reopenFrame: false,
    });
  });

  it("drops a debt it refuses for any reason other than a finger", () => {
    // The line at the very end, and a take that started mid-gesture: both are
    // final answers, not deferrals. Leaving the flag set would fire the resume
    // on some later, unrelated lift.
    // Both leave the stage clear and silent, so both DO seed a frame again:
    // the refusal is about the resume, not about the gesture having ended.
    expect(liftOutcome({ ...base, pan: LEN })).toEqual({
      dragging: false,
      resume: false,
      keepOwed: false,
      reopenFrame: true,
    });
    expect(liftOutcome({ ...base, takeActive: true })).toEqual({
      dragging: false,
      resume: false,
      keepOwed: false,
      reopenFrame: true,
    });
  });

  it("owes nothing on a plain pan that never interrupted anything", () => {
    expect(liftOutcome({ ...base, interrupted: false })).toEqual({
      dragging: false,
      resume: false,
      keepOwed: false,
      // The ordinary #613 gesture: pan, lift, pick a new span.
      reopenFrame: true,
    });
  });
});

/**
 * Where the view is left when playback stops (#416), and why it is not simply
 * "the last position the frame loop saw".
 *
 * The scrolling position is pulled on an rAF, so the newest value a ref can
 * hold is up to one frame old — and the audio position is gone the instant the
 * handle is cleared. Freezing that stale value would undo the promise the issue
 * makes ("the waveform and the playhead stay exactly where playback had
 * reached") in two different ways, both of which Frank's round-1 P2 names: a
 * Pause would rewind by a frame's worth of audio, and a clip that ran out would
 * park the line ~16 ms SHORT of the end, where the next Record inserts instead
 * of appending.
 *
 * So the three endings are told apart rather than averaged, and each is TOLD to
 * this function rather than inferred from how far the frame loop got. An
 * explicit stop samples the true position synchronously, before the handle
 * goes. Running out is reported by the playback boundary itself (`playBuffer`'s
 * `onEnded`, which fires only for a clip that was not stopped by hand) and has
 * an exact answer that needs no sampling at all: the end of the range. Anything
 * else — a play that never started, a superseded claim — leaves the line alone.
 *
 * An earlier draft inferred "it ran out" from `observed > start`. Frank's round
 * 2 P2 killed it with a range shorter than one frame: a 200-sample remainder
 * ends before any rAF sees a handle, so `observed === start` and the line
 * parked at the START of a range that had played in full — the
 * append-becomes-an-insert defect, in the one case the heuristic could not see.
 */
describe("frozenPan", () => {
  const END = 9000;
  const LEN = 10_000;

  it("freezes an explicit stop at the position it sampled", () => {
    // Pause, a finger landing on the waveform (#317), the menu, Back: each
    // reads the sounding position in its own handler, so `observed` is the
    // true one and nothing is a frame behind.
    expect(
      frozenPan({
        observed: 4321,
        end: END,
        stopRequested: true,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: 4321 });
  });

  it("freezes a clip that ran out at the END of the range, exactly", () => {
    // The rAF's last reading is up to a frame short of the end and the handle
    // is already gone, but no sampling is needed. Mutation: use `observed` here
    // and the line parks short of the end, where Record inserts rather than
    // appends.
    expect(
      frozenPan({
        observed: 8992,
        end: END,
        stopRequested: false,
        ranOut: true,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: END });
  });

  it("freezes at the end even when no frame ever saw the clip move", () => {
    // Frank R2 P2: a range shorter than one frame (a 200-sample remainder) can
    // end before the loop reads a handle, so `observed` is still the range's
    // start. The boundary said it ran out; that is what decides.
    expect(
      frozenPan({
        observed: 8800,
        end: END,
        stopRequested: false,
        ranOut: true,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: END });
  });

  it("writes NOTHING when neither ending happened", () => {
    // George R2 P2 #3. `playBuffer` flips `playingBuffer` true optimistically,
    // BEFORE `playSamples`; if that throws (OOM in `toAudioBuffer`, a resume
    // failure) the flag goes false again with no `onEnded` — and the only
    // position the frame loop ever read was the optimistic one, the range's
    // START. Writing that is how the default Play from the F7 rest turned into
    // a punch-in at sample 0.
    //
    // An ending that is neither asked-for nor run-out is not an ending this can
    // place, so it places nothing and the pan keeps whatever the translator
    // last set — which is the pre-play value, because a play does not write it.
    // Same answer for a claim superseded by another sound.
    expect(
      frozenPan({
        observed: 0,
        end: LEN,
        stopRequested: false,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "keep" });
    expect(
      frozenPan({
        observed: 1000,
        end: END,
        stopRequested: false,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "keep" });
  });

  it("clamps to the clip, above and below", () => {
    // The frozen pan is also the record insertion offset, so it gets
    // `viewportWindow`'s clamp for `viewportWindow`'s reason. At the end the
    // clamp lands on the REST (see the next case), so these two use a stop
    // inside the clip and the bottom of the range.
    expect(
      frozenPan({
        observed: -50,
        end: LEN,
        stopRequested: true,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: 0 });
    expect(
      frozenPan({
        observed: 500,
        end: 500,
        stopRequested: false,
        ranOut: true,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: 500 });
  });

  it("answers the REST (null) when the freeze lands on the end", () => {
    // George R1 P1. `null` is not "no pan" — it is F7's append rest, "the end,
    // whatever the end turns out to be" (`effectivePan`). Freezing the NUMBER
    // `length` there turns that into a stale absolute index, which is the
    // insertion-offset class `onCut`'s `p === null ? null : …` exists to avoid.
    // A clip that runs out is the DEFAULT Play from the rest, so this is the
    // common path, not an edge.
    expect(
      frozenPan({
        observed: LEN,
        end: LEN,
        stopRequested: false,
        ranOut: true,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: null });
    // Paused exactly at the end, and a position clamped down from past it: the
    // line is at the end either way, so both are the rest.
    expect(
      frozenPan({
        observed: LEN,
        end: LEN,
        stopRequested: true,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: null });
    expect(
      frozenPan({
        observed: LEN * 3,
        end: LEN * 3,
        stopRequested: true,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: null });
    // An empty segment has nothing but its rest.
    expect(
      frozenPan({
        observed: 0,
        end: 0,
        stopRequested: true,
        ranOut: false,
        measured: true,
        length: 0,
      })
    ).toEqual({ kind: "pan", pan: null });
    // ...and a stop one sample inside is still an absolute position.
    expect(
      frozenPan({
        observed: LEN - 1,
        end: LEN,
        stopRequested: true,
        ranOut: false,
        measured: true,
        length: LEN,
      })
    ).toEqual({ kind: "pan", pan: LEN - 1 });
  });

  it("keeps a run-out at the rest following the end through a later edit", () => {
    // The scenario George wrote out, as a composition with the contract that
    // actually consumes this value. Play from the rest, let it run out, then
    // paste (or undo a cut): the buffer is longer, and the line must still be
    // at the END so Record APPENDS rather than punching into the new audio.
    const frozen = frozenPan({
      observed: 10_000,
      end: 10_000,
      stopRequested: false,
      ranOut: true,
      measured: true,
      length: 10_000,
    });
    const pan = effectivePan({
      mode: "record",
      selectionActive: false,
      zoomPan: null,
      panState: frozen.kind === "pan" ? frozen.pan : 10_000,
      length: 12_000,
    });
    expect(pan).toBe(12_000);
  });

  it("lets the boundary outrank a stop that lands in the same turn", () => {
    // George R3's adjacent risk, settled rather than left unpinned. `onEnded`
    // fires from the audio boundary and sets `ranOut`; if a handler stops in
    // the same turn — a Pause tapped as the last syllable finishes, or a close
    // — `stopRequested` is true as well, and the earlier branch order took the
    // rAF's `observed`. That parks a clip which actually FINISHED one frame
    // short of the end, where the next Record punches in instead of appending:
    // exactly the #416 defect this function exists to prevent, by a race
    // rather than by a stale ref. Running out is a fact about the audio; a
    // stop after it is a no-op on a clip that is already over.
    expect(
      frozenPan({
        observed: 9992,
        end: 10_000,
        stopRequested: true,
        ranOut: true,
        length: 10_000,
        measured: true,
      })
    ).toEqual({ kind: "pan", pan: null });
  });

  it("writes NOTHING for a stop before any real position existed", () => {
    // George R4 P1, and the class-level half of this round's fix. `playBuffer`
    // flips `playingBuffer` true optimistically and the handle only settles
    // after an `await`, a whole-clip AudioBuffer fill and a yielded task — a
    // window that scales with the clip and that `audio-io.ts` deliberately
    // makes tap-reachable. A Pause or a #317 finger landing in it asks for a
    // stop, so `stopRequested` is true and the round-2 `"keep"` arm does not
    // apply, but the only position anything ever saw was the optimistic one:
    // the range's START. Freezing it turns the default Play from the F7 rest
    // into `panState = 0`, and the next Record punches into the first sample
    // instead of appending.
    //
    // `measured` is the honest answer from the audio boundary — "a real handle
    // produced this position" — and without it there is nothing to freeze.
    expect(
      frozenPan({
        observed: 0,
        end: 10_000,
        stopRequested: true,
        ranOut: false,
        length: 10_000,
        measured: false,
      })
    ).toEqual({ kind: "keep" });
  });

  it("still freezes a stop that DID have a position, at that position", () => {
    // The other state of the same gate: `measured` must not become a blanket
    // refusal to freeze, or #416's whole promise ("the waveform stays exactly
    // where playback had reached") goes with it.
    expect(
      frozenPan({
        observed: 4321,
        end: 9000,
        stopRequested: true,
        ranOut: false,
        length: 10_000,
        measured: true,
      })
    ).toEqual({ kind: "pan", pan: 4321 });
  });

  it("does not need a measured position for a clip that ran out", () => {
    // A run-out is reported by the boundary, not observed by a frame, and the
    // handle is already gone when the freeze runs — so requiring `measured`
    // here would silently reintroduce the round-2/round-3 defect of parking a
    // finished clip short of its end.
    expect(
      frozenPan({
        observed: 8800,
        end: 9000,
        stopRequested: false,
        ranOut: true,
        length: 10_000,
        measured: false,
      })
    ).toEqual({ kind: "pan", pan: 9000 });
  });
});

/**
 * Where the line goes when the edit log REPLACES the working buffer.
 *
 * George R3 P1-1. Round 2 dropped the pan of an in-flight play before Undo
 * rematerialised the buffer (`stopPlaybackDroppingPan`), but a freeze that had
 * already COMMITTED survived: scroll-play, pause at sample 4 000 — `panState`
 * is 4 000 — then tap Undo, where nothing is sounding so the dropping stop is
 * a no-op and 4 000 is left naming different speech in the restored buffer.
 * The next Record locks `insertionOffset` there and punches into the middle of
 * a word. It is the same "index in the wrong buffer" defect one tap later.
 */
/**
 * Where a #317 drag starts when the touch interrupted playback (George R5 P1).
 *
 * The round-5 fix taught the FREEZE not to trust `playBuffer`'s optimistic
 * pre-handle position, and stopped there. The drag origin is a second
 * rememberer of the same number: `onPointerDown` seeded `panAtDragStart` and
 * `draggedPanRef` from whatever the stop sampled, and the first `pointermove`
 * writes that straight into `panState` — which is the record insertion offset.
 * The move handler has no movement threshold at all, so a finger's jitter is
 * enough; that was harmless only while the origin was the pan itself, where the
 * write put the same value back.
 *
 * So on the default Play from the F7 rest — `auditionPlan` sounds the whole
 * buffer, the range starts at 0 — a finger landing before the handle settled
 * took the line from the END of the take to sample 0, and the next Record
 * punched into the first syllable instead of appending.
 */
describe("dragOriginAfterInterrupt", () => {
  const LEN = 10_000;

  it("starts from the existing pan when the position was never measured", () => {
    // The George R5 case, exactly: the stop sampled the range start (0) in the
    // optimistic window, and the line is at the rest, so `pan` is the end. The
    // drag must begin where the insertion offset actually is.
    expect(
      dragOriginAfterInterrupt({
        measured: false,
        reached: 0,
        pan: LEN,
        length: LEN,
      })
    ).toBe(LEN);
  });

  it("starts from where playback had REACHED when that was real", () => {
    // Both states of the gate. #416's promise is that a pause leaves the view
    // exactly where the audio got to, and the drag continues from there — so
    // `measured` must not become a blanket refusal to use the position.
    expect(
      dragOriginAfterInterrupt({
        measured: true,
        reached: 4321,
        pan: LEN,
        length: LEN,
      })
    ).toBe(4321);
  });

  it("clamps a measured position to the clip", () => {
    expect(
      dragOriginAfterInterrupt({
        measured: true,
        reached: -50,
        pan: 10,
        length: LEN,
      })
    ).toBe(0);
    expect(
      dragOriginAfterInterrupt({
        measured: true,
        reached: LEN + 500,
        pan: 10,
        length: LEN,
      })
    ).toBe(LEN);
  });
});

/**
 * The one rule for "is this sample an absolute position, or the F7 rest?".
 *
 * `frozenPan` has always answered it for a freeze — an absolute sample is kept
 * only when it is strictly INSIDE the clip, because the end means "append,
 * whatever the end becomes" and freezing the number `length` there turns that
 * promise into a stale index. The pan a DRAG writes is the same kind of value
 * and needs the same answer, which is what keeps the rest a rest through the
 * accidental touch George R5 describes.
 */
describe("panOrRest", () => {
  it("answers the REST at the end, and past it", () => {
    expect(panOrRest(1000, 1000)).toBeNull();
    expect(panOrRest(1500, 1000)).toBeNull();
  });

  it("keeps an absolute sample strictly inside the clip", () => {
    expect(panOrRest(999, 1000)).toBe(999);
    expect(panOrRest(0, 1000)).toBe(0);
  });

  it("clamps below zero", () => {
    expect(panOrRest(-20, 1000)).toBe(0);
  });

  it("keeps the rest a rest through an unmeasured interrupt and a jitter move", () => {
    // The composition that matters for #317 + F7, and the reason both halves of
    // this round are one fix. Line at the rest, default Play, a finger lands
    // before the handle settles, and the move handler fires with no real
    // movement: the origin is the end (not 0), the move writes the end, and
    // `panOrRest` turns that back into the rest — so a later paste or a longer
    // take still finds the line at the END and Record APPENDS.
    const origin = dragOriginAfterInterrupt({
      measured: false,
      reached: 0,
      pan: 10_000,
      length: 10_000,
    });
    // Through `panAfterDragMove` (George round-2 P3-1) — the one function
    // `onPointerMove` actually calls — rather than re-deriving its clamp
    // inline. A zero-delta move is the jitter this case is about.
    const { pan: written } = panAfterDragMove({
      origin,
      delta: 0,
      length: 10_000,
    });
    expect(written).toBeNull();
    expect(
      effectivePan({
        mode: "record",
        selectionActive: false,
        zoomPan: null,
        panState: written,
        length: 12_000,
      })
    ).toBe(12_000);
  });
});

/**
 * `onPointerMove`'s one write, both halves (#442 round 2).
 *
 * This is the same function `recorder.tsx:1122` calls — the test and the
 * handler now share one implementation instead of the test re-deriving the
 * handler's clamp. `raw` and `pan` are asserted separately because they feed
 * two different consumers with two different rules: `draggedPanRef` (the
 * #317 lift decision) needs the raw numeric sample even at the end, and
 * `panState` needs the F7 rest instead of a stale absolute index.
 */
/**
 * Where the line lands once a take commits in place (#614).
 *
 * The requirements owner said yes to Option A on one condition: "append by
 * moving the playhead to the end and hitting Record again" must still work. The
 * sheet no longer closes between takes, so SOMETHING has to place the line, and
 * this is it — the end of what was just recorded, which is the end of the clip
 * for the ordinary append and the far edge of the insert otherwise.
 *
 * Both wrong answers are pinned below, because both look right from one case:
 * "leave the pan alone" is right for an append (the rest already follows the
 * end) and reverses two consecutive mid-clip takes; "go to the end of the clip"
 * is right for an append and throws away the insert position entirely.
 */
describe("panAfterCommit", () => {
  it("rests at the end for an append — the F7 rest, not the number", () => {
    // 1000 samples of clip, a 500-sample take appended at the end. The line
    // must come back as `null`: the REST, which follows the end through a later
    // Paste or Undo. Returning 1500 would be a stale absolute index the moment
    // anything changes the buffer — the #442 class, and the reason `panOrRest`
    // exists at all. Mutation: return the bare clamped sample and this dies
    // while the insert case below stays green.
    expect(panAfterCommit(1_000, 500, 1_500)).toBeNull();
  });

  it("lands past a mid-clip insert, so the next take continues it", () => {
    // A take spliced at 400 into a 1000-sample clip, 500 samples long: the clip
    // is now 1500 and the new audio occupies [400, 900). The line goes to 900.
    // Mutation: return the offset instead of offset+takeLength and this dies —
    // that is the "record twice in the middle and get them in reverse order"
    // defect, which the append case cannot see.
    expect(panAfterCommit(400, 500, 1_500)).toBe(900);
  });

  it("rests for a first take into an empty segment", () => {
    // Offset 0, nothing behind it: the take IS the clip, so the line rests at
    // its end and a second Record appends.
    expect(panAfterCommit(0, 800, 800)).toBeNull();
  });

  it("clamps rather than trusting the arithmetic", () => {
    // Defence, not a reachable case: a take reported longer than the committed
    // buffer would otherwise write a pan past the end, which `effectivePan`
    // would then clamp silently every render instead of once, here.
    expect(panAfterCommit(1_000, 9_999, 1_500)).toBeNull();
    expect(panAfterCommit(-50, 100, 1_000)).toBe(50);
  });
});

describe("panAfterDragMove", () => {
  it("keeps an absolute sample when the drag stops short of the end", () => {
    const { raw, pan } = panAfterDragMove({
      origin: 4_000,
      delta: 1_000,
      length: 10_000,
    });
    expect(raw).toBe(5_000);
    expect(pan).toBe(5_000);
  });

  it("rests when the drag overshoots the end", () => {
    // The #442 case: a delta far larger than what is left to the end.
    const { raw, pan } = panAfterDragMove({
      origin: 8_000,
      delta: 5_000,
      length: 10_000,
    });
    expect(raw).toBe(10_000); // clamped — `draggedPanRef` needs this, not null
    expect(pan).toBeNull(); // panState needs the rest, not the number 10 000
  });

  it("un-rests when a later move pulls back from the end", () => {
    // `draggedPanRef` holds the raw sample even while resting (this
    // function's own docblock explains why), so a drag already parked at the
    // end resumes its next move from a NUMBER, not from `null`. A leftward
    // move (positive delta pulls the pan down) brings it back inside.
    const { raw, pan } = panAfterDragMove({
      origin: 10_000,
      delta: -3_000,
      length: 10_000,
    });
    expect(raw).toBe(7_000);
    expect(pan).toBe(7_000);
  });
});

/**
 * #442, literally: an ORDINARY idle drag (no playback, no interrupt) that
 * parks the line at the very end, followed by a Paste that grows the buffer.
 *
 * This is the plain-drag sibling of the "unmeasured interrupt" composition
 * above — same `panOrRest` rule, reached through `panAfterDragMove`, the
 * function `onPointerMove`'s everyday clamp now calls, rather than through
 * `dragOriginAfterInterrupt`. The issue described `onPointerMove` as writing
 * the absolute sample `length` instead of the `null` rest; round 5 of #432
 * (`33aee7a`) fixed that inline, and round 2 of this PR lifted the whole
 * clamp-and-rest computation into `panAfterDragMove` so the handler has
 * nowhere left to re-derive it by hand. This test pins the composition at
 * the `viewportWindow` layer too, since that is what `recorder.tsx` actually
 * reads at the Record tap (`insertionOffset.current = win.centerlineSample`).
 */
describe("#442 — drag to the end, then Paste grows the buffer", () => {
  it("keeps Record appending after a paste, once the drag write goes through panAfterDragMove", () => {
    // The everyday onPointerMove clamp, with a delta large enough to run the
    // finger well past the end.
    const { raw, pan: written } = panAfterDragMove({
      origin: 0,
      delta: 50_000,
      length: 10_000,
    });
    expect(raw).toBe(10_000); // the finger parked exactly on the last sample
    expect(written).toBeNull();

    // Paste grows the working buffer; panState is untouched by onPaste
    // (recorder.tsx:1802-1805) — only `effectivePan`/`viewportWindow`, read
    // fresh next render, can still find the true end.
    const grownLength = 16_000;
    const pan = effectivePan({
      mode: "record",
      selectionActive: false,
      zoomPan: null,
      panState: written,
      length: grownLength,
    });
    expect(pan).toBe(grownLength);

    // What `onRecordButton` actually locks into `insertionOffset.current`.
    const win = viewportWindow(grownLength, pan, 1, 0.5);
    expect(win.centerlineSample).toBe(grownLength);
  });
});

/**
 * #473 + #613: `onCut`'s writer — the cut point, run through the rest rule.
 *
 * The rest rule is #473's, unchanged and still the reason this is not a bare
 * `range.start`. What #613 changed is WHICH position goes through it: the old
 * `panAfterCutRest(pan, …)` kept the centerline on the same audio, and the
 * line after a cut is now the paste target instead, so the pan the caller had
 * is no longer an input at all. Every #473 case below is kept and re-asked of
 * the new rule; the one that changes answer is called out where it does.
 */
describe("panAfterCutCollapse", () => {
  it("rests, not the number newLength, when the cut ran to the end", () => {
    // #473's own repro: drag the line into the tail, select from there to the
    // end, Cut. The cut point IS the new length exactly, which is the case
    // the rest rule exists for — under either rule.
    const preCutLength = 10_000;
    const removed = { start: 8_000, end: 10_000 };
    expect(panAfterCutCollapse(removed, preCutLength)).toBeNull();
  });

  it("composes with a later Paste the way #442's drag fix does", () => {
    // Same shape as the `panAfterDragMove` "keeps Record appending after a
    // paste" case above: a rested pan must still track a GROWN buffer's new
    // end, not the length as it stood mid-cut.
    const preCutLength = 10_000;
    const removed = { start: 8_000, end: 10_000 };
    const rested = panAfterCutCollapse(removed, preCutLength);
    const grownLength = 14_000; // a Paste after the cut
    const pan = effectivePan({
      mode: "record",
      selectionActive: false,
      zoomPan: null,
      panState: rested,
      length: grownLength,
    });
    expect(pan).toBe(grownLength);
  });

  it("MOVES a line that was entirely before the removed span — the #613 rule change", () => {
    // The one #473 case whose answer changes: `panAfterCutRest(2_000, …)`
    // left the line at 2_000, on the audio it had been on. The paste target
    // is the cut, so the line goes to 8_000 — and 8_000 is the post-cut end
    // here, so the rest rule answers with the rest.
    expect(
      panAfterCutCollapse({ start: 8_000, end: 10_000 }, 10_000)
    ).toBeNull();
    // The same shape with a cut that does NOT reach the end: a real interior
    // cut point, kept as an absolute sample.
    expect(panAfterCutCollapse({ start: 5_000, end: 6_000 }, 10_000)).toBe(
      5_000
    );
  });

  it("rests at a fractional-boundary cut's TRUNCATED end, not a few tenths short of it (#473 round-2 Frank P2)", () => {
    // Selection edges are floats. The buffer edit (`cut`/`sliceRange` in
    // `lib/audio/edit.ts`) truncates `8_000.4` to `8_000` via
    // `Int16Array.slice`, removing exactly 2_000 samples and landing the
    // real post-cut length on `8_000` — so the cut point must rest, not come
    // back as the live number `8_000` that a raw float removed-length of
    // `1_999.6` (`10_000 - 8_000.4`) would leave behind.
    const preCutLength = 10_000;
    const removed = { start: 8_000.4, end: 10_000 };
    expect(panAfterCutCollapse(removed, preCutLength)).toBeNull();
  });
});

/**
 * #449: `panAfterInsert`, `panAfterCut`'s structural inverse — what a paste
 * (live, or an undone cut re-inserting what it removed) does to a position.
 */
describe("panAfterInsert", () => {
  it("leaves a pan strictly before the insertion point untouched", () => {
    expect(panAfterInsert(1_000, 5_000, 3_000)).toBe(1_000);
  });

  it("leaves a pan EXACTLY at the insertion point untouched — onPaste's own case", () => {
    // `recorder.tsx`'s `onPaste`: "nothing to the line's left moves". The
    // pan is a boundary, not audio; it keeps pointing at the start of what
    // was just inserted rather than being pushed past it.
    expect(panAfterInsert(5_000, 5_000, 3_000)).toBe(5_000);
  });

  it("shifts a pan after the insertion point by the inserted length", () => {
    expect(panAfterInsert(6_000, 5_000, 3_000)).toBe(9_000);
  });
});

/**
 * #449: Undo/Redo map the centerline through the inverse/forward effect of
 * the op they step over, instead of unconditionally dropping it to the F7
 * rest (the round-3 P1 fix this replaces).
 */
describe("panAfterUndo / panAfterRedo", () => {
  const cutAtEnd: EditOp = {
    kind: "cut",
    range: { start: 9_000, end: 10_000 },
  };

  it("#449's own scenario: a hand-set pan survives undoing a cut that never touched it", () => {
    // 10s buffer, pan dragged to 3s, a mistake cut from 9s to the end. The
    // cut removes nothing before the pan (`removedBeforePan === 0`), so the
    // pan is unaffected by the cut in either direction — Undo must leave it
    // at 3 000, not reset it to the append rest.
    const preUndoLength = 9_000; // post-cut length
    expect(panAfterUndo(3_000, cutAtEnd, preUndoLength)).toBe(3_000);
  });

  it("subsumes the round-3 P1: a frozen index past the undone span is repaired, not dropped", () => {
    // The buffer was 12 000 samples; the last op cut [4 000, 8 000), leaving
    // 8 000. Playback froze the pan at 6 000 in the POST-cut buffer — audio
    // that was originally at 10 000 pre-cut (everything from the old 8 000
    // on shifted down by the removed 4 000). Undoing the cut must restore
    // that mapping — 10 000, not the audio at the OLD 6 000 (a different
    // word, still inside the surviving head) and not the F7 rest (12 000)
    // the old blanket-drop fix used to answer with regardless.
    const cutMiddle: EditOp = {
      kind: "cut",
      range: { start: 4_000, end: 8_000 },
    };
    expect(panAfterUndo(6_000, cutMiddle, 8_000)).toBe(10_000);
  });

  it("a pan exactly at a cut's START boundary is the one case panAfterInsert truly inverts (panel P1)", () => {
    // 12 000-sample buffer, cut removes [4 000, 8 000). A pan sitting
    // exactly at the cut's start survives the cut untouched
    // (`removedBeforePan === 0`), and panAfterInsert's `pan <= at` hands it
    // straight back on undo — the one boundary where the "inverse" claim in
    // panAfterInsert's docblock actually holds.
    const cutFromFour: EditOp = {
      kind: "cut",
      range: { start: 4_000, end: 8_000 },
    };
    const postCutPan = panAfterCut(4_000, cutFromFour.range);
    expect(postCutPan).toBe(4_000);
    expect(panAfterUndo(postCutPan, cutFromFour, 8_000)).toBe(4_000);
  });

  it("a pan exactly at a cut's END boundary does NOT round-trip — it restores to the cut's START (panel P1)", () => {
    // Same cut, [4 000, 8 000) out of a 12 000-sample buffer, but the pan
    // sat at the cut's END instead of its start. panAfterCut collapses
    // both boundaries to the same post-cut value — `panAfterCut(8_000, ...)`
    // and `panAfterCut(4_000, ...)` both return 4_000 — so the information
    // that this pan started at 8 000 is already gone before undo ever runs.
    // panAfterUndo can only hand back 4 000, never the original 8 000. This
    // pins the honest, deliberate convention panAfterInsert's docblock now
    // names, rather than the "inverts at the boundary" claim a panel review
    // found false here.
    const cutFromFour: EditOp = {
      kind: "cut",
      range: { start: 4_000, end: 8_000 },
    };
    const postCutPan = panAfterCut(8_000, cutFromFour.range);
    expect(postCutPan).toBe(4_000); // already collapsed to the cut's start
    expect(panAfterUndo(postCutPan, cutFromFour, 8_000)).toBe(4_000); // not 8_000
  });

  it("undoing a paste removes what it inserted, mapping through panAfterCut", () => {
    // A 6 000-sample buffer had a 3 000-sample clip pasted at 2 000,
    // growing it to 9 000. Playback froze at 7 000 — inside the audio that
    // was pushed right by the paste (originally at 4 000). Undo must land
    // back on 4 000.
    const pasteOp: EditOp = {
      kind: "paste",
      at: 2_000,
      clip: new Int16Array(3_000),
    };
    expect(panAfterUndo(7_000, pasteOp, 9_000)).toBe(4_000);
  });

  it("redoing maps forward the same way the live writers do", () => {
    // Redoing a cut maps a pan forward through `panAfterCut`, the mapping
    // the live writer used before #613 collapsed the line onto the cut point
    // (minus the rest clamp, which `panAfterRedo` also applies).
    const preRedoLength = 10_000; // the buffer as it stands before the redo
    expect(panAfterRedo(2_000, cutAtEnd, preRedoLength)).toBe(2_000); // before the cut
    expect(panAfterRedo(9_500, cutAtEnd, preRedoLength)).toBeNull(); // inside/after -> rests
  });

  it("redoing a paste shifts a pan at or after the insertion point", () => {
    const pasteOp: EditOp = {
      kind: "paste",
      at: 2_000,
      clip: new Int16Array(3_000),
    };
    const preRedoLength = 6_000;
    expect(panAfterRedo(1_000, pasteOp, preRedoLength)).toBe(1_000);
    expect(panAfterRedo(4_000, pasteOp, preRedoLength)).toBe(7_000);
  });

  it("redoing a cut collapses both its START and END boundary pans to the same value (panel P1, forward direction)", () => {
    // The forward direction is `panAfterCut` directly, so this is the same
    // collapse the two undo boundary cases above pin, shown from the other
    // side: a pan at the cut's start and a pan at the cut's end both land
    // on the cut's start once the cut (re-)applies. Nothing about Redo
    // recovers the distinction Undo cannot either.
    const cutFromFour: EditOp = {
      kind: "cut",
      range: { start: 4_000, end: 8_000 },
    };
    const preRedoLength = 12_000;
    expect(panAfterRedo(4_000, cutFromFour, preRedoLength)).toBe(4_000);
    expect(panAfterRedo(8_000, cutFromFour, preRedoLength)).toBe(4_000);
  });

  it("panAfterUndo re-inserts the buffer edit's TRUNCATED removed length, not the raw float one (#473 round-2 Frank P2)", () => {
    // 12_000-sample buffer, cut [4_000.4, 8_000.7). `Int16Array.slice`
    // truncates both edges, so the buffer edit removes exactly 4_000
    // samples (8_000 - 4_000), leaving 8_000 — `preUndoLength` here. A
    // frozen pan at 6_000 sat in the post-cut buffer's surviving tail
    // (past the cut's truncated start), so undoing must re-insert exactly
    // 4_000 samples ahead of it: 10_000, matching what the buffer edit
    // actually restores. The raw float span (`8_000.7 - 4_000.4`, ~4_000.3)
    // instead lands the pan on `10_000.3`.
    const fractionalCut: EditOp = {
      kind: "cut",
      range: { start: 4_000.4, end: 8_000.7 },
    };
    expect(panAfterUndo(6_000, fractionalCut, 8_000)).toBe(10_000);
  });

  it("panAfterRedo rests at the buffer edit's TRUNCATED post-cut length (#473 round-2 Frank P2)", () => {
    // Same shape as panAfterCutCollapse's fractional-boundary case: a cut to
    // the end with a fractional start truncates to removing exactly 2_000
    // samples, so the real post-redo length is 8_000 and a pan AT the
    // cut's truncated start (8_000) must rest — not come back as the live
    // number `8_000` a raw float removed-length of `1_999.6` would leave.
    const fractionalCutToEnd: EditOp = {
      kind: "cut",
      range: { start: 8_000.4, end: 10_000 },
    };
    expect(panAfterRedo(8_000, fractionalCutToEnd, 10_000)).toBeNull();
  });

  it("leaves the F7 rest resting through both directions — no op has anything to map it through", () => {
    expect(panAfterUndo(null, cutAtEnd, 9_000)).toBeNull();
    expect(panAfterRedo(null, cutAtEnd, 10_000)).toBeNull();
  });
});

/**
 * #473 round 3 (Frank r3 P2): round 2 fixed the removed LENGTH
 * (`removedSampleCount`, now folded into `wholeSampleRange` in
 * `lib/audio/edit.ts`) but left the POSITION terms reading the raw
 * fractional cut bounds — `panAfterUndo`'s re-insertion point
 * (`panAfterInsert`'s `at`, read from `Math.min(range.start, range.end)`) and
 * `panAfterRedo`'s `panAfterCut(pan, redoneOp.range)` call. The live cut writer
 * (`panAfterCutRest` then, {@link panAfterCutCollapse} since #613) shares the
 * same raw-range exposure,
 * though Frank r3 named only the undo/redo call sites — the class-level fix
 * routes every cut-range read in this file through `wholeSampleRange` at
 * entry, so a fractional cut's effect on the pan matches a cut of its
 * already-truncated bounds exactly, not just in how much it shortens the
 * buffer.
 */
describe("#473 round 3 — a fractional cut's POSITION terms match its truncated bounds, not just its length (Frank r3 P2)", () => {
  // Int16Array.slice truncates [4_000.4, 8_000.7) to [4_000, 8_000) — exactly
  // 4_000 samples removed, not the raw float span (~4_000.3).
  const fractionalRange = { start: 4_000.4, end: 8_000.7 };
  const truncatedRange = { start: 4_000, end: 8_000 };
  const preLength = 12_000; // the buffer's length before the cut/redo
  const postCutLength = 8_000; // 12_000, minus the truncated 4_000 removed
  const fractionalOp: EditOp = { kind: "cut", range: fractionalRange };
  const truncatedOp: EditOp = { kind: "cut", range: truncatedRange };

  const positions: ReadonlyArray<readonly [string, number]> = [
    ["before the cut", 2_000],
    ["in the truncation gap at the cut's start", 4_000.2],
    ["inside the cut", 6_000],
    ["at the cut's truncated end", 8_000],
    ["after the cut", 9_000.6],
  ];

  it("panAfterCutCollapse: a fractional cut lands on the same point as a cut of the truncated bounds", () => {
    // No longer parameterised by the pan — #613 dropped that input (the line
    // goes to the cut point, wherever it was) — but the truncation property
    // it was written for is the same one, and it is still the class-level
    // fix rather than Frank r3's two named call sites.
    expect(panAfterCutCollapse(fractionalRange, preLength)).toBe(
      panAfterCutCollapse(truncatedRange, preLength)
    );
  });

  it.each(positions)(
    "panAfterUndo: %s (pan %s) — undoing a fractional cut matches undoing the truncated one",
    (_label, pan) => {
      expect(panAfterUndo(pan, fractionalOp, postCutLength)).toBe(
        panAfterUndo(pan, truncatedOp, postCutLength)
      );
    }
  );

  it.each(positions)(
    "panAfterRedo: %s (pan %s) — redoing a fractional cut matches redoing the truncated one",
    (_label, pan) => {
      expect(panAfterRedo(pan, fractionalOp, preLength)).toBe(
        panAfterRedo(pan, truncatedOp, preLength)
      );
    }
  );

  it("panAfterRedo: Frank r3's own example — 9_000.6 redoes to 5_000.6, not the raw-span 5_000.3", () => {
    expect(panAfterRedo(9_000.6, fractionalOp, preLength)).toBe(5_000.6);
  });

  it("panAfterCutCollapse: the live cut lands on the truncated start, 4_000 — the sibling the class-level fix covers beyond Frank r3's named lines", () => {
    // The raw fractional start (4_000.4) would put the record/paste offset a
    // fraction of a sample off the buffer the cut actually produced.
    expect(panAfterCutCollapse(fractionalRange, preLength)).toBe(4_000);
  });

  it("panAfterUndo: a pan in the truncation gap crosses the reinsertion boundary the raw `lo` comparison put it on the wrong side of", () => {
    // 4_000.2 sits AFTER the truncated start (4_000, what the buffer edit
    // used) but BEFORE the raw fractional start (4_000.4, what the pre-fix
    // code compared against) — so the pre-fix `pan <= lo` branch kept it
    // unchanged at 4_000.2 instead of shifting it past the re-inserted range
    // to 8_000.2.
    expect(panAfterUndo(4_000.2, fractionalOp, postCutLength)).toBe(8_000.2);
  });
});

/**
 * #512 George R1 P2-2: the full seam, end to end — `useSegmentEditor.undo`/
 * `.redo` return `EditLog`'s `opUndone`/`opRedone` (this is now the hook's
 * whole implementation, so exercising the pure pair through `edit-log.ts`
 * pins the same contract), and the op that comes back is what
 * `panAfterUndo`/`panAfterRedo` are handed. This closes the loop George's
 * finding named as untested: cut → undo → the returned op maps pan through
 * exactly the length `materialize` actually restores, not a hand-picked
 * number that happens to agree today.
 */
describe("opUndone/opRedone feed panAfterUndo/panAfterRedo with an op that agrees with materialize (#512 George R1 P2-2)", () => {
  const original = new Int16Array(10_000); // 10_000-sample take

  it("cut [2,5) then undo: opUndone's op maps pan through the length materialize actually restores", () => {
    const cutLog = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 2, end: 5 },
    });
    // 9_997 samples survive the 3-sample cut.
    const postCutLength = materialize(original, cutLog).length;
    expect(postCutLength).toBe(9_997);

    const undoneOp = opUndone(cutLog);
    expect(undoneOp).toEqual({ kind: "cut", range: { start: 2, end: 5 } });

    const restored = materialize(original, logUndo(cutLog));
    expect(restored.length).toBe(original.length);

    // A pan well inside the surviving tail (past the cut's truncated start,
    // short of the end) must shift right by exactly the 3 samples
    // `materialize` just proved the undo re-inserts — landing inside the
    // restored 10_000-length buffer, not at its rest boundary.
    expect(panAfterUndo(6_000, undoneOp!, postCutLength)).toBe(6_003);
  });

  it("cut [2,5), then paste, then undo the paste: opUndone names the paste, and pan maps through ITS inverse, not the cut's", () => {
    const clip = new Int16Array(50);
    const cutLog = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 2, end: 5 },
    });
    const pasteLog = pushOp(cutLog, { kind: "paste", at: 100, clip });
    const preUndoLength = materialize(original, pasteLog).length; // 9_997 + 50

    const undoneOp = opUndone(pasteLog);
    expect(undoneOp).toEqual({ kind: "paste", at: 100, clip });

    const restored = materialize(original, logUndo(pasteLog));
    // Undoing the paste alone restores the post-cut (not the original)
    // length — the cut is still applied.
    expect(restored.length).toBe(preUndoLength - clip.length);

    // A pan sitting past the pasted clip must shift back by exactly what the
    // paste inserted.
    const pan = 200;
    expect(panAfterUndo(pan, undoneOp!, preUndoLength)).toBe(pan - clip.length);
  });

  it("redo after that undo: opRedone names the SAME paste, and pan maps forward through it", () => {
    const clip = new Int16Array(50);
    const cutLog = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 2, end: 5 },
    });
    const pasteLog = pushOp(cutLog, { kind: "paste", at: 100, clip });
    const undone = logUndo(pasteLog);
    const preRedoLength = materialize(original, undone).length;

    const redoneOp = opRedone(undone);
    expect(redoneOp).toEqual({ kind: "paste", at: 100, clip });

    const reapplied = materialize(original, pasteLog);
    expect(reapplied.length).toBe(preRedoLength + clip.length);

    const pan = 150;
    expect(panAfterRedo(pan, redoneOp!, preRedoLength)).toBe(pan + clip.length);
  });

  it("opUndone at the start of history is null and pan is never mapped", () => {
    expect(opUndone(emptyLog())).toBeNull();
  });
});

/**
 * Whether the Record control is dead (George R1 P2 #3).
 *
 * Record is the control that LOCKS the insertion offset (#61, F9:
 * `insertionOffset` is captured at the tap and the take splices there whatever
 * the view does afterwards), so every state where the drawn line and that
 * offset could disagree has to be a state where Record cannot be tapped. This
 * PR added one: #317 made "a finger on the waveform" the way to pause, and the
 * pause lifts the `playingBuffer` gate while the finger is still down — so a
 * second finger could tap Record mid-drag and lock the offset to a pan that
 * then keeps moving under it.
 *
 * Enumerated here rather than inline in the JSX because a gate is a claim in
 * two directions: it must go dead on every state it exists to catch, and stay
 * LIVE on every state the sheet calls legitimate — including Resume, which is
 * this same button while a take is paused and a preview may be sounding.
 */
describe("recordDisabled", () => {
  const live = {
    busy: false,
    isClosing: false,
    hasView: true,
    playingBuffer: false,
    paused: false,
    dragging: false,
  } as const;

  it("is live at idle with a segment loaded", () => {
    expect(recordDisabled(live)).toBe(false);
  });

  it("is dead with no segment, while busy, and through the close window", () => {
    expect(recordDisabled({ ...live, hasView: false })).toBe(true);
    expect(recordDisabled({ ...live, busy: true })).toBe(true);
    expect(recordDisabled({ ...live, isClosing: true })).toBe(true);
  });

  it("is dead while a buffer sounds at idle — the drawn line is not the offset", () => {
    // Under `"scroll"` the line marks the SOUNDING sample while `panState` is
    // still the pre-play value, so a take started here would splice somewhere
    // the translator cannot see.
    //
    // This used to carry ONE exemption: a paused take, where the button was
    // Resume and its offset had been locked at the original Record tap (George
    // R3 #4 on #101). #614 ended the paused take, so a sounding buffer now
    // disables this outright. Mutation: restore any exemption to this term and
    // it dies.
    expect(recordDisabled({ ...live, playingBuffer: true })).toBe(true);
  });

  it("is dead while a finger owns the stage (#317)", () => {
    // The hole this case exists to close: the #317 touch stops playback, which
    // lifts `playingBuffer` while the drag is still in flight. Record must not
    // be tappable by a second finger until the first one lifts, or the offset
    // locks to a pan that is still moving.
    expect(recordDisabled({ ...live, dragging: true })).toBe(true);
    // And it stands on its own, not riding `playingBuffer`: a drag with nothing
    // sounding still holds the control down.
    expect(
      recordDisabled({ ...live, dragging: true, playingBuffer: false })
    ).toBe(true);
  });
});

describe("heldByDrag", () => {
  it("kills a control that would otherwise be live", () => {
    // The George R2 P1 hole: the #317 touch stops playback BEFORE the drag
    // begins, so every gate written against `playingBuffer` alone reads
    // "nothing is sounding, this control is fine" while the finger is still
    // down and the pan is still moving. Play, Undo and Redo are the three that
    // can start a sound or replace the buffer the lift is going to resume in.
    expect(heldByDrag(true, false)).toBe(true);
  });

  it("answers the control's own gate when no finger is down", () => {
    // Both directions, so a term that always disabled could not pass.
    expect(heldByDrag(false, false)).toBe(false);
    expect(heldByDrag(false, true)).toBe(true);
  });

  it("never re-enables a control its own gate already killed", () => {
    expect(heldByDrag(true, true)).toBe(true);
  });
});

/**
 * #418 / #513 (George round-1 P3, Frank round-2 P2): the COMPLETE
 * centerline-overlay render decision, not just the #418 selection
 * exception. Before this function existed, `recorder.tsx`'s JSX composed
 * `!liveScope && centerlineShown(...)` ad hoc at the call site, and only
 * the `centerlineShown` half was under test — a regression in the
 * `liveScope` term, or in how the two were combined, could not have been
 * caught here. `centerlineOverlayShown` is now the whole gate, so this
 * table exhausts all eight `mode` x `selectionActive` x `liveScope`
 * combinations rather than treating `liveScope` as a separate axis nobody
 * pins.
 */
describe("centerlineOverlayShown", () => {
  it("hides in edit mode with a span loaded", () => {
    expect(
      centerlineOverlayShown({
        mode: "edit",
        selectionActive: true,
        liveScope: false,
      })
    ).toBe(false);
  });

  it("stays visible in edit mode with nothing picked — the audition start point", () => {
    expect(
      centerlineOverlayShown({
        mode: "edit",
        selectionActive: false,
        liveScope: false,
      })
    ).toBe(true);
  });

  it("stays visible in record mode regardless of a stray selectionActive", () => {
    // `selectionActive` is a `SegmentEditor` concept that should not exist in
    // record mode, but the function is total over its inputs rather than
    // trusting the caller never to pass this combination.
    expect(
      centerlineOverlayShown({
        mode: "record",
        selectionActive: true,
        liveScope: false,
      })
    ).toBe(true);
    expect(
      centerlineOverlayShown({
        mode: "record",
        selectionActive: false,
        liveScope: false,
      })
    ).toBe(true);
  });

  it("hides whenever liveScope owns the stage, even in every state the #418 half would otherwise show", () => {
    // The exact regression class #513 Frank R2 P2 named: before this
    // function existed, `!liveScope` was composed with the #418 predicate
    // only at the JSX call site, untested together. Cross every #418-shown
    // state with `liveScope: true` to prove liveScope wins regardless.
    expect(
      centerlineOverlayShown({
        mode: "edit",
        selectionActive: false,
        liveScope: true,
      })
    ).toBe(false);
    expect(
      centerlineOverlayShown({
        mode: "record",
        selectionActive: false,
        liveScope: true,
      })
    ).toBe(false);
    expect(
      centerlineOverlayShown({
        mode: "record",
        selectionActive: true,
        liveScope: true,
      })
    ).toBe(false);
  });

  it("agrees with the #418 half when both reasons to hide are present at once", () => {
    expect(
      centerlineOverlayShown({
        mode: "edit",
        selectionActive: true,
        liveScope: true,
      })
    ).toBe(false);
  });
});
