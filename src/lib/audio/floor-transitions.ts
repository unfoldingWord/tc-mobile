/**
 * The approach-B audio-floor transitions for the paused-take preview (#101).
 *
 * Extracted from `hooks/use-audio-session.ts` so the SEQUENCE it performs —
 * release a paused mic's floor claim so a preview can sound, reclaim it on resume
 * — is unit-testable against the pure arbiter in plain Node, not only on a device
 * (Frank #101 R6). The hook keeps the browser wiring and the React state; these
 * are the pure floor decisions it delegates, over the `AudioSession` arbiter
 * (`session.ts`), which is itself pure and DOM-free.
 *
 * The invariant these encode: a mic that is PAUSED is not capturing, so it may
 * yield the floor to a preview and reclaim it on resume — but a mic that is LIVE
 * must never be preempted, or a hot microphone would be left with no floor holder
 * (the hazard `session.ts` refuses to gate on which buttons are rendered).
 */

import type { AudioSession } from "./session";

/**
 * Release a PAUSED mic's floor claim so `claim("take")` for a preview is not
 * refused, and return the mic token that survives — `null`, because the claim is
 * gone (`resumeRecording` mints a fresh one via {@link reclaimMic}). A no-op that
 * returns `micToken` unchanged unless the mic actually holds the floor AND the
 * recorder is paused: `stopAll()` clears the mic's claim without stopping the
 * microphone (its `liveHandle` is null while it holds the floor), and a LIVE
 * recording is never preempted — the guard is structural, not caller discipline.
 */
export function preemptPausedMic(
  session: AudioSession,
  recorderPaused: boolean,
  micToken: number | null
): number | null {
  if (session.live === "mic" && recorderPaused) {
    session.stopAll();
    return null;
  }
  return micToken;
}

/** The outcome of a mic reclaim: the token to store, and whether a reclaim ran. */
export interface ReclaimResult {
  /** The mic token to hold after the reclaim — a fresh claim, or the current one. */
  readonly token: number | null;
  /**
   * True when the floor was actually reclaimed (it was not already the mic's).
   * The caller clears its buffer-playing flag then, because `claim("mic")` stops
   * a still-sounding preview handle. False on a plain pause→resume, where the mic
   * never left the floor and nothing was sounding.
   */
  readonly reclaimed: boolean;
}

/**
 * Reclaim the mic floor on resume. When a preview released the claim the floor is
 * held by `"take"` or nothing, so `claim("mic")` takes it back and stops a
 * still-sounding preview; when the mic still holds it (a plain pause→resume) the
 * current token stands and nothing sounded. `claim("mic")` is never refused, so a
 * reclaim always yields a token to store.
 */
export function reclaimMic(
  session: AudioSession,
  micToken: number | null
): ReclaimResult {
  if (session.live !== "mic") {
    return { token: session.claim("mic"), reclaimed: true };
  }
  return { token: micToken, reclaimed: false };
}
