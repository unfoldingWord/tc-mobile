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
   * which a run of silent samples has lasted {@link CAPTURE_SILENCE_MS} with
   * no gap or clock stall over {@link CAPTURE_SILENCE_MAX_GAP_MS} and the
   * clock has moved since the run began; false ever after.
   */
  note(silent: boolean, nowMs: number, clock: number): boolean;
  /** Restart the run, as a context leaving "running" does. */
  reset(): void;
}

/**
 * A run is only as long as it was watched. A gap wider than this between two
 * samples, or a clock that has not moved for this long, ends the run: the
 * window never bridges a stretch nobody pulled a frame in, and a clock that
 * moved once and then stood still is #1251's case, not this one. Pulls come
 * once or twice per display frame, so a second is many frames; it matches
 * #1251's 1000 ms stall bound.
 */
export const CAPTURE_SILENCE_MAX_GAP_MS = 1000;

export function createSilenceWindow(
  windowMs: number = CAPTURE_SILENCE_MS
): SilenceWindow {
  let runStartMs: number | null = null;
  let runStartClock = 0;
  let lastNoteMs: number | null = null;
  let lastClock = Number.NEGATIVE_INFINITY;
  let lastClockMoveMs = 0;
  let fired = false;
  return {
    note(silent, nowMs, clock) {
      if (fired) return false;
      const gapWide =
        lastNoteMs !== null && nowMs - lastNoteMs > CAPTURE_SILENCE_MAX_GAP_MS;
      if (clock > lastClock) lastClockMoveMs = nowMs;
      const stalled = nowMs - lastClockMoveMs > CAPTURE_SILENCE_MAX_GAP_MS;
      lastNoteMs = nowMs;
      lastClock = clock;
      // A late silent sample may start a run; it never finishes one.
      if (!silent || gapWide || stalled) runStartMs = null;
      if (!silent) return false;
      if (runStartMs === null) {
        runStartMs = nowMs;
        runStartClock = clock;
        lastClockMoveMs = nowMs;
        return false;
      }
      if (nowMs - runStartMs < windowMs) return false;
      if (!(clock > runStartClock)) return false;
      fired = true;
      return true;
    },
    reset() {
      runStartMs = null;
      lastNoteMs = null;
    },
  };
}
