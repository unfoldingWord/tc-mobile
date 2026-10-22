import { describe, expect, it, vi } from "vitest";

import {
  REVEAL_HOLD_MS,
  REVEAL_MAX_MS,
  REVEAL_SLOP_PX,
  createHoldReveal,
  isCutOff,
} from "@/lib/view/hold-reveal";
import { REORDER_HOLD_MS, REORDER_SLOP_PX } from "@/lib/view/reorder-gesture";

/** A clock the test owns, so a hold's timing is exact. */
function clock() {
  let now = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  return {
    timers: {
      set: (run: () => void, ms: number) => {
        pending.set(next, { at: now + ms, run });
        return next++;
      },
      clear: (h: unknown) => void pending.delete(h as number),
    },
    advance(ms: number) {
      const to = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= to)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        pending.delete(due[0]);
        due[1].run();
      }
      now = to;
    },
  };
}

function setup() {
  const c = clock();
  const reveal = vi.fn();
  const dismiss = vi.fn();
  const hold = createHoldReveal({ reveal, dismiss }, c.timers);
  return { c, reveal, dismiss, hold };
}

describe("isCutOff", () => {
  it("is true only when the name is wider than its box", () => {
    expect(isCutOff(300, 100)).toBe(true);
    expect(isCutOff(100, 100)).toBe(false);
    expect(isCutOff(0, 0)).toBe(false);
  });
});

describe("the hold-to-read timing (#1284, S14)", () => {
  it("takes the reorder gesture's hold and slop, so one finger means one thing", () => {
    expect(REVEAL_HOLD_MS).toBe(REORDER_HOLD_MS);
    expect(REVEAL_SLOP_PX).toBe(REORDER_SLOP_PX);
  });

  it("shows the name once the hold completes and not a moment before", () => {
    const { c, reveal, hold } = setup();
    hold.press(0, 0);
    c.advance(REVEAL_HOLD_MS - 1);
    expect(reveal).not.toHaveBeenCalled();
    c.advance(1);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("puts the name away on release, and says it had been shown", () => {
    const { c, dismiss, hold } = setup();
    hold.press(0, 0);
    c.advance(REVEAL_HOLD_MS);
    expect(hold.release()).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for a tap released before the hold", () => {
    const { c, reveal, dismiss, hold } = setup();
    hold.press(0, 0);
    c.advance(REVEAL_HOLD_MS - 1);
    expect(hold.release()).toBe(false);
    c.advance(REVEAL_MAX_MS);
    expect(reveal).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("ends the touch when the finger moves past the slop before the hold", () => {
    const { c, reveal, hold } = setup();
    hold.press(0, 0);
    hold.move(0, REVEAL_SLOP_PX + 1);
    c.advance(REVEAL_HOLD_MS);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("keeps the touch alive for a move inside the slop", () => {
    const { c, reveal, hold } = setup();
    hold.press(0, 0);
    hold.move(3, 4);
    c.advance(REVEAL_HOLD_MS);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("puts the name away after the cap when the finger never lifts, once", () => {
    const { c, dismiss, hold } = setup();
    hold.press(0, 0);
    c.advance(REVEAL_HOLD_MS + REVEAL_MAX_MS);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(hold.release()).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("puts a shown name away on cancel, and ignores a second press while one is live", () => {
    const { c, reveal, dismiss, hold } = setup();
    hold.press(0, 0);
    hold.press(50, 50);
    c.advance(REVEAL_HOLD_MS);
    expect(reveal).toHaveBeenCalledTimes(1);
    hold.cancel();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
