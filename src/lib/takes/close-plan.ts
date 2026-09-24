/**
 * What closing the recorder does — as a pure decision over its inputs.
 *
 * `close()` in `components/recorder.tsx` is the ONLY commit path in the
 * product: there is no Stop control, so a take exists on disk because the sheet
 * was closed (F8). It carried this whole decision inline, and nothing mounts
 * `Recorder`'s effect graph in this test suite — `vitest.config.ts`'s default
 * environment is `node`, and no test renders the component to reach it. A
 * wrong branch there does not produce a wrong pixel; it drops a recording a
 * translator cannot make again, with `npm run verify` and CI green (#180).
 *
 * So the decision moved here, by the same move that produced
 * `lib/takes/pending-take.ts` and `lib/audio/session.ts`: pure, DOM-free,
 * React-free, and enumerated in `tests/close-plan.test.ts`. The component keeps
 * only the effects — stopping the capture, the two saves, the store write, the
 * held-take panel, and the reset that leaves the sheet open.
 *
 * The order the plan encodes is not arbitrary. A committed take carries the
 * pending edits (its splice base IS the edited buffer, Model A) and carries the
 * finished mark (applied atomically with the take, so a separate write cannot
 * be clobbered by the same close's demote-to-draft). So at most ONE of
 * save-take / save-edit / clear / mark ever happens.
 *
 * And a close whose capture classifies as SUPERSEDED — the leftover kind in
 * `classifyCapture` below, meaning the stop left NOTHING behind: no samples, no
 * kept bytes and no error — writes nothing at all (#211). Neither the pending
 * edits nor the finished toggle is still a statement about what should be on
 * disk, because the recording they were about never landed.
 *
 * Read that as the KIND, never as "the generation was bumped". The two are not
 * the same question, and conflating them would cost a take: a generation-bumped
 * stop that still decoded usable PCM classifies as `take` and is still
 * committed, finished mark and all, and one whose decode threw classifies as
 * `hold` and keeps its bytes for the recovery panel. `classifyStopDecode` in
 * `lib/audio/stop-decode.ts` emits those samples and keeps that blob EVEN WHEN
 * SUPERSEDED — only the shared UI message is withheld. So a later change that
 * gates every generation-bumped stop on this paragraph would drop confirmed
 * audio and break the #59 / #165 contract.
 */

import type { CaptureFailure } from "@/lib/audio/capture-failure";

/**
 * What a stopped capture yielded.
 *
 * Structurally the `StopResult` of `hooks/use-recorder.ts`, so the component
 * passes that result through with no conversion to drift. Declared here rather
 * than imported because `lib/` may not reach into `hooks/`.
 *
 * `TBytes` is the captured container bytes — a `Blob` at the one call site.
 * Generic rather than named, because naming `Blob` here would put a web type in
 * `lib/`, which `npm run typecheck:lib` exists to keep out (it compiles this
 * directory with no DOM lib). The bytes are never inspected, only carried, so
 * the parameter costs nothing and the component still gets a narrowed `Blob`
 * back out of the verdict instead of re-checking a value the classifier has
 * already proved non-null.
 */
export interface CaptureOutcome<TBytes = unknown> {
  /** Canonical PCM when the take produced usable audio, else null. */
  readonly samples: Int16Array | null;
  /**
   * The captured container bytes, kept whenever the DECODE failed — on a
   * current stop and on a superseded one alike (`StopResult.blob`). Null on
   * success, and null on an empty or silent capture, where there is no audio
   * worth keeping.
   */
  readonly bytes: TBytes | null;
  /**
   * Why `samples` is null, when it is worth saying — a {@link CaptureFailure}
   * code. Null when there is nothing to say: a superseded stop, whose UI
   * belongs to a newer recording.
   *
   * A CLOSED set, and only since #169 moved the wording up to the screen.
   * Three producers write this field, and each used to mint its own sentence:
   * `use-recorder.ts`'s decode exits via `classifyStopDecode`; `stop()`'s
   * empty-seal exit directly (silence, or after the flush executor threw,
   * "could not finish" — #485, George R1 P3 on #500); and `stopRecording`'s
   * backstop in `use-audio-session.ts`, which typed that same "could not
   * finish" sentence out a second time. Only the first went through a
   * classifier, so `StopDecodeError` was NOT the set of stop errors and this
   * docblock had to warn that a `lib/` change treating it as one was wrong.
   * Now every producer picks a member of one union, `StopDecodeError` narrows
   * from it by construction. This file's own readers carry a fourth member
   * unchanged, deliberately — choosing its sentence is `captureFailureText`'s
   * job, and that `never` default is what refuses to compile until someone
   * does.
   * `!== null` here and the component's former truthiness test agree on every
   * value that can actually arrive.
   */
  readonly error: CaptureFailure | null;
}

/**
 * What a stop yielded, as the one classification both commit paths read.
 *
 * `close()` and the commit-and-edit path in `onEnterEdit` (#134) must take the
 * same four-way decision on a stop result and then do DIFFERENT things with it
 * — one exits, the other opens edit mode. That agreement used to be a comment
 * ("Mirror close()'s precedence exactly"), which is the kind of claim that
 * rots; it is now one function they both call.
 * Their write policy also agrees: a superseded capture withholds pending edits,
 * clear and Finished. The component carries that verdict across an Edit-commit
 * to later no-capture exits, until a fresh take is successfully saved (#527).
 *
 * The payload rides the verdict so neither caller re-checks what the classifier
 * has already established: `samples` is proved non-empty, `bytes` proved
 * non-null, `error` proved present.
 */
export type CaptureVerdict<TBytes = unknown> =
  /** Usable audio in hand — commit it. */
  | { readonly kind: "take"; readonly samples: Int16Array }
  /**
   * The decode failed but the captured bytes survive (#165). The take exists
   * NOWHERE else, so these are held for the recovery panel — re-decode on a
   * fresh gesture, or share the bytes off the phone.
   */
  | { readonly kind: "hold"; readonly bytes: TBytes }
  /** No audio and nothing kept, but something worth saying — an empty capture. */
  | { readonly kind: "notice"; readonly error: CaptureFailure }
  /**
   * Nothing at all: a `leave()`/pagehide bumped the generation mid-flush, so a
   * newer owner speaks for the screen and this stop has no UI of its own.
   */
  | { readonly kind: "superseded" };

/**
 * Which of the four a stop result is.
 *
 * The precedence is the load-bearing part, and each step of it is a take that
 * was lost once:
 *
 * 1. Confirmed samples first, ahead of any error also reported — audio already
 *    in hand is committed rather than turned into a notice. A successful decode
 *    to ZERO frames is not audio: persisting it would fabricate a recorded
 *    state that plays silence.
 * 2. Kept bytes BEFORE the error, so a superseded stop whose decode failed
 *    (bytes kept, error withheld — George R1 G2) holds them instead of falling
 *    through to a silent close. That interruption is the #106 case #165 exists
 *    to recover, and it was the one the panel never appeared on.
 * 3. Only then the error, which by then means an empty or silent capture: no
 *    audio, and no bytes a retry could help with.
 */
export function classifyCapture<TBytes>(
  outcome: CaptureOutcome<TBytes>
): CaptureVerdict<TBytes> {
  const { samples, bytes, error } = outcome;
  if (samples && samples.length > 0) return { kind: "take", samples };
  if (bytes !== null) return { kind: "hold", bytes };
  if (error !== null) return { kind: "notice", error };
  return { kind: "superseded" };
}

/**
 * The session work an exit still owes when no take is being committed: a
 * pending B5 edit, and a pending Finished toggle.
 *
 * Separated from the capture decision because two callers need exactly this
 * half and nothing else — the recovery panel's exit (`leaveHeldTake`), and a
 * close where the recorder was idle.
 */
export interface PendingWork {
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
  /**
   * Whether the segment has audio on disk that a Finished mark can attach to.
   *
   * The store is the reason this input exists: `setSegmentFinished` THROWS on
   * `finished === true` when `activeTakeId === null` (`lib/storage/books.ts`),
   * and accepts `false` there (it resets the row to not-started). Without this,
   * a Finished box ticked while recording a FIRST take, on a capture that then
   * produced nothing, plans a `mark` the store rejects — and the recorder's
   * only response to that rejection is to stay open, on a sheet where the box
   * is now disabled and so cannot be un-ticked. See the PR for #180.
   *
   * `view.hasClip` at the call site, which follows the clip RESOLVING rather
   * than `activeTakeId`, so it is deliberately conservative: a dangling take
   * (row points at a clip the database cannot produce) reads false here and its
   * mark is skipped. That matches the F3 rule the rest of the UI already
   * applies to a dangling take — it opens as an empty, record-only segment —
   * and marking such a segment finished would call unreadable audio done.
   */
  readonly hasTake: boolean;
}

/** Everything the close decision reads. */
export interface CloseInputs<TBytes = unknown> extends PendingWork {
  /**
   * The stopped capture's outcome, or null when no capture was attempted —
   * `attemptsCapture` was false, so `stopRecording` was never called. The two
   * are the same question: non-null here means a take was in play at close.
   */
  readonly capture: CaptureOutcome<TBytes> | null;
}

/**
 * The work a close owes when there is no capture to commit. A separate type
 * because the recovery-panel exit can only ever produce one of these, and the
 * component's executor for them is shared by both callers — the George R4-G1
 * root, now a type rather than a convention.
 */
export type TailPlan =
  /** The edits cut the take down to nothing: return the segment to unrecorded. */
  | { readonly action: "clear" }
  /** Persist the edited buffer on its own — no capture to splice (B5). */
  | { readonly action: "save-edit"; readonly finished: boolean }
  /** Nothing to persist but a real finished toggle, written directly. */
  | { readonly action: "mark"; readonly finished: boolean }
  /** Nothing to do — exit. */
  | { readonly action: "close" };

/** The one thing the close does, and what the executor needs to do it. */
export type ClosePlan<TBytes = unknown> =
  /** Commit the capture, splicing it into the working buffer. */
  | {
      readonly action: "save-take";
      readonly samples: Int16Array;
      readonly finished: boolean;
    }
  /**
   * Do not exit: the decode failed and the bytes are the take's only copy.
   * They go to the recovery panel (#165), whose own actions are the way out.
   */
  | { readonly action: "hold"; readonly bytes: TBytes }
  /**
   * Do not exit: the capture yielded no audio and said why, so the sheet stays
   * open with the reason in place. Closing here would lose a take silently.
   */
  | { readonly action: "stay"; readonly error: CaptureFailure }
  | TailPlan;

/**
 * The recorder states a close has to stop a capture from.
 *
 * A local union rather than an import of `RecorderState`, which lives in
 * `hooks/use-recorder.ts` where `lib/` may not reach. The call site still ties
 * the two together: `recorder.tsx` passes a `RecorderState`, so a state added
 * there and not here fails typecheck at that call rather than silently reading
 * as "no capture in play".
 */
type CaptureState = "idle" | "requesting" | "recording" | "processing";

/**
 * Whether closing from this state has to stop a capture first.
 *
 * `processing` counts: a #59 mic interruption freezes a real take there, and
 * its audio is owed a stop — a close can still land in that window before the
 * sheet's own in-place commit (#614) has taken it. `requesting` does not — the
 * permission prompt is still up and there is no recorder yet, so treating it as
 * a take would swallow an edit-only close behind a stop that returns nothing.
 */
export function attemptsCapture(state: CaptureState): boolean {
  return state === "recording" || state === "processing";
}

/**
 * The finished toggle on its own — the last thing a close can owe.
 *
 * Only a real change, and only against a loaded segment: the store rejects a
 * finished mark on a segment with no take.
 *
 * That rejection is why `hasTake` is a separate input from `storedFinished`.
 * They are NOT the same question: a never-recorded segment and a recorded
 * draft both load as `storedFinished: false`, and only one of them can accept
 * a mark. Asking the store and handling the throw is not equivalent either —
 * the recorder's only answer to a failed flag write is to stay open, which on
 * this path strands the sheet (the box that set the intent is disabled once
 * the take is gone, so it cannot be un-ticked).
 */
function planFinishedWrite(
  finishedIntent: boolean | null,
  storedFinished: boolean | null,
  hasTake: boolean
): TailPlan {
  if (
    storedFinished !== null &&
    finishedIntent !== null &&
    finishedIntent !== storedFinished
  ) {
    // Mirrors `setSegmentFinished` exactly: it throws on `true` with no active
    // take and accepts `false` (resetting the row to not-started). So only the
    // marking direction is gated — an un-mark still goes through, and in any
    // case a stored `finished` of true implies a take, so that combination
    // cannot arrive here.
    if (finishedIntent && !hasTake) return { action: "close" };
    return { action: "mark", finished: finishedIntent };
  }
  return { action: "close" };
}

/**
 * What an exit owes when nothing was captured: the pending edit, then the
 * pending toggle. At most one of them — a saved edit carries the mark.
 */
export function planPendingWork(inputs: PendingWork): TailPlan {
  const { hasEdits, workingLength, finishedIntent, storedFinished, hasTake } =
    inputs;
  if (hasEdits) {
    return workingLength === 0
      ? // Cut down to nothing clears the take, so there is no 0-frame ghost:
        // a resolved clip that plays silence and can be counted finished. A
        // cleared segment is never-recorded, so it carries no finished mark.
        { action: "clear" }
      : { action: "save-edit", finished: finishedIntent === true };
  }
  return planFinishedWrite(finishedIntent, storedFinished, hasTake);
}

export function planClose<TBytes>(
  inputs: CloseInputs<TBytes>
): ClosePlan<TBytes> {
  const { capture, finishedIntent } = inputs;

  if (capture) {
    const verdict = classifyCapture(capture);
    switch (verdict.kind) {
      case "take":
        return {
          action: "save-take",
          samples: verdict.samples,
          // Only an explicit mark this session marks the take finished.
          finished: finishedIntent === true,
        };
      case "hold":
        return { action: "hold", bytes: verdict.bytes };
      case "notice":
        return { action: "stay", error: verdict.error };
      case "superseded":
        // Reached only when the stop left NOTHING behind — no samples, no kept
        // bytes, no error. A bumped generation alone does not land here:
        // confirmed PCM is `take` above and is still committed, and a failed
        // decode's bytes are `hold` and still recovered, both of them even when
        // superseded (`lib/audio/stop-decode.ts`). This is the empty case.
        //
        // Nothing to save and nothing to say, so close rather than dead-end
        // the sheet open (#59) — and write NOTHING on the way out (#211).
        //
        // The pending edits were already withheld here, and for a reason that
        // applies to the finished toggle just as well: a cut-to-empty cleared
        // on a superseded stop would drop the original recording while the
        // replacement never landed and the cut audio lives only in RAM on the
        // clipboard, unrecoverable field loss (George R5). A Finished mark on
        // this path lands on the STORED take, since the one in flight never
        // did — and Finished is the trigger for transcode-on-Finished (D3,
        // ADR 0009), so honouring it starts a lossy 64 kbps encode of the one
        // recording that survived, on the strength of an intent the
        // translator expressed about its replacement. One interrupted close,
        // no writes. Note `planPendingWork` is deliberately NOT what runs
        // here: the recovery panel's exit reaches it with the capture
        // settled, which is a different question.
        return { action: "close" };
    }
  }
  return planPendingWork(inputs);
}
