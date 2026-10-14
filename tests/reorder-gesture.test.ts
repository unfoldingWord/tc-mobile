import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REORDER_EDGE_PX,
  REORDER_HOLD_MS,
  REORDER_SLOP_PX,
  autoScrollStep,
  createReorderGesture,
  reorderShift,
  reorderTarget,
  type ReorderCallbacks,
  type ReorderSpan,
} from "@/lib/view/reorder-gesture";

/**
 * The press-and-hold reorder gesture's pure half (#953 PR2a): the hold timer,
 * the 8px slop, the target index a pointer position means, and the one drop.
 * `hooks/use-reorder-gesture.ts` feeds it pointer coordinates and measures the
 * rows; nothing here touches a DOM, so it runs in Node on fake timers.
 *
 * The numbers are the design reference's (docs/design/o4-design-system.md §4):
 * hold 450 ms, then drag; moving 8px before the hold ends cancels it; the list
 * auto-scrolls within 64px of an edge.
 */

// Three 90px rows with a 10px gap, named by their content-coordinate
// midpoints.
const MIDS = [45, 145, 245] as const;

/** 90px rows centred on `mids`, as the extents the lift measures. */
const spansAround = (mids: readonly number[]): ReorderSpan[] =>
  mids.map((m) => ({ top: m - 45, bottom: m + 45 }));

/**
 * `reorderTarget` over 90px rows centred on `mids`, asked where the lifted
 * row lands with its CENTRE at `centre`. The cases below were written for the
 * centre rule the targeting used before #338; over rows of one height the
 * edge rule must answer every one of them the same.
 */
const centreTarget = (
  mids: readonly number[],
  fromIndex: number,
  centre: number
): number =>
  reorderTarget(spansAround(mids), fromIndex, centre - mids[fromIndex]!);

function harness(midpoints: readonly number[] | null = MIDS) {
  const calls: string[] = [];
  const cb: ReorderCallbacks = {
    lift: vi.fn((index: number) => {
      calls.push(`lift ${index}`);
      return midpoints && spansAround(midpoints);
    }),
    drag: vi.fn(({ fromIndex, toIndex, offset }) => {
      calls.push(`drag ${fromIndex}->${toIndex} ${offset}`);
    }),
    drop: vi.fn((from: number, to: number) => {
      calls.push(`drop ${from}->${to}`);
    }),
    cancel: vi.fn((lifted: boolean) => {
      calls.push(`cancel ${lifted}`);
    }),
  };
  return { gesture: createReorderGesture(cb), cb, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the design reference's numbers", () => {
  it("holds 450 ms, cancels at 8px, auto-scrolls within 64px", () => {
    expect(REORDER_HOLD_MS).toBe(450);
    expect(REORDER_SLOP_PX).toBe(8);
    expect(REORDER_EDGE_PX).toBe(64);
  });
});

describe("the hold", () => {
  it("lifts at 450 ms and not a millisecond before", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS - 1);
    expect(cb.lift).not.toHaveBeenCalled();
    expect(gesture.phase()).toBe("pending");
    vi.advanceTimersByTime(1);
    expect(cb.lift).toHaveBeenCalledWith(0);
    expect(gesture.phase()).toBe("lifted");
  });

  it("is a plain tap when released before the hold ends: no lift, no write", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(200);
    gesture.up(1);
    vi.advanceTimersByTime(1000);
    expect(cb.lift).not.toHaveBeenCalled();
    expect(cb.drop).not.toHaveBeenCalled();
    expect(cb.cancel).toHaveBeenCalledWith(false);
    expect(gesture.phase()).toBe("idle");
  });

  it("stays idle when the lift is refused (nothing to measure)", () => {
    const { gesture, cb } = harness(null);
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    expect(gesture.phase()).toBe("idle");
    gesture.move(1, 10, 400);
    gesture.up(1);
    expect(cb.drag).not.toHaveBeenCalled();
    expect(cb.drop).not.toHaveBeenCalled();
    // The refusal still ends the gesture where the caller hears it, so the
    // DOM half lets go of its listeners (George round 1 on #1057).
    expect(cb.cancel).toHaveBeenCalledTimes(1);
    expect(cb.cancel).toHaveBeenCalledWith(false);
  });

  it("ends a throwing lift with cancel(false) and lets the throw through", () => {
    const { gesture, cb } = harness();
    const boom = new Error("measure failed");
    vi.mocked(cb.lift).mockImplementation(() => {
      throw boom;
    });
    gesture.down(1, 0, 10, 45);
    expect(() => vi.advanceTimersByTime(REORDER_HOLD_MS)).toThrow(boom);
    expect(cb.cancel).toHaveBeenCalledTimes(1);
    expect(cb.cancel).toHaveBeenCalledWith(false);
    expect(gesture.phase()).toBe("idle");
  });

  it("ignores a second pointer while one gesture is in progress", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    gesture.down(2, 2, 10, 245);
    gesture.move(2, 10, 400);
    gesture.up(2);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    expect(cb.lift).toHaveBeenCalledTimes(1);
    expect(cb.lift).toHaveBeenCalledWith(0);
    expect(gesture.phase()).toBe("lifted");
  });
});

describe("the 8px slop before the hold ends", () => {
  it("cancels at 8px of movement, and the timer can no longer lift", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(100);
    gesture.move(1, 10, 45 + REORDER_SLOP_PX);
    expect(cb.cancel).toHaveBeenCalledWith(false);
    expect(gesture.phase()).toBe("idle");
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    expect(cb.lift).not.toHaveBeenCalled();
  });

  it("lets a cancelled hold's timer lift nothing, not even the next press", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(100);
    gesture.cancel();
    vi.advanceTimersByTime(100);
    gesture.down(2, 1, 10, 145); // at 200 ms
    vi.advanceTimersByTime(250); // the first press's 450 ms passes
    expect(cb.lift).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200); // the second press's 450 ms
    expect(cb.lift).toHaveBeenCalledTimes(1);
    expect(cb.lift).toHaveBeenCalledWith(1);
  });

  it("measures the slop in both axes", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    // 6 and 6: neither axis alone reaches 8, the distance (8.49) does.
    gesture.move(1, 16, 51);
    expect(cb.cancel).toHaveBeenCalledWith(false);
  });

  it("tolerates a finger that wobbles less than 8px", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    gesture.move(1, 13, 50); // 5.83px
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    expect(cb.cancel).not.toHaveBeenCalled();
    expect(cb.lift).toHaveBeenCalledWith(0);
  });

  it("no longer applies once the row is lifted", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    gesture.move(1, 10, 45 + 3 * REORDER_SLOP_PX);
    expect(cb.cancel).not.toHaveBeenCalled();
    expect(gesture.phase()).toBe("lifted");
  });

  it("treats a scroll before the lift as a cancel, and ignores one after", () => {
    const pending = harness();
    pending.gesture.down(1, 0, 10, 45);
    pending.gesture.scrolled();
    expect(pending.cb.cancel).toHaveBeenCalledWith(false);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    expect(pending.cb.lift).not.toHaveBeenCalled();

    const lifted = harness();
    lifted.gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    lifted.gesture.scrolled();
    expect(lifted.cb.cancel).not.toHaveBeenCalled();
    expect(lifted.gesture.phase()).toBe("lifted");
  });
});

describe("the drag and the one write", () => {
  it("writes nothing while dragging, then drops once on release", () => {
    const { gesture, calls } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    gesture.move(1, 10, 150); // centre 150: past row 1's midpoint
    gesture.move(1, 10, 260); // centre 260: past row 2's midpoint
    expect(calls).toEqual(["lift 0", "drag 0->1 105", "drag 0->2 215"]);
    gesture.up(1);
    expect(calls.at(-1)).toBe("drop 0->2");
    expect(calls.filter((c) => c.startsWith("drop"))).toHaveLength(1);
    expect(gesture.phase()).toBe("idle");
  });

  it("measures the offset from where the finger was at the lift, not the press", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    gesture.move(1, 10, 50); // 5px wobble inside the slop
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    gesture.move(1, 10, 60);
    expect(cb.drag).toHaveBeenLastCalledWith({
      fromIndex: 0,
      toIndex: 0,
      offset: 10,
    });
  });

  it("is a no-op when dropped back in place", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 1, 10, 145);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    gesture.move(1, 10, 245); // over row 2
    gesture.move(1, 10, 150); // and back
    gesture.up(1);
    expect(cb.drop).not.toHaveBeenCalled();
    expect(cb.cancel).toHaveBeenCalledWith(true);
  });

  it("cancels on pointercancel with no write, lifted or not", () => {
    const lifted = harness();
    lifted.gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    lifted.gesture.move(1, 10, 260);
    lifted.gesture.cancel();
    lifted.gesture.up(1);
    expect(lifted.cb.drop).not.toHaveBeenCalled();
    expect(lifted.cb.cancel).toHaveBeenCalledWith(true);
    expect(lifted.gesture.phase()).toBe("idle");

    const pending = harness();
    pending.gesture.down(1, 0, 10, 45);
    pending.gesture.cancel();
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    expect(pending.cb.lift).not.toHaveBeenCalled();
    expect(pending.cb.cancel).toHaveBeenCalledWith(false);
  });

  it("ignores moves and releases from another pointer", () => {
    const { gesture, cb } = harness();
    gesture.down(1, 0, 10, 45);
    vi.advanceTimersByTime(REORDER_HOLD_MS);
    gesture.move(2, 10, 400);
    gesture.up(2);
    expect(cb.drag).not.toHaveBeenCalled();
    expect(cb.drop).not.toHaveBeenCalled();
    expect(gesture.phase()).toBe("lifted");
  });

  it("does nothing on a cancel when idle", () => {
    const { gesture, cb } = harness();
    gesture.cancel();
    expect(cb.cancel).not.toHaveBeenCalled();
  });
});

describe("reorderTarget", () => {
  it("counts the other rows whose midpoint the dragged centre has passed", () => {
    // In place: every row above is passed, none below.
    expect(centreTarget(MIDS, 0, 45)).toBe(0);
    expect(centreTarget(MIDS, 1, 145)).toBe(1);
    expect(centreTarget(MIDS, 2, 245)).toBe(2);
    // Down: from 0, past row 1's midpoint and then row 2's.
    expect(centreTarget(MIDS, 0, 144)).toBe(0);
    expect(centreTarget(MIDS, 0, 146)).toBe(1);
    expect(centreTarget(MIDS, 0, 246)).toBe(2);
    // Up: from 2, above row 1's midpoint and then row 0's.
    expect(centreTarget(MIDS, 2, 146)).toBe(2);
    expect(centreTarget(MIDS, 2, 144)).toBe(1);
    expect(centreTarget(MIDS, 2, 44)).toBe(0);
  });

  it("stays inside the list however far the finger goes", () => {
    expect(centreTarget(MIDS, 1, -10_000)).toBe(0);
    expect(centreTarget(MIDS, 1, 10_000)).toBe(2);
  });

  it("is an absolute index: the same pointer position gives the same target", () => {
    // `moveSegment` takes an absolute target (idempotent); a relative step
    // would move a second time on a repeat.
    expect(centreTarget(MIDS, 0, 246)).toBe(centreTarget(MIDS, 0, 246));
    expect(centreTarget([45, 145, 245, 345], 3, 150)).toBe(2);
  });
});

describe("reorderTarget over rows of different heights (#338)", () => {
  // A short row, a tall one (an open book), a short one: a 72px gap under the
  // first, 12px under the second.
  const SHELF: readonly ReorderSpan[] = [
    { top: 0, bottom: 120 },
    { top: 192, bottom: 2592 },
    { top: 2604, bottom: 2724 },
  ];

  it("takes a tall row up past a short one once its top reaches that row's top", () => {
    expect(reorderTarget(SHELF, 1, -191)).toBe(1);
    expect(reorderTarget(SHELF, 1, -192)).toBe(0);
  });

  it("takes a tall row down past a short one once its bottom passes that row's bottom", () => {
    expect(reorderTarget(SHELF, 1, 131)).toBe(1);
    expect(reorderTarget(SHELF, 1, 132)).toBe(1);
    expect(reorderTarget(SHELF, 1, 133)).toBe(2);
  });

  it("does not take a short row past a tall one before its leading edge is past it", () => {
    // Down from the top: not until its bottom passes the tall row's bottom.
    expect(reorderTarget(SHELF, 0, 200)).toBe(0);
    expect(reorderTarget(SHELF, 0, 2472)).toBe(0);
    expect(reorderTarget(SHELF, 0, 2473)).toBe(1);
    // Up from the bottom: not until its top reaches the tall row's top.
    expect(reorderTarget(SHELF, 2, -200)).toBe(2);
    expect(reorderTarget(SHELF, 2, -2411)).toBe(2);
    expect(reorderTarget(SHELF, 2, -2412)).toBe(1);
    expect(reorderTarget(SHELF, 2, -2604)).toBe(0);
  });

  it("answers the centre rule exactly wherever the rows share one height", () => {
    // The targeting before #338, as an oracle: the other rows whose midpoint
    // the lifted row's centre has passed. Uneven gaps on purpose — only the
    // HEIGHTS have to match for the two rules to agree.
    const centreRule = (
      rows: readonly ReorderSpan[],
      from: number,
      offset: number
    ) => {
      const mid = (r: ReorderSpan) => (r.top + r.bottom) / 2;
      const centre = mid(rows[from]!) + offset;
      return rows.filter((r, i) => i !== from && mid(r) < centre).length;
    };
    const rows: ReorderSpan[] = [0, 70, 200, 260, 410].map((top) => ({
      top,
      bottom: top + 56,
    }));
    let compared = 0;
    for (let from = 0; from < rows.length; from++) {
      for (let offset = -500; offset <= 500; offset++) {
        expect(reorderTarget(rows, from, offset)).toBe(
          centreRule(rows, from, offset)
        );
        compared++;
      }
    }
    expect(compared).toBe(5 * 1001);
  });
});

describe("reorderShift", () => {
  it("slides the rows between the start and the target one slot toward the gap", () => {
    // 0 moving to 2: rows 1 and 2 slide up.
    expect([0, 1, 2, 3].map((i) => reorderShift(i, 0, 2))).toEqual([
      0, -1, -1, 0,
    ]);
    // 3 moving to 1: rows 1 and 2 slide down.
    expect([0, 1, 2, 3].map((i) => reorderShift(i, 3, 1))).toEqual([
      0, 1, 1, 0,
    ]);
    // In place: nothing moves.
    expect([0, 1, 2].map((i) => reorderShift(i, 1, 1))).toEqual([0, 0, 0]);
  });
});

describe("autoScrollStep", () => {
  it("scrolls toward an edge the finger is within 64px of, faster nearer it", () => {
    const top = 100;
    const bottom = 700;
    expect(autoScrollStep(400, top, bottom)).toBe(0);
    expect(autoScrollStep(top + REORDER_EDGE_PX, top, bottom)).toBe(0);
    expect(autoScrollStep(bottom - REORDER_EDGE_PX, top, bottom)).toBe(0);
    const nearTop = autoScrollStep(top + 10, top, bottom);
    const edgeTop = autoScrollStep(top, top, bottom);
    expect(nearTop).toBeLessThan(0);
    expect(edgeTop).toBeLessThan(nearTop);
    const nearBottom = autoScrollStep(bottom - 10, top, bottom);
    expect(nearBottom).toBeGreaterThan(0);
    expect(autoScrollStep(bottom + 50, top, bottom)).toBeGreaterThanOrEqual(
      nearBottom
    );
  });
});
