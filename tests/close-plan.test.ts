import { describe, expect, it } from "vitest";

import {
  attemptsCapture,
  classifyCapture,
  planClose,
  planPendingWork,
  type CaptureOutcome,
  type CloseInputs,
  type PendingWork,
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
 * `stopRecording` call, the saves, the store write, the held-take panel, the
 * stay-open reset.
 *
 * The tests below enumerate the inputs rather than sampling them, because the
 * branches interact: whether edits are persisted depends on whether a capture
 * was attempted, and whether the finished mark is written depends on whether
 * anything else committed. Two of those interactions are the whole reason the
 * plan exists (see "a superseded capture" below).
 *
 * NOT covered here, and nothing below should be read as covering it: the
 * component wiring that calls these functions. `recorder.tsx` needs a renderer,
 * which this repo does not have, so which effect each action actually runs is
 * review-only (T2, the #361 known gap) and has not been run on a device.
 */

/** A stop that yielded usable audio. */
const captured = (frames = 3): CaptureOutcome<string> => ({
  samples: Int16Array.from({ length: frames }, (_, i) => i + 1),
  bytes: null,
  error: null,
});

/**
 * A stop whose decode FAILED but whose container bytes survived (#165). The
 * bytes are a `Blob` in the app; a string stands in, because nothing in `lib/`
 * may name a web type and nothing here inspects them.
 */
const undecodable = (
  error: string | null = "Recording could not be decoded on this device."
): CaptureOutcome<string> => ({
  samples: null,
  bytes: "container-bytes",
  error,
});

/** A stop that yielded nothing, kept nothing, and has something to say. */
const failedCapture = (
  error = "No sound was recorded. Try again."
): CaptureOutcome<string> => ({
  samples: null,
  bytes: null,
  error,
});

/**
 * A superseded stop: no samples, no kept bytes AND no error, because a newer
 * recording (or a `pagehide`) owns the screen. See `StopResult` in
 * `hooks/use-recorder.ts`.
 */
const supersededCapture: CaptureOutcome<string> = {
  samples: null,
  bytes: null,
  error: null,
};

/**
 * The other shape that classifies as superseded: a decode that succeeded to
 * ZERO frames and withheld its reason. `stop()` normalises a zero-frame decode
 * to `samples: null` today, so this is a shape the type allows rather than one
 * observed from the hook — it is pinned because the samples guard is a length
 * check, and weakening it to a truthiness test routes this to `save-take`.
 */
const supersededEmptyDecode: CaptureOutcome<string> = {
  samples: new Int16Array(0),
  bytes: null,
  error: null,
};

/**
 * No capture was attempted at all — the recorder was idle when Back was tapped.
 *
 * `hasTake` defaults TRUE: most cases below are about a segment that already
 * has audio, which is the only state a Finished mark can be written on. The
 * never-recorded case is its own describe block, where it is passed explicitly.
 */
const idle = (
  over: Partial<CloseInputs<string>> = {}
): CloseInputs<string> => ({
  capture: null,
  hasEdits: false,
  workingLength: 0,
  finishedIntent: null,
  storedFinished: false,
  hasTake: true,
  ...over,
});

const work = (over: Partial<PendingWork> = {}): PendingWork => ({
  hasEdits: false,
  workingLength: 0,
  finishedIntent: null,
  storedFinished: false,
  hasTake: true,
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

/**
 * The precedence both commit paths share.
 *
 * `close()` and the commit-and-edit path in `onEnterEdit` (#134) read a stop
 * result the same way and then do different things with it. That agreement used
 * to be a comment in `onEnterEdit` ("Mirror close()'s precedence exactly"), and
 * a comment cannot fail. These cases are what fails instead.
 */
describe("classifyCapture", () => {
  it("reads usable audio as a take, carrying the samples", () => {
    const outcome = captured();
    expect(classifyCapture(outcome)).toEqual({
      kind: "take",
      samples: outcome.samples,
    });
  });

  it("prefers audio in hand over an error also reported", () => {
    // Reversing this would surface a notice and drop audio already decoded.
    expect(classifyCapture({ ...captured(), error: "late" }).kind).toBe("take");
  });

  it("prefers audio in hand over kept bytes", () => {
    // Both present is not a case `stop()` produces today (the blob is kept only
    // when the decode FAILED), but if it ever did, the decoded PCM is the take.
    expect(
      classifyCapture({ ...captured(), bytes: "container-bytes" }).kind
    ).toBe("take");
  });

  it("does not read a non-null but empty buffer as audio", () => {
    // A successful decode to zero frames is "no sound", not a take: committing
    // it would fabricate a recorded state that plays silence.
    expect(
      classifyCapture({
        samples: new Int16Array(0),
        bytes: null,
        error: "No sound",
      })
    ).toEqual({ kind: "notice", error: "No sound" });
  });

  it("holds kept bytes ahead of the error", () => {
    expect(classifyCapture(undecodable())).toEqual({
      kind: "hold",
      bytes: "container-bytes",
    });
  });

  it("holds kept bytes even when the stop was superseded and withheld its error", () => {
    // THE case #165 exists for and the one the panel never appeared on: a
    // leave()/pagehide bumping the generation mid-decode is the very #106
    // interruption most likely to fail the decode, so `blob` is kept while
    // `error` is withheld (George R1 G2). Classifying that as "superseded"
    // closes silently on the only copy of the take.
    expect(classifyCapture(undecodable(null))).toEqual({
      kind: "hold",
      bytes: "container-bytes",
    });
  });

  it("reads an empty capture as a notice, carrying its reason", () => {
    expect(classifyCapture(failedCapture("No sound"))).toEqual({
      kind: "notice",
      error: "No sound",
    });
  });

  it("reads nothing at all as superseded", () => {
    expect(classifyCapture(supersededCapture)).toEqual({ kind: "superseded" });
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

describe("planClose — a capture whose decode failed", () => {
  it("holds the bytes rather than exiting", () => {
    expect(planClose(idle({ capture: undecodable() }))).toEqual({
      action: "hold",
      bytes: "container-bytes",
    });
  });

  it("holds the bytes of a superseded stop whose decode failed", () => {
    // Falling through to `close` here loses the take for good (#165/#106).
    expect(planClose(idle({ capture: undecodable(null) })).action).toBe("hold");
  });

  it("holds the bytes ahead of a pending edit or a finished toggle", () => {
    // The sheet does not exit, so nothing else this session owes is settled
    // yet; the recovery panel's own exits run the tail later.
    expect(
      planClose(
        idle({
          capture: undecodable(),
          hasEdits: true,
          workingLength: 0,
          finishedIntent: true,
          storedFinished: false,
        })
      ).action
    ).toBe("hold");
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
    // No samples, no bytes and no error: a leave()/pagehide bumped the
    // generation mid-flush. Nothing to save and nothing to say, so close rather
    // than dead-end the sheet open (#59).
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

  it("writes no finished toggle after a superseded capture", () => {
    // #211, decided by the dev lead 2026-09-19 (option 1): a superseded stop
    // writes NOTHING. It used to fall through to the mark, which was the one
    // write still going through on a close whose sheet is being torn down
    // underneath a newer recording or a backgrounding — and the mark would
    // land on the STORED take, since the take that was in flight never did.
    // Finished is also the trigger for transcode-on-Finished (D3, ADR 0009),
    // so honouring it would start a lossy 64 kbps encode of the one recording
    // that survived, on the strength of an intent the translator expressed
    // about the replacement. Same rule the edits directly above already
    // follow: one interrupted close, no writes.
    const plan = planClose(
      idle({
        capture: supersededCapture,
        finishedIntent: true,
        storedFinished: false,
      })
    );
    expect(plan).toEqual({ action: "close" });
  });

  it("writes no finished toggle after a superseded capture in the un-mark direction either", () => {
    // Both directions, so a guard that only catches the promote-to-finished
    // half fails here. Clearing the mark is a write of the same kind, and it
    // demotes a segment the interrupted session never replaced.
    expect(
      planClose(
        idle({
          capture: supersededCapture,
          finishedIntent: false,
          storedFinished: true,
        })
      )
    ).toEqual({ action: "close" });
  });

  it("writes nothing on an empty decode with no error, which is superseded too", () => {
    // The `samples: new Int16Array(0), error: null` half of the branch — a
    // shape the type allows rather than one observed from the hook, since
    // `stop()` normalises a zero-frame decode to `samples: null` today. It
    // must land exactly where `samples: null` lands: not on `stay` (that is
    // the real empty capture, which HAS a reason, pinned above) and not on
    // `mark`. Asserted plain and with a finished toggle in play, so a guard
    // that stops covering this shape dies here.
    expect(planClose(idle({ capture: supersededEmptyDecode }))).toEqual({
      action: "close",
    });
    expect(
      planClose(
        idle({
          capture: supersededEmptyDecode,
          finishedIntent: true,
          storedFinished: false,
        })
      )
    ).toEqual({ action: "close" });
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

/**
 * The mark the store would throw on.
 *
 * `setSegmentFinished` (`lib/storage/books.ts`) rejects `finished === true`
 * when `activeTakeId === null`, and the recorder's only answer to a failed flag
 * write is to stay open — on a sheet where the Finished box has gone disabled
 * with the take, so the intent that caused the throw cannot be cleared. Every
 * later Back re-plans the same rejected write and the sheet will not dismiss.
 *
 * `storedFinished` cannot tell this case apart on its own: a never-recorded
 * segment and a recorded draft both load as `false`. That is why `hasTake` is a
 * separate input. Found by the deep-tree reviewer on #180; the behaviour is
 * older than this PR (the pre-extraction tail wrote the same `setFinished`),
 * so the fix ships as its own commit.
 */
describe("planFinishedWrite — a segment with no take to mark", () => {
  it("does not plan a mark the store will reject", () => {
    // Tick Finished while recording a FIRST take, then lose the capture.
    expect(
      planPendingWork(
        work({ finishedIntent: true, storedFinished: false, hasTake: false })
      )
    ).toEqual({ action: "close" });
  });

  it("plans the mark once the segment actually has audio", () => {
    // The same inputs with a take present: a recorded draft being approved.
    expect(
      planPendingWork(
        work({ finishedIntent: true, storedFinished: false, hasTake: true })
      )
    ).toEqual({ action: "mark", finished: true });
  });

  it("still un-marks a segment with no take", () => {
    // Only the marking direction throws; `setSegmentFinished(false)` resets the
    // row to not-started and is accepted. Gating it too would be a second bug.
    // (A stored `true` implies a take, so this combination is defensive.)
    expect(
      planPendingWork(
        work({ finishedIntent: false, storedFinished: true, hasTake: false })
      )
    ).toEqual({ action: "mark", finished: false });
  });

  it("does not reach this gate at all after a superseded capture", () => {
    // `planClose` used to fall through into `planFinishedWrite` on a superseded
    // stop, so this gate was the only thing standing between a ticked Finished
    // box and a rejected store write. Since #211 that route writes nothing
    // whatever `hasTake` says, so the outcome here is `close` for a stronger
    // reason than the gate — asserted so that restoring the fall-through is
    // caught by the #211 cases above rather than silently passing here.
    expect(
      planClose(
        idle({
          capture: supersededCapture,
          finishedIntent: true,
          storedFinished: false,
          hasTake: false,
        })
      ).action
    ).toBe("close");
  });

  it("leaves the edit-only save alone — its mark rides the write", () => {
    // `save-edit` goes through `saveTake`, which creates the take and applies
    // the mark atomically, so there is no store rejection to avoid and the
    // gate must NOT suppress it.
    expect(
      planPendingWork(
        work({
          hasEdits: true,
          workingLength: 100,
          finishedIntent: true,
          storedFinished: false,
          hasTake: false,
        })
      )
    ).toEqual({ action: "save-edit", finished: true });
  });
});

describe("planClose — a close that changes nothing", () => {
  it("just closes", () => {
    expect(planClose(idle())).toEqual({ action: "close" });
  });
});

/**
 * The no-capture half on its own.
 *
 * `leaveHeldTake` — the recovery panel's Done and its two-tap discard — runs
 * exactly this, because the panel is reached with the capture already settled.
 * It is the half that was silently dropped twice (George R2 B-4 lost the edits,
 * R4-G1 lost the flag), which is why it is one function rather than a second
 * copy of the same branches.
 */
describe("planPendingWork", () => {
  it("clears a buffer edited down to nothing", () => {
    expect(planPendingWork(work({ hasEdits: true, workingLength: 0 }))).toEqual(
      {
        action: "clear",
      }
    );
  });

  it("saves a non-empty edited buffer, carrying an explicit mark", () => {
    expect(
      planPendingWork(
        work({ hasEdits: true, workingLength: 9, finishedIntent: true })
      )
    ).toEqual({ action: "save-edit", finished: true });
  });

  it("writes a real finished toggle when there is no edit to carry it", () => {
    expect(
      planPendingWork(work({ finishedIntent: true, storedFinished: false }))
    ).toEqual({ action: "mark", finished: true });
  });

  it("does nothing when the session owes nothing", () => {
    expect(planPendingWork(work())).toEqual({ action: "close" });
  });

  it("persists an edit that `planClose` would abandon on a superseded capture", () => {
    // The two are deliberately NOT the same function. Same inputs, different
    // answers, because a superseded capture means a take was in play and its
    // fate is unknown; reaching the recovery panel means the capture is settled.
    const inputs = work({ hasEdits: true, workingLength: 0 });
    expect(planPendingWork(inputs).action).toBe("clear");
    expect(planClose({ ...inputs, capture: supersededCapture }).action).toBe(
      "close"
    );
  });
});
