import { describe, expect, it } from "vitest";

import {
  attemptsCapture,
  planClose,
  type CaptureOutcome,
  type CloseInputs,
} from "@/lib/takes/close-plan";

/**
 * The commit-on-close decision, enumerated.
 *
 * `close()` in `components/recorder.tsx` is the ONLY commit path in the product
 * — there is no Stop control — and it used to hold this whole decision inline.
 * This project has no renderer (`vitest.config.ts` sets `environment: "node"`,
 * and there is no jsdom or testing-library in `package.json`), so nothing could
 * drive it: a wrong branch there does not produce a wrong pixel, it drops a
 * take, and it shipped with `npm run verify` green (#180).
 *
 * So the decision was lifted out unchanged, by the same move that produced
 * `lib/takes/pending-take.ts` and `lib/audio/session.ts`: pure, DOM-free,
 * React-free, and enumerated here. The component keeps only the effects — the
 * `stopRecording` call, the saves, the store write, the stay-open reset.
 *
 * The tests below enumerate the inputs rather than sampling them, because the
 * branches interact: whether edits are persisted depends on whether a capture
 * was attempted, and whether the finished mark is written depends on whether
 * anything else committed. Two of those interactions are the whole reason the
 * plan exists (see "a superseded capture" below).
 *
 * Written against mutations, not by inspection: each guard in `close-plan.ts`
 * was inverted or removed in turn and confirmed to fail at least one test here.
 */

/** A capture that yielded usable audio. */
const captured = (frames = 3): CaptureOutcome => ({
  samples: Int16Array.from({ length: frames }, (_, i) => i + 1),
  error: null,
});

/** A capture that yielded nothing and has something to say. */
const failedCapture = (
  error = "No sound was recorded. Try again."
): CaptureOutcome => ({
  samples: null,
  error,
});

/**
 * A superseded stop: no samples AND no error, because a newer recording (or a
 * `pagehide`) owns the screen. See `StopResult` in `hooks/use-recorder.ts`.
 */
const supersededCapture: CaptureOutcome = { samples: null, error: null };

/** No capture was attempted at all — the recorder was idle when Back was tapped. */
const idle = (over: Partial<CloseInputs> = {}): CloseInputs => ({
  capture: null,
  hasEdits: false,
  workingLength: 0,
  finishedIntent: null,
  storedFinished: false,
  ...over,
});

describe("attemptsCapture", () => {
  // Enumerated over the whole of `RecorderState`. A state added there that is
  // missing from this list fails typecheck at the `attemptsCapture(state)` call
  // in `recorder.tsx`, not silently here.
  it("stops a capture from the three states that can hold one", () => {
    expect(attemptsCapture("recording")).toBe(true);
    expect(attemptsCapture("paused")).toBe(true);
    // A #59 interruption freezes a real take to "processing"; its audio is
    // still owed a stop, and skipping it drops the take.
    expect(attemptsCapture("processing")).toBe(true);
  });

  it("does not stop a capture that never started", () => {
    expect(attemptsCapture("idle")).toBe(false);
    // "requesting" is the permission prompt: there is no MediaRecorder yet, and
    // treating it as a take would swallow an edit-only close behind a stop that
    // returns nothing.
    expect(attemptsCapture("requesting")).toBe(false);
  });
});

describe("planClose — a capture that produced audio", () => {
  it("saves the take, carrying its samples", () => {
    const capture = captured();
    const plan = planClose(idle({ capture }));
    expect(plan).toEqual({
      action: "save-take",
      samples: capture.samples,
      finished: false,
    });
  });

  it("marks the take finished only on an explicit mark this session", () => {
    // A plain re-record the translator did not mark stays a demote-to-draft:
    // `finishedIntent` null means untouched, and false means explicitly cleared.
    for (const finishedIntent of [null, false] as const) {
      const plan = planClose(idle({ capture: captured(), finishedIntent }));
      expect(plan.action).toBe("save-take");
      if (plan.action === "save-take") expect(plan.finished).toBe(false);
    }
    const marked = planClose(
      idle({ capture: captured(), finishedIntent: true })
    );
    expect(marked.action).toBe("save-take");
    if (marked.action === "save-take") expect(marked.finished).toBe(true);
  });

  it("saves the take even when the stop also reported an error", () => {
    // Confirmed samples win: the original `if (samples…) else if (error)` order.
    // Reversing it would surface a notice and drop audio already in hand.
    const capture: CaptureOutcome = {
      samples: captured().samples,
      error: "late",
    };
    expect(planClose(idle({ capture })).action).toBe("save-take");
  });

  it("does not treat a non-null but empty buffer as audio", () => {
    // A successful decode to zero frames is "no sound", not a take: persisting
    // it would fabricate a recorded state that plays silence.
    const capture: CaptureOutcome = {
      samples: new Int16Array(0),
      error: "No sound",
    };
    expect(planClose(idle({ capture }))).toEqual({
      action: "stay",
      error: "No sound",
    });
  });

  it("saves the take ahead of any pending edit, and never both", () => {
    // The recording's splice base IS the edited buffer, so one save covers both
    // (Model A). A second save-edit after it would overwrite the take.
    const plan = planClose(
      idle({ capture: captured(), hasEdits: true, workingLength: 100 })
    );
    expect(plan.action).toBe("save-take");
  });

  it("saves the take ahead of the finished-mark write", () => {
    // The mark rides the take, applied atomically with it. A separate write
    // would be clobbered by the same close's demote-to-draft.
    const plan = planClose(
      idle({ capture: captured(), finishedIntent: true, storedFinished: false })
    );
    expect(plan.action).toBe("save-take");
  });
});

describe("planClose — a capture that produced nothing", () => {
  it("stays open on a stop error, carrying its reason", () => {
    const plan = planClose(
      idle({ capture: failedCapture("Could not decode") })
    );
    expect(plan).toEqual({ action: "stay", error: "Could not decode" });
  });

  it("stays open rather than persisting the edits underneath the failed take", () => {
    // The sheet stays open with the working buffer and its undo log intact.
    const plan = planClose(
      idle({ capture: failedCapture(), hasEdits: true, workingLength: 100 })
    );
    expect(plan.action).toBe("stay");
  });

  it("closes on a superseded capture, abandoning the session", () => {
    // No samples and no error: a leave()/pagehide bumped the generation mid-flush.
    // Nothing to save and nothing to say, so close rather than dead-end the
    // sheet open (#59).
    expect(planClose(idle({ capture: supersededCapture }))).toEqual({
      action: "close",
    });
  });

  it("does NOT persist edits on a superseded capture", () => {
    // The George-R5 loss: a cut-to-empty persisted here would clear the original
    // recording while the replacement never landed and the cut audio lives only
    // in RAM on the clipboard. Unrecoverable field loss.
    expect(
      planClose(
        idle({ capture: supersededCapture, hasEdits: true, workingLength: 0 })
      ).action
    ).toBe("close");
    expect(
      planClose(
        idle({ capture: supersededCapture, hasEdits: true, workingLength: 100 })
      ).action
    ).toBe("close");
  });

  it("still writes a real finished toggle after a superseded capture", () => {
    // Nothing committed, so the toggle has no take to ride on and is written
    // directly — the behaviour as it stands, enumerated so it cannot drift.
    const plan = planClose(
      idle({
        capture: supersededCapture,
        finishedIntent: true,
        storedFinished: false,
      })
    );
    expect(plan).toEqual({ action: "mark", finished: true });
  });
});

describe("planClose — an edit-only close", () => {
  it("saves a non-empty edited buffer", () => {
    const plan = planClose(idle({ hasEdits: true, workingLength: 100 }));
    expect(plan).toEqual({ action: "save-edit", finished: false });
  });

  it("carries an explicit finished mark onto the edit save", () => {
    const plan = planClose(
      idle({ hasEdits: true, workingLength: 100, finishedIntent: true })
    );
    expect(plan).toEqual({ action: "save-edit", finished: true });
  });

  it("clears the take when the edits cut it down to nothing", () => {
    // No 0-frame ghost: a resolved clip that plays silence and can be counted
    // finished. And `clear` carries no finished mark — a cleared segment is
    // never-recorded, so marking it finished is meaningless.
    expect(planClose(idle({ hasEdits: true, workingLength: 0 }))).toEqual({
      action: "clear",
    });
    expect(
      planClose(
        idle({ hasEdits: true, workingLength: 0, finishedIntent: true })
      )
    ).toEqual({ action: "clear" });
  });

  it("does nothing with a zero-length buffer that was never edited", () => {
    // An empty segment opened and closed without touching anything: there is no
    // take to clear, and a clear here would be a write for nothing.
    expect(planClose(idle({ hasEdits: false, workingLength: 0 }))).toEqual({
      action: "close",
    });
  });

  it("prefers the edit save over the finished-mark write", () => {
    // Like a re-record, an edit demotes an approved segment to draft unless
    // re-marked, and the mark rides the write.
    const plan = planClose(
      idle({
        hasEdits: true,
        workingLength: 100,
        finishedIntent: true,
        storedFinished: false,
      })
    );
    expect(plan).toEqual({ action: "save-edit", finished: true });
  });
});

describe("planClose — the finished mark on its own", () => {
  it("writes a toggle that differs from the stored flag", () => {
    expect(
      planClose(idle({ finishedIntent: true, storedFinished: false }))
    ).toEqual({ action: "mark", finished: true });
    expect(
      planClose(idle({ finishedIntent: false, storedFinished: true }))
    ).toEqual({ action: "mark", finished: false });
  });

  it("writes nothing when the translator never touched the checkbox", () => {
    for (const storedFinished of [true, false]) {
      expect(
        planClose(idle({ finishedIntent: null, storedFinished })).action
      ).toBe("close");
    }
  });

  it("writes nothing when the toggle landed back on the stored value", () => {
    // Toggled twice: nothing changed, so there is nothing to write.
    for (const value of [true, false]) {
      expect(
        planClose(idle({ finishedIntent: value, storedFinished: value })).action
      ).toBe("close");
    }
  });

  it("writes nothing when no segment is loaded", () => {
    // `storedFinished` null stands for a null `view`: there is nothing to
    // compare against and no row the store would accept a mark for.
    expect(
      planClose(idle({ finishedIntent: true, storedFinished: null })).action
    ).toBe("close");
  });
});

describe("planClose — a close that changes nothing", () => {
  it("just closes", () => {
    expect(planClose(idle())).toEqual({ action: "close" });
  });
});
