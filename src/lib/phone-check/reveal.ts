/**
 * The tester-only way into the phone check on a build with no address bar
 * (#1009): tap the build stamp {@link REVEAL_TAPS} times within
 * {@link REVEAL_WINDOW_MS}.
 *
 * A deliberately undiscoverable gesture, on the one line of the UI that is
 * already tester metadata (`components/build-stamp.tsx`). The check is a
 * diagnostic, not a feature: a translator who stumbles into it has opened a
 * screen where nothing runs until Start is tapped.
 *
 * Pure: tap times go in, the next tap list and whether to open come out.
 */
export const REVEAL_TAPS = 5;
export const REVEAL_WINDOW_MS = 3000;

export interface TapState {
  /** Tap times still inside the window, oldest first. */
  readonly taps: readonly number[];
  /** Whether this tap completed the gesture. The list is emptied when it does. */
  readonly reveal: boolean;
}

export function registerTap(taps: readonly number[], now: number): TapState {
  const recent = [...taps.filter((at) => now - at < REVEAL_WINDOW_MS), now];
  if (recent.length >= REVEAL_TAPS) return { taps: [], reveal: true };
  return { taps: recent, reveal: false };
}
