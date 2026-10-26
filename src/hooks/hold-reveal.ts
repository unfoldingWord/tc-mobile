/**
 * Hold-to-reveal, the timing half (S14, #1284): hold a cut-off name and the
 * whole name shows; let go and it goes away.
 *
 * The requirements owner's answer to S14 ("Reading a long name in full") was
 * "Tap or hold a name to see it in full" (`docs/design/v2-plan.md`). A tap on
 * a Books name already opens its chapter or its book, so this is the hold.
 *
 * The hold and the slop are the reorder's own (`lib/view/reorder-gesture.ts`),
 * so a held name and a held row take the same time and forgive the same
 * wobble. Which press this machine gets at all is decided by the caller
 * (`use-hold-reveal.ts`): only a press on a name that is actually cut off.
 *
 * Plain arithmetic over an injected clock, so it runs in Node.
 */
import { REORDER_HOLD_MS, REORDER_SLOP_PX } from "@/lib/view/reorder-gesture";

/** The hold before the name shows: the reorder's, so the two feel the same. */
export const REVEAL_HOLD_MS = REORDER_HOLD_MS;
/** The longest the name stays up while the finger stays down. */
export const REVEAL_CAP_MS = 6000;

/** The timer pair the hold runs on. Injected so a test can own the clock. */
export interface HoldRevealTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: HoldRevealTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface HoldRevealCallbacks {
  /** The hold completed: draw the whole name. */
  show(): void;
  /** Take it away again. Called once per `show`. */
  hide(): void;
}

/**
 * - `idle`: no press.
 * - `pending`: a press on a cut-off name, waiting out the hold.
 * - `shown`: the whole name is up.
 * - `spent`: it was up and has been put away (the 6 s cap, Escape, a second
 *   touch) while the finger is still down, so its release is still swallowed.
 */
type HoldRevealPhase = "idle" | "pending" | "shown" | "spent";

export interface HoldReveal {
  /** A press on a cut-off name. Ignored unless idle. */
  press(pointerId: number, x: number, y: number): void;
  move(pointerId: number, x: number, y: number): void;
  /**
   * That press's finger lifted. `true` when the press showed the name, so
   * the caller swallows the click the release would otherwise land (no open,
   * no toggle); `false` for a tap, whose click must still land.
   */
  up(pointerId: number): boolean;
  /** Another finger touched down anywhere. */
  otherPointer(): void;
  /** Escape: put the name away, keep the press. */
  dismiss(): void;
  /** pointercancel, the page hidden or blurred, unmount: end everything. */
  cancel(): void;
  /** Something scrolled. Before the hold, that was a scroll, not a hold. */
  scrolled(): void;
  phase(): HoldRevealPhase;
}

export function createHoldReveal(
  cb: HoldRevealCallbacks,
  options: { readonly timers?: HoldRevealTimers } = {}
): HoldReveal {
  const timers = options.timers ?? defaultTimers;
  let phase: HoldRevealPhase = "idle";
  let pointer = -1;
  let startX = 0;
  let startY = 0;
  let timer: unknown = null;

  const clearTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  /** Shown -> spent: take the name down, keep the press. */
  const putAway = () => {
    if (phase !== "shown") return;
    clearTimer();
    phase = "spent";
    cb.hide();
  };

  /** Back to idle from anything, taking the name down if it is up. */
  const reset = () => {
    const was = phase;
    clearTimer();
    phase = "idle";
    pointer = -1;
    if (was === "shown") cb.hide();
  };

  const show = () => {
    timer = null;
    if (phase !== "pending") return;
    phase = "shown";
    timer = timers.set(putAway, REVEAL_CAP_MS);
    cb.show();
  };

  return {
    press(pointerId, x, y) {
      if (phase !== "idle") return;
      phase = "pending";
      pointer = pointerId;
      startX = x;
      startY = y;
      timer = timers.set(show, REVEAL_HOLD_MS);
    },
    move(pointerId, x, y) {
      if (phase !== "pending" || pointerId !== pointer) return;
      if (Math.hypot(x - startX, y - startY) >= REORDER_SLOP_PX) reset();
    },
    up(pointerId) {
      if (phase === "idle" || pointerId !== pointer) return false;
      const revealed = phase !== "pending";
      reset();
      return revealed;
    },
    otherPointer() {
      if (phase === "pending") reset();
      else putAway();
    },
    dismiss() {
      if (phase === "pending") reset();
      else putAway();
    },
    cancel: reset,
    scrolled() {
      if (phase === "pending") reset();
    },
    phase: () => phase,
  };
}
