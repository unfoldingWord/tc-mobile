/**
 * The take-length cap (#1005).
 *
 * `stop()` decodes a whole take into memory at once, so a very long take is
 * the one a low-RAM phone is likeliest to fail on (#1002 has the worst-case
 * research). The DRI's decision, 2026-09-25, verbatim: "Warn at 15, seal at
 * 20". At the cap the recorder seals the take the way a `pagehide` does
 * (#807), so it is saved, never discarded; from the warning the recorder
 * screen can mark the take state-in-place.
 *
 * Both thresholds are constants here so the phone check (#1002 §6) can move
 * them in one place. Pure: no clock of its own — the recorder hands in the
 * elapsed time it already keeps.
 */

/** From here the take is near the limit. */
const TAKE_WARN_MS = 15 * 60_000;

/** At this length the recorder seals the take. */
export const TAKE_CAP_MS = 20 * 60_000;

export interface TakeCapStatus {
  /** True from {@link TAKE_WARN_MS} of a live take, for the screen's marker. */
  readonly nearLimit: boolean;
  /** Milliseconds left before the seal, never below 0. */
  readonly remainingMs: number;
  /** True once a live take has reached {@link TAKE_CAP_MS}. */
  readonly reached: boolean;
}

const NOT_RECORDING: TakeCapStatus = {
  nearLimit: false,
  remainingMs: TAKE_CAP_MS,
  reached: false,
};

/**
 * Where a take stands against the cap. `recording` is false at idle, while
 * requesting and while processing: the elapsed time keeps its last value after
 * a Stop, and a finished take is not near any limit.
 */
export function takeCapStatus(
  elapsedMs: number,
  recording: boolean
): TakeCapStatus {
  if (!recording) return NOT_RECORDING;
  return {
    nearLimit: elapsedMs >= TAKE_WARN_MS,
    remainingMs: Math.max(0, TAKE_CAP_MS - elapsedMs),
    reached: elapsedMs >= TAKE_CAP_MS,
  };
}
