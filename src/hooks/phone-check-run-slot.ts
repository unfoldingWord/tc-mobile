/**
 * The one phone-check run slot (#1009), on its own so `App` can read it
 * without loading the phone check itself (#1747).
 *
 * `App` asks `isPhoneCheckRunning` from the system-Back layer it registers
 * when the check opens, and that layer exists before the screen's lazy chunk
 * has loaded. Everything else about the check — the screen, `usePhoneCheck`,
 * the probes and the report — loads with that chunk. This module stays in the
 * entry chunk, and the lazy chunk imports it from there, so both read the
 * same flag.
 */

let runInFlight = false;
const slotListeners = new Set<() => void>();

function setRunInFlight(next: boolean): void {
  runInFlight = next;
  for (const listener of slotListeners) listener();
}

/** For `useSyncExternalStore`: called whenever a run claims or frees the slot. */
export function subscribeToRunSlot(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}

/**
 * Claim the one phone-check run slot, or `null` while a run holds it.
 *
 * Module-wide rather than per screen: a run is not tied to the screen that
 * started it, and two storage probes on the one throwaway database would race
 * each other's leading and trailing deletes. The screen keeps Close disabled
 * while a run is in flight, so this is the backstop, not the usual guard.
 * The returned release works once; a second call is ignored, so a stale
 * release cannot free a later run's claim.
 */
export function claimPhoneCheckRun(): (() => void) | null {
  if (runInFlight) return null;
  setRunInFlight(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setRunInFlight(false);
  };
}

/**
 * Whether a run holds the slot right now. A live read of the module flag, so
 * the screen's system-Back layer can refuse a Back mid-run without a render
 * having to see the run first (invariant 4, docs/design/back-navigation.md).
 */
export function isPhoneCheckRunning(): boolean {
  return runInFlight;
}
