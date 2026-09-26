/**
 * Press-and-hold reorder, the pure half (#953 PR2a).
 *
 * The design reference's gesture (docs/design/o4-design-system.md §4 and §7):
 * press and hold a row for 450 ms, then drag it; moving 8px before the hold
 * ends cancels it; the list auto-scrolls within 64px of an edge. D11 makes it
 * drag only for the training.
 *
 * Everything here is arithmetic over numbers the caller hands in, so it runs
 * in plain Node: the hold timer, the slop, which index a pointer position
 * means, and the rule that a gesture ends in at most ONE drop. The caller
 * (`hooks/use-segment-reorder.ts`) owns the DOM: it listens for the pointer,
 * converts positions into the list's content coordinates, and measures the
 * rows when the hold completes.
 *
 * All vertical positions are CONTENT coordinates — measured from the top of
 * the scrolled content, not the viewport — so an auto-scroll during the drag
 * moves the pointer's content position and the target follows it, with no
 * second bookkeeping path for scroll.
 */

/** The hold before a row lifts. */
export const REORDER_HOLD_MS = 450;
/** Movement before the hold ends that cancels it (a scroll, not a hold). */
export const REORDER_SLOP_PX = 8;
/** Distance from the list's top or bottom edge at which it auto-scrolls. */
export const REORDER_EDGE_PX = 64;
/** The fastest auto-scroll, in px per frame, reached at the edge itself. */
const MAX_SCROLL_STEP_PX = 12;

/** The timer pair the hold runs on. Injected so a test can own the clock. */
export interface ReorderTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: ReorderTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface ReorderDragUpdate {
  readonly fromIndex: number;
  readonly toIndex: number;
  /** How far the finger has moved since the lift, in px (down is positive). */
  readonly offset: number;
}

export interface ReorderCallbacks {
  /**
   * The hold completed on row `index`. Returns every row's midpoint in
   * content coordinates, measured now, or `null` to refuse the lift (nothing
   * to measure); a refused lift ends the gesture with no callback.
   */
  lift(index: number): readonly number[] | null;
  /** The lifted row moved. Called on every move, never writes. */
  drag(update: ReorderDragUpdate): void;
  /** The one write: the lifted row was released at a different index. */
  drop(fromIndex: number, toIndex: number): void;
  /**
   * The gesture ended without a write: a tap, 8px before the hold, a scroll
   * before the lift, a pointercancel, or a drop back in place. `lifted` says
   * whether a row had been lifted (and so whether anything must be put back).
   */
  cancel(lifted: boolean): void;
}

type ReorderPhase = "idle" | "pending" | "lifted";

export interface ReorderGesture {
  /** A press on row `index`'s hold area. Ignored while a gesture is active. */
  down(pointerId: number, index: number, x: number, y: number): void;
  move(pointerId: number, x: number, y: number): void;
  up(pointerId: number): void;
  /** pointercancel, leaving the screen, the list changing under the finger. */
  cancel(): void;
  /** The list scrolled. Before the lift that is a scroll, not a hold. */
  scrolled(): void;
  phase(): ReorderPhase;
}

type State =
  | { readonly phase: "idle" }
  | {
      readonly phase: "pending";
      readonly pointerId: number;
      readonly index: number;
      readonly startX: number;
      readonly startY: number;
      lastY: number;
      readonly timer: unknown;
    }
  | {
      readonly phase: "lifted";
      readonly pointerId: number;
      readonly index: number;
      readonly liftY: number;
      readonly midpoints: readonly number[];
      toIndex: number;
    };

export function createReorderGesture(
  cb: ReorderCallbacks,
  options: {
    readonly holdMs?: number;
    readonly slopPx?: number;
    readonly timers?: ReorderTimers;
  } = {}
): ReorderGesture {
  const holdMs = options.holdMs ?? REORDER_HOLD_MS;
  const slopPx = options.slopPx ?? REORDER_SLOP_PX;
  const timers = options.timers ?? defaultTimers;
  let state: State = { phase: "idle" };

  const lift = () => {
    if (state.phase !== "pending") return;
    const { pointerId, index, lastY } = state;
    // Idle BEFORE asking: `lift` measures the DOM, and a throw or a refusal
    // there must not leave a pending gesture whose timer has already fired.
    state = { phase: "idle" };
    const midpoints = cb.lift(index);
    if (!midpoints || index >= midpoints.length) return;
    state = {
      phase: "lifted",
      pointerId,
      index,
      liftY: lastY,
      midpoints,
      toIndex: index,
    };
  };

  const end = (drop: boolean) => {
    const was = state;
    state = { phase: "idle" };
    if (was.phase === "idle") return;
    if (was.phase === "pending") {
      timers.clear(was.timer);
      cb.cancel(false);
      return;
    }
    if (drop && was.toIndex !== was.index) cb.drop(was.index, was.toIndex);
    else cb.cancel(true);
  };

  return {
    down(pointerId, index, x, y) {
      if (state.phase !== "idle") return;
      state = {
        phase: "pending",
        pointerId,
        index,
        startX: x,
        startY: y,
        lastY: y,
        timer: timers.set(lift, holdMs),
      };
    },
    move(pointerId, x, y) {
      if (state.phase === "idle" || state.pointerId !== pointerId) return;
      if (state.phase === "pending") {
        if (Math.hypot(x - state.startX, y - state.startY) >= slopPx) {
          end(false);
          return;
        }
        state.lastY = y;
        return;
      }
      const offset = y - state.liftY;
      const toIndex = reorderTarget(
        state.midpoints,
        state.index,
        state.midpoints[state.index]! + offset
      );
      state.toIndex = toIndex;
      cb.drag({ fromIndex: state.index, toIndex, offset });
    },
    up(pointerId) {
      if (state.phase === "idle" || state.pointerId !== pointerId) return;
      end(true);
    },
    cancel() {
      end(false);
    },
    scrolled() {
      if (state.phase === "pending") end(false);
    },
    phase: () => state.phase,
  };
}

/**
 * The index a lifted row lands at when its centre is at `draggedCenter`: the
 * number of OTHER rows whose midpoint it has passed. Absolute, so it is the
 * target `moveSegment` takes as-is, and clamped to the list by construction.
 * Dropped where it started, it answers `fromIndex`.
 */
export function reorderTarget(
  midpoints: readonly number[],
  fromIndex: number,
  draggedCenter: number
): number {
  let to = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (i !== fromIndex && midpoints[i]! < draggedCenter) to++;
  }
  return to;
}

/**
 * Which way row `index` slides while the lifted row hovers at `toIndex`:
 * `-1` up one slot, `1` down one slot, `0` stays. The rows between the start
 * and the target make room for it; every other row stays put.
 */
export function reorderShift(
  index: number,
  fromIndex: number,
  toIndex: number
): -1 | 0 | 1 {
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -1;
  if (toIndex < fromIndex && index >= toIndex && index < fromIndex) return 1;
  return 0;
}

/**
 * The auto-scroll for one frame, in px (negative scrolls up): zero unless the
 * finger is within `REORDER_EDGE_PX` of the list's visible top or bottom, and
 * faster the nearer the edge, up to a fixed step at (or past) the edge.
 */
export function autoScrollStep(
  pointerY: number,
  viewTop: number,
  viewBottom: number
): number {
  const fromTop = pointerY - viewTop;
  if (fromTop < REORDER_EDGE_PX) {
    const depth = Math.min(1, (REORDER_EDGE_PX - fromTop) / REORDER_EDGE_PX);
    return -Math.ceil(depth * MAX_SCROLL_STEP_PX);
  }
  const fromBottom = viewBottom - pointerY;
  if (fromBottom < REORDER_EDGE_PX) {
    const depth = Math.min(1, (REORDER_EDGE_PX - fromBottom) / REORDER_EDGE_PX);
    return Math.ceil(depth * MAX_SCROLL_STEP_PX);
  }
  return 0;
}
