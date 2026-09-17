/**
 * What an interruption handler should do about the microphone (#59, audit
 * finding A-4).
 *
 * The mic can be taken mid-take — an incoming call, a Bluetooth device change,
 * an OS audio interruption. Two different things can reach the recorder's
 * `onerror`/`onended` handler, and they need opposite treatment:
 *
 *   - the recorder has ALREADY gone `"inactive"` on its own, so the chunks are
 *     final and every capture track can be released immediately; or
 *   - the recorder is still `"recording"`/`"paused"` while its tracks are
 *     dying, so releasing the tracks now could truncate the final
 *     `dataavailable` the take may consist entirely of — the recorder has to be
 *     driven to a flush first, and only then released.
 *
 * Until this existed the handler only covered the first case, and the second
 * left the microphone open until the translator tapped Back — the code's own
 * estimate was "potentially minutes".
 *
 * Pure and DOM-free on purpose: the hook half (the driven `MediaRecorder.stop()`,
 * the bounded flush timer, the handshake with `stop()`) has no automated
 * coverage in this repo — there is no `MediaRecorder` in a Node suite — so the
 * decision is lifted out to the one part that CAN be mutated and pinned.
 */

/**
 * The lifecycle states `MediaRecorder.state` reports. Declared here rather than
 * reusing the DOM `RecordingState` so this module compiles with no DOM lib
 * (`npm run typecheck:lib`), like every other decision in `lib/`.
 */
export type RecorderLifecycleState = "inactive" | "recording" | "paused";

/**
 * - `"skip-stale"` — a newer take owns the recorder's refs; touch nothing.
 * - `"already-flushed"` — chunks are final; release every capture track now.
 * - `"drive-flush"` — stop the recorder, then release once it has flushed or
 *   the bounded wait expires.
 */
export type InterruptFinalizeDecision =
  "skip-stale" | "already-flushed" | "drive-flush";

export function decideInterruptFinalize(input: {
  readonly recorderState: RecorderLifecycleState;
  readonly isCurrentGeneration: boolean;
}): InterruptFinalizeDecision {
  // Generation FIRST, deliberately, and pinned by a test. A superseded
  // interruption must arm nothing — no timer, no pending-flush promise, no
  // teardown — even when the recorder state alone would qualify, because the
  // refs it would reach belong to a newer take by then.
  if (!input.isCurrentGeneration) return "skip-stale";
  // `"paused"` belongs with `"recording"`, not with `"inactive"`: a paused take
  // holds the microphone exactly as a recording one does, and its container is
  // unfinalised, so it needs the same driven flush.
  if (input.recorderState === "inactive") return "already-flushed";
  return "drive-flush";
}

/**
 * What `stop()` should do about the flush, once an interruption may already
 * have driven one.
 *
 * - `"await-driven-flush"` — the interruption handler already stopped THIS
 *   recorder and owns its `onstop`, its bounded timer and its capture tracks.
 *   Wait for that flush and seal; issue no second stop, and do not replace the
 *   handler the flush is waiting on.
 * - `"seal-inactive"` — the recorder ended on its own with no flush of ours
 *   outstanding: today's "already inactive" path, unchanged.
 * - `"drive-stop"` — an ordinary Stop on a live recorder: today's path,
 *   unchanged.
 *
 * The property that makes this reviewable, and the one the tests pin: when no
 * driven flush owns this recorder, the answer depends on `recorderState`
 * ALONE, and it is exactly the `state === "inactive"` test `stop()` has always
 * made. Every new behaviour sits behind `drivenFlushOwnsRecorder`.
 */
export type StopFlushPlan =
  "await-driven-flush" | "seal-inactive" | "drive-stop";

export function planStopFlush(input: {
  readonly recorderState: RecorderLifecycleState;
  /**
   * A flush this hook drove is outstanding AND is tagged with the very
   * recorder this `stop()` holds. Identity, not merely "some flush is
   * pending": a superseded take's flush is none of this stop's business.
   */
  readonly drivenFlushOwnsRecorder: boolean;
}): StopFlushPlan {
  // First, and regardless of state. A driven flush leaves the recorder
  // "inactive" when its stop succeeded and non-inactive when it threw; both
  // are the same situation — someone else owns the teardown — so neither may
  // fall through to a path that stops the recorder again.
  if (input.drivenFlushOwnsRecorder) return "await-driven-flush";
  if (input.recorderState === "inactive") return "seal-inactive";
  return "drive-stop";
}
