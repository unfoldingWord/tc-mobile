import { describe, expect, it } from "vitest";

import {
  historyWriteDecision,
  outstandingConsume,
  replayDecision,
  type HistoryWrite,
  type OutstandingConsume,
} from "@/lib/nav/history-latch";
import {
  initialTravelGuardState,
  type TravelGuardState,
} from "@/lib/nav/travel-guard";

/**
 * The "consume outstanding" latch (#435): which history writes wait for an
 * app-issued `history.back()` to land, and which are refused outright.
 *
 * These rows pin the pure decision only. That the adapter asks it before every
 * write it makes from a UI command is `tests/nav-history-latch-wiring.test.ts`;
 * the write actually being withheld in a browser is `e2e/back-navigation.spec.ts`
 * cases (n) and (o).
 */

const guard = (
  goBackOutstanding: boolean,
  commitCloseOutstanding: boolean
): TravelGuardState => ({ goBackOutstanding, commitCloseOutstanding });

describe("outstandingConsume — what kind of Back has not landed yet", () => {
  it("nothing outstanding reads none", () => {
    expect(outstandingConsume(false, initialTravelGuardState)).toBe("none");
  });

  it("an outstanding goBack with nothing suppressing its landing reads routed", () => {
    expect(outstandingConsume(false, guard(true, false))).toBe("routed");
  });

  it("an outstanding commit-close settle reads routed if nothing suppresses it", () => {
    // Unreachable in the adapter today (the settle sets `suppressPop` in the
    // same step), and still a row: the guard's state space is two booleans.
    expect(outstandingConsume(false, guard(false, true))).toBe("routed");
  });

  it.each([
    ["nothing tracked", guard(false, false)],
    [
      "a goBack tracked — the refused commit-close settle absorbs its landing",
      guard(true, false),
    ],
    ["the commit-close settle's own back()", guard(false, true)],
    ["both", guard(true, true)],
  ])("suppressPop outranks the guard: %s reads absorbed", (_label, state) => {
    expect(outstandingConsume(true, state)).toBe("absorbed");
  });
});

describe("historyWriteDecision — a write requested by a UI command", () => {
  const writes: readonly HistoryWrite[] = ["enter-screen", "arm-floor"];

  it.each(writes)("%s is written at once when nothing is outstanding", (w) => {
    expect(historyWriteDecision(w, "none")).toBe("write");
  });

  it.each(writes)(
    "%s is deferred behind an absorbed landing — the screen it is for survives it",
    (w) => {
      expect(historyWriteDecision(w, "absorbed")).toBe("defer");
    }
  );

  it("a screen transition is REFUSED behind a routed Back — that Back owns the next screen", () => {
    // The row #435 is about: open a chapter (or the recorder) while a Back's
    // traversal is still pending. Writing now issues a push under the pending
    // traversal; deferring it would replay the transition over whatever screen
    // the Back lands on.
    expect(historyWriteDecision("enter-screen", "routed")).toBe("refuse");
  });

  it("the floor arm is deferred, never refused, behind a routed Back — its overlay is already open", () => {
    expect(historyWriteDecision("arm-floor", "routed")).toBe("defer");
  });
});

describe("replayDecision — a deferred write at a landing", () => {
  it("is written once nothing is outstanding", () => {
    expect(replayDecision("none")).toBe("write");
  });

  it.each<OutstandingConsume>(["absorbed", "routed"])(
    "waits again, never refused, when the landing left a %s Back outstanding",
    (outstanding) => {
      // A deferred screen transition has already run its state half; refusing
      // it here would leave that screen showing with no entry beneath it.
      expect(replayDecision(outstanding)).toBe("defer");
    }
  );
});
