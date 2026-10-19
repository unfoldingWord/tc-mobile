/**
 * Capture that has gone silent with no event (#1294, R13).
 *
 * An alarm can stop a take's capture without the phone telling the app: no
 * `mute`, `ended` or `error` reaches the recorder, so the timer keeps
 * counting and the live scope scrolls a flat line. The requirements owner's
 * decision, 2026-10-19, verbatim: "A visible “recording stopped” state that
 * saves what was captured".
 *
 * The signal is the flat line itself: the level tap's analyser reading
 * nothing but EXACT zeros while the shared context runs and its clock moves.
 * A live microphone carries a noise floor even in a quiet room, so its
 * samples are small, not zero; that a phone's microphone path never outputs
 * exact zeros during a real pause is an assumption the device sheet on #1294
 * checks, not something observed. A clock that does not move is #1251's
 * case and is never judged here.
 *
 * The window is one constant so the device sheet can move it in one place.
 * Pure: no clock of its own — the tap hands in wall time and the context's
 * `currentTime`.
 */

/** Exact silence for this long, on a moving clock, means capture stopped. */
export const CAPTURE_SILENCE_MS = 5000;

/**
 * True when every sample of a non-empty frame is exactly zero. `NaN` is not
 * zero, and `-0 === 0`.
 */
export function isDigitalSilence(frame: ArrayLike<number>): boolean {
  if (frame.length === 0) return false;
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] !== 0) return false;
  }
  return true;
}

export interface SilenceWindow {
  /**
   * Note one sample: whether the frame was silent, the wall time and the
   * context clock it was read at. True exactly once, on the first sample at
   * which a run of silent samples has lasted {@link CAPTURE_SILENCE_MS} and
   * the clock has moved since the run began; false ever after.
   */
  note(silent: boolean, nowMs: number, clock: number): boolean;
  /** Restart the run, as a context leaving "running" does. */
  reset(): void;
}

export function createSilenceWindow(
  windowMs: number = CAPTURE_SILENCE_MS
): SilenceWindow {
  let runStartMs: number | null = null;
  let runStartClock = 0;
  let fired = false;
  return {
    note(silent, nowMs, clock) {
      if (fired) return false;
      if (!silent) {
        runStartMs = null;
        return false;
      }
      if (runStartMs === null) {
        runStartMs = nowMs;
        runStartClock = clock;
        return false;
      }
      if (nowMs - runStartMs < windowMs) return false;
      if (!(clock > runStartClock)) return false;
      fired = true;
      return true;
    },
    reset() {
      runStartMs = null;
    },
  };
}
