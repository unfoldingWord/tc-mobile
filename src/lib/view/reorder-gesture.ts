/**
 * Press-and-hold reorder, the pure half (#953): shared by the Segments list
 * and the Books screen's chapter lists.
 *
 * The design reference's gesture (docs/design/o4-design-system.md §4 and §7):
 * press and hold a row for 450 ms, then drag it; moving 8px before the hold
 * ends cancels it; the list auto-scrolls within 64px of an edge. D11 makes it
 * drag only for the training.
 *
 * Everything here is arithmetic over numbers the caller hands in, so it runs
 * in plain Node: the hold timer, the slop, which index a pointer position
 * means, and the rule that a gesture ends in at most ONE drop. The caller
 * (`hooks/use-reorder-gesture.ts`) owns the DOM: it listens for the pointer,
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

/**
 * One row's vertical extent, in content coordinates: its top edge and its
 * bottom edge, measured at the lift.
 */
export interface ReorderSpan {
  readonly top: number;
  readonly bottom: number;
}

interface ReorderDragUpdate {
  readonly fromIndex: number;
  readonly toIndex: number;
  /** How far the finger has moved since the lift, in px (down is positive). */
  readonly offset: number;
}

export interface ReorderCallbacks {
  /**
   * The hold completed on row `index`. Returns every row's extent in
   * content coordinates, measured now, or `null` to refuse the lift (nothing
   * to measure); a refused or throwing lift ends the gesture with
   * `cancel(false)` (nothing was lifted, so nothing is put back).
   */
  lift(index: number): readonly ReorderSpan[] | null;
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
      readonly rows: readonly ReorderSpan[];
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
    // A refusal or a throw still ends the gesture through `cancel(false)`, so
    // the caller lets go of what it holds for the press (George round 1 on
    // #1057: a silent refusal left the DOM half's listeners attached).
    let rows: readonly ReorderSpan[] | null;
    try {
      rows = cb.lift(index);
    } catch (cause) {
      cb.cancel(false);
      throw cause;
    }
    if (!rows || index >= rows.length) {
      cb.cancel(false);
      return;
    }
    state = {
      phase: "lifted",
      pointerId,
      index,
      liftY: lastY,
      rows,
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
      const toIndex = reorderTarget(state.rows, state.index, offset);
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
 * The index a lifted row lands at once it has moved `offset` px from its own
 * slot (down is positive): the number of OTHER rows that still sit before it.
 *
 * Judged by the lifted row's LEADING edge against the same edge of each row
 * it moves over. Going up, it passes a row once its top reaches that row's
 * top; going down, once its bottom passes that row's bottom. Either way that
 * is the moment the slot it would land in begins where its leading edge now
 * is, so the target never runs ahead of the row under the finger, and every
 * slot is reachable whatever the heights: a tall row reaches the slot above a
 * short one by moving that short row's pitch, not half its own height (#338:
 * an open book is one card with its chapters inside it).
 *
 * Where the rows are all one height this is the earlier centre rule exactly:
 * tops, bottoms and midpoints are then the same distances apart, so a row
 * passed by its edge is a row passed by its centre, and the chapter and
 * segment lists move as they did.
 *
 * Absolute, so it is the target `moveSegment`, `moveChapter` and `moveBook`
 * take as-is, and clamped to the list by construction. Dropped where it
 * started, it answers `fromIndex`.
 */
export function reorderTarget(
  rows: readonly ReorderSpan[],
  fromIndex: number,
  offset: number
): number {
  const own = rows[fromIndex]!;
  const top = own.top + offset;
  const bottom = own.bottom + offset;
  let to = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i < fromIndex ? row.top < top : i > fromIndex && row.bottom < bottom) {
      to++;
    }
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
