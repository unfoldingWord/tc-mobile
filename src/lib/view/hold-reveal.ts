/**
 * Touch-and-hold to read a cut-off name in full (#1284, the requirements
 * owner's S14: tap-hold), the pure half.
 *
 * A name the row has cut off with an ellipsis shows whole while a finger
 * stays on it. This module decides only the timing: the hold before the name
 * shows, the slop that turns the touch into a scroll, the cap on how long it
 * stays up, and the dismissal. The DOM half (`hooks/use-hold-reveal.ts`)
 * measures the element and listens for the pointer. Numbers in, booleans out,
 * so it runs in plain Node.
 *
 * It borrows the reorder gesture's hold and slop on purpose: the same finger
 * on the same row means the same "this is a hold" everywhere, and a name the
 * row has NOT cut off is left to the row's own gesture (see the hook).
 */
import {
  REORDER_HOLD_MS,
  REORDER_SLOP_PX,
  type ReorderTimers,
} from "./reorder-gesture";

/** The hold before the name shows. */
export const REVEAL_HOLD_MS = REORDER_HOLD_MS;
/** Movement before the name shows that ends the touch (a scroll). */
export const REVEAL_SLOP_PX = REORDER_SLOP_PX;
/** The longest the name stays up if the finger never lifts. */
export const REVEAL_MAX_MS = 6000;

/** Whether a one-line name is wider than the box that holds it. */
export function isCutOff(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}

export interface HoldRevealCallbacks {
  /** The hold completed: show the name. */
  reveal(): void;
  /** The name was shown and is now put away (release, timeout, cancel). */
  dismiss(): void;
}

export interface HoldReveal {
  press(x: number, y: number): void;
  move(x: number, y: number): void;
  /** The finger lifted. True when the name had been shown. */
  release(): boolean;
  /** The touch ended some other way (cancel, Escape, a second touch). */
  cancel(): void;
}

type Phase = "idle" | "pending" | "shown";

const defaultTimers: ReorderTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createHoldReveal(
  callbacks: HoldRevealCallbacks,
  timers: ReorderTimers = defaultTimers
): HoldReveal {
  let phase: Phase = "idle";
  let startX = 0;
  let startY = 0;
  let timer: unknown = null;

  const clear = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const end = (): boolean => {
    clear();
    const wasShown = phase === "shown";
    phase = "idle";
    if (wasShown) callbacks.dismiss();
    return wasShown;
  };

  return {
    press(x, y) {
      if (phase !== "idle") return;
      phase = "pending";
      startX = x;
      startY = y;
      timer = timers.set(() => {
        timer = null;
        phase = "shown";
        callbacks.reveal();
        timer = timers.set(() => {
          timer = null;
          end();
        }, REVEAL_MAX_MS);
      }, REVEAL_HOLD_MS);
    },
    move(x, y) {
      if (phase !== "pending") return;
      if (Math.hypot(x - startX, y - startY) > REVEAL_SLOP_PX) end();
    },
    release: end,
    cancel() {
      end();
    },
  };
}
