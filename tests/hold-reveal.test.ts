import { describe, expect, it } from "vitest";

import {
  createHoldReveal,
  REVEAL_CAP_MS,
  REVEAL_HOLD_MS,
  type HoldRevealTimers,
} from "@/hooks/hold-reveal";
import { REORDER_HOLD_MS, REORDER_SLOP_PX } from "@/lib/view/reorder-gesture";

/**
 * The timing half of hold-to-reveal (S14, #1284): a hand-run clock, so each
 * case says exactly when the name shows and when it goes away. The DOM half
 * (which press is claimed, the bubble, the swallowed click) is pinned through
 * the real Books screen in `tests/hold-reveal-books.test.ts`.
 */

function clock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: HoldRevealTimers = {
    set: (run, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });
      return id;
    },
    clear: (id) => {
      pending.delete(id as number);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...pending.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = until;
  };
  return { timers, advance };
}

function setup() {
  const c = clock();
  const log: string[] = [];
  const g = createHoldReveal(
    { show: () => log.push("show"), hide: () => log.push("hide") },
    { timers: c.timers }
  );
  return { g, log, advance: c.advance };
}

describe("hold-to-reveal timing (S14, #1284)", () => {
  it("shares the reorder's hold, so a held name and a held row feel the same", () => {
    expect(REVEAL_HOLD_MS).toBe(REORDER_HOLD_MS);
    expect(REVEAL_HOLD_MS).toBe(450);
    expect(REVEAL_CAP_MS).toBe(6000);
  });

  it("shows the name at 450 ms exactly, not before", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(449);
    expect(log).toEqual([]);
    expect(g.phase()).toBe("pending");
    advance(1);
    expect(log).toEqual(["show"]);
    expect(g.phase()).toBe("shown");
  });

  it("a release before the hold is a tap: nothing shows and the click is not swallowed", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(300);
    expect(g.up(1)).toBe(false);
    advance(1000);
    expect(log).toEqual([]);
    expect(g.phase()).toBe("idle");
  });

  it("moving the reorder's slop before the hold cancels it (a scroll), one px less does not", () => {
    const a = setup();
    a.g.press(1, 0, 0);
    a.g.move(1, REORDER_SLOP_PX - 1, 0);
    a.advance(450);
    expect(a.log).toEqual(["show"]);

    const b = setup();
    b.g.press(1, 0, 0);
    b.g.move(1, 0, REORDER_SLOP_PX);
    b.advance(450);
    expect(b.log).toEqual([]);
    expect(b.g.phase()).toBe("idle");
  });

  it("ignores another pointer's movement", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    g.move(2, 0, 100);
    advance(450);
    expect(log).toEqual(["show"]);
  });

  it("the release puts the name away and swallows that release's click", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(450);
    expect(g.up(2)).toBe(false);
    expect(g.phase()).toBe("shown");
    expect(g.up(1)).toBe(true);
    expect(log).toEqual(["show", "hide"]);
    expect(g.phase()).toBe("idle");
  });

  it("puts the name away after 6 s while still held, and the release is still swallowed", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(450);
    advance(REVEAL_CAP_MS - 1);
    expect(log).toEqual(["show"]);
    advance(1);
    expect(log).toEqual(["show", "hide"]);
    expect(g.phase()).toBe("spent");
    expect(g.up(1)).toBe(true);
    expect(log).toEqual(["show", "hide"]);
  });

  it("a second touch puts the name away; the first finger's release is still swallowed", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(450);
    g.otherPointer();
    expect(log).toEqual(["show", "hide"]);
    expect(g.up(1)).toBe(true);
  });

  it("a second touch before the hold cancels it, and the press stays a tap", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    g.otherPointer();
    advance(450);
    expect(log).toEqual([]);
    expect(g.up(1)).toBe(false);
  });

  it("Escape puts the name away", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(450);
    g.dismiss();
    expect(log).toEqual(["show", "hide"]);
    expect(g.up(1)).toBe(true);
    advance(REVEAL_CAP_MS);
    expect(log).toEqual(["show", "hide"]);
  });

  it("a cancel (pointercancel, the page hidden) ends everything; nothing is left to swallow", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(450);
    g.cancel();
    expect(log).toEqual(["show", "hide"]);
    expect(g.phase()).toBe("idle");
    expect(g.up(1)).toBe(false);
    advance(REVEAL_CAP_MS);
    expect(log).toEqual(["show", "hide"]);
  });

  it("a scroll before the hold cancels it; after the hold it does not", () => {
    const a = setup();
    a.g.press(1, 0, 0);
    a.g.scrolled();
    a.advance(450);
    expect(a.log).toEqual([]);

    const b = setup();
    b.g.press(1, 0, 0);
    b.advance(450);
    b.g.scrolled();
    expect(b.log).toEqual(["show"]);
  });

  it("ignores a second press while one is in progress", () => {
    const { g, log, advance } = setup();
    g.press(1, 0, 0);
    advance(200);
    g.press(2, 0, 0);
    advance(250);
    expect(log).toEqual(["show"]);
    expect(g.up(2)).toBe(false);
    expect(g.up(1)).toBe(true);
  });
});
