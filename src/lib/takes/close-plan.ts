/**
 * What closing the recorder does — as a pure decision over its inputs.
 *
 * `close()` in `components/recorder.tsx` is the ONLY commit path in the
 * product: there is no Stop control, so a take exists on disk because the sheet
 * was closed (F8). It carried this whole decision inline, and this project has
 * no renderer — `vitest.config.ts` sets `environment: "node"` and there is no
 * jsdom or testing-library in `package.json` — so nothing could reach it. A
 * wrong branch there does not produce a wrong pixel; it drops a recording a
 * translator cannot make again, with `npm run verify` and CI green (#180).
 *
 * So the decision moved here, by the same move that produced
 * `lib/takes/pending-take.ts` and `lib/audio/session.ts`: pure, DOM-free,
 * React-free, and enumerated in `tests/close-plan.test.ts`. The component keeps
 * only the effects — stopping the capture, the two saves, the store write, and
 * the reset that leaves the sheet open.
 *
 * The order the plan encodes is not arbitrary. A committed take carries the
 * pending edits (its splice base IS the edited buffer, Model A) and carries the
 * finished mark (applied atomically with the take, so a separate write cannot
 * be clobbered by the same close's demote-to-draft). So at most ONE of
 * save-take / save-edit / clear / mark ever happens.
 *
 * And a capture whose stop was SUPERSEDED writes nothing at all (#211): the
 * sheet is coming down underneath a newer recording or a backgrounding, so
 * neither the pending edits nor the finished toggle is still a statement about
 * what should be on disk.
 */

/**
 * What a stopped capture yielded.
 *
 * Structurally the `StopResult` of `hooks/use-recorder.ts`, so the component
 * passes that result straight through with no conversion to drift. Declared
 * here rather than imported because `lib/` may not reach into `hooks/`.
 */
export interface CaptureOutcome {
  /** Canonical PCM when the take produced usable audio, else null. */
  readonly samples: Int16Array | null;
  /**
   * A translator-facing reason when `samples` is null and it is worth saying.
   * Null when there is nothing to say — a superseded stop, whose UI belongs to
   * a newer recording.
   */
  readonly error: string | null;
}

/** Everything the close decision reads. */
export interface CloseInputs {
  /**
   * The stopped capture's outcome, or null when no capture was attempted —
   * `attemptsCapture` was false, so `stopRecording` was never called. The two
   * are the same question: non-null here means a take was in play at close.
   */
  readonly capture: CaptureOutcome | null;
  /** Whether this session cut or pasted (`useSegmentEditor.hasEdits`). */
  readonly hasEdits: boolean;
  /** Frames in the working buffer — zero after a cut down to nothing. */
  readonly workingLength: number;
  /**
   * The finished checkbox's desired state, or null when the translator never
   * touched it this session. Null and false are NOT the same: only an explicit
   * mark makes a take finished, and a re-record nobody marked is a
   * demote-to-draft.
   */
  readonly finishedIntent: boolean | null;
  /** The segment's stored finished flag, or null when no segment is loaded. */
  readonly storedFinished: boolean | null;
}

/** The one thing the close does, and what the executor needs to do it. */
export type ClosePlan =
  /** Commit the capture, splicing it into the working buffer. */
  | {
      readonly action: "save-take";
      readonly samples: Int16Array;
      readonly finished: boolean;
    }
  /** Persist the edited buffer on its own — no capture to splice (B5). */
  | { readonly action: "save-edit"; readonly finished: boolean }
  /** The edits cut the take down to nothing: return the segment to unrecorded. */
  | { readonly action: "clear" }
  /** Nothing to persist but a real finished toggle, written directly. */
  | { readonly action: "mark"; readonly finished: boolean }
  /** Nothing to do — exit. */
  | { readonly action: "close" }
  /**
   * Do not exit: the capture yielded no audio and said why, so the sheet stays
   * open with the reason in place. Closing here would lose a take silently.
   */
  | { readonly action: "stay"; readonly error: string };

/**
 * The recorder states a close has to stop a capture from.
 *
 * A local union rather than an import of `RecorderState`, which lives in
 * `hooks/use-recorder.ts` where `lib/` may not reach. The call site still ties
 * the two together: `recorder.tsx` passes a `RecorderState`, so a state added
 * there and not here fails typecheck at that call rather than silently reading
 * as "no capture in play".
 */
type CaptureState =
  "idle" | "requesting" | "recording" | "paused" | "processing";

/**
 * Whether closing from this state has to stop a capture first.
 *
 * `processing` counts: a #59 mic interruption freezes a real take there, and
 * its audio is owed a stop. `requesting` does not — the permission prompt is
 * still up and there is no recorder yet, so treating it as a take would swallow
 * an edit-only close behind a stop that returns nothing.
 */
export function attemptsCapture(state: CaptureState): boolean {
  return state === "recording" || state === "paused" || state === "processing";
}

export function planClose(inputs: CloseInputs): ClosePlan {
  const { capture, hasEdits, workingLength, finishedIntent, storedFinished } =
    inputs;

  if (capture) {
    // Confirmed samples first, ahead of any error also reported: audio already
    // in hand is committed rather than turned into a notice. A successful
    // decode to ZERO frames is not audio — persisting it would fabricate a
    // recorded state that plays silence.
    if (capture.samples && capture.samples.length > 0) {
      return {
        action: "save-take",
        samples: capture.samples,
        // Only an explicit mark this session marks the take finished.
        finished: finishedIntent === true,
      };
    }
    // Nothing usable AND something to say — an empty capture or a decode
    // failure. Stay open: exiting would close silently on a take that cannot be
    // recorded again.
    if (capture.error !== null) return { action: "stay", error: capture.error };
    // Otherwise: no samples and no error — a superseded stop, a cancel/leave
    // landed during it. Nothing to save and nothing to say, so close: exit
    // without a write rather than dead-ending the sheet open (#59).
    //
    // NOTHING is persisted on this path, the finished toggle included (#211,
    // decided by the DRI 2026-09-04). A superseded stop means the sheet is
    // being torn down underneath a newer recording or a backgrounding, so this
    // session's intent has stopped being a statement about what should be on
    // disk. The pending edits were already withheld for that reason — a
    // cut-to-empty cleared here would drop the original recording while the
    // replacement never landed and the cut audio lives only in RAM on the
    // clipboard, unrecoverable field loss — and Finished is a write of the same
    // kind: a real transition, and the trigger for transcode-on-Finished (D3),
    // so honouring it would start an MP3 encode of the very audio the
    // interrupted session was midway through replacing. Same rule as the edits
    // path, which is the point: one interrupted close, no writes.
    return { action: "close" };
  } else if (hasEdits) {
    // An edit-only close: cuts and pastes with no capture to splice them into.
    return workingLength === 0
      ? // Cut down to nothing clears the take, so there is no 0-frame ghost:
        // a resolved clip that plays silence and can be counted finished. A
        // cleared segment is never-recorded, so it carries no finished mark.
        { action: "clear" }
      : { action: "save-edit", finished: finishedIntent === true };
  }

  // A toggle with nothing committed is a direct write — there is no take to
  // carry it. Only a real change, and only against a loaded segment: the store
  // rejects a finished mark on a segment with no take.
  if (
    storedFinished !== null &&
    finishedIntent !== null &&
    finishedIntent !== storedFinished
  ) {
    return { action: "mark", finished: finishedIntent };
  }
  return { action: "close" };
}
