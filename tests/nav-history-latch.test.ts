import { describe, expect, it } from "vitest";

import {
  deferWrite,
  historyWriteDecision,
  outstandingConsume,
  recorderExitTraversal,
  replayDecision,
  replayQueue,
  type DeferredWrite,
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
 *
 * `replayQueue` (#802) is the walk `replayDeferredWrites` runs at a landing,
 * pulled out here because it is the one piece of that walk with no `window` in
 * it — `perform` is an injected function, so a throw can be driven directly
 * rather than through a real `window.history` failure. That the adapter wires
 * this in (restores `pending` before it rethrows, never swallows) is
 * `tests/nav-history-latch-wiring.test.ts`.
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

describe("recorderExitTraversal — the programmatic recorder close's entry (#763)", () => {
  const guards: readonly TravelGuardState[] = [
    guard(false, false),
    guard(true, false),
    guard(false, true),
    guard(true, true),
  ];

  it.each(guards.flatMap((g) => [false, true].map((s) => [s, g] as const)))(
    "an entry still in the queue was never written: unqueue it, whatever is in flight (suppressPop %s, %o)",
    (suppressPop, g) => {
      expect(
        recorderExitTraversal(suppressPop, g, ["arm-floor", "enter-recorder"])
      ).toBe("unqueue");
    }
  );

  it.each(
    guards
      .filter((g) => g.goBackOutstanding || g.commitCloseOutstanding)
      .flatMap((g) => [false, true].map((s) => [s, g] as const))
  )(
    "a tracked Back in flight is already consuming the entry: absorb its landing, issue nothing (suppressPop %s, %o)",
    (suppressPop, g) => {
      expect(recorderExitTraversal(suppressPop, g, [])).toBe("absorb");
      expect(recorderExitTraversal(suppressPop, g, ["enter-segments"])).toBe(
        "absorb"
      );
    }
  );

  it("only a suppressed, untracked Back in flight: it lands on the entry, so the consume waits for it", () => {
    expect(recorderExitTraversal(true, initialTravelGuardState, [])).toBe(
      "defer"
    );
  });

  it("nothing in flight: issue the consume now", () => {
    expect(recorderExitTraversal(false, initialTravelGuardState, [])).toBe(
      "issue"
    );
    // A queued write for ANOTHER screen does not stand in for this entry.
    expect(
      recorderExitTraversal(false, initialTravelGuardState, ["enter-segments"])
    ).toBe("issue");
  });
});

describe("deferWrite — the queue a landing replays", () => {
  it("a repeat of the same screen entry is held once — two taps, one screen, one entry", () => {
    expect(deferWrite(["enter-recorder"], "enter-recorder")).toEqual([
      "enter-recorder",
    ]);
    expect(deferWrite(["enter-segments"], "enter-segments")).toEqual([
      "enter-segments",
    ]);
  });

  it("a different screen keeps its own entry, in request order", () => {
    expect(deferWrite(["enter-segments"], "enter-recorder")).toEqual([
      "enter-segments",
      "enter-recorder",
    ]);
    expect(deferWrite([], "arm-floor")).toEqual(["arm-floor"]);
  });

  it("returns a new array and leaves the queue it was given alone", () => {
    const queue = ["arm-floor"] as const;
    const next = deferWrite(queue, "arm-floor");
    expect(next).not.toBe(queue);
    expect(queue).toEqual(["arm-floor"]);
  });
});

describe("replayQueue — walking a landing's deferred writes (#802)", () => {
  const allThree: readonly DeferredWrite[] = [
    "enter-segments",
    "enter-recorder",
    "arm-floor",
  ];

  it("a clean walk performs every write in order and reports ok", () => {
    const performed: DeferredWrite[] = [];
    const outcome = replayQueue(allThree, (write) => performed.push(write));
    expect(outcome).toEqual({ ok: true });
    expect(performed).toEqual(allThree);
  });

  it("(p) the FIRST key's write throws: the remaining keys come back pending, in order — the walk stops rather than skip ahead", () => {
    const performed: DeferredWrite[] = [];
    const cause = new Error("SecurityError: pushState quota exceeded");
    const outcome = replayQueue(allThree, (write) => {
      performed.push(write);
      if (write === "enter-segments") throw cause;
    });
    // Red against the pre-#802 loop: it called performWrite for every queued
    // write with no try/catch, so the throw on "enter-segments" would have
    // propagated straight out of the whole walk, and the caller never saw an
    // `outcome` — "enter-recorder" and "arm-floor" were never even reached, let
    // alone reported as still pending, and nothing survived to be restored to
    // the ref (`tests/nav-history-latch-wiring.test.ts`'s new gate pins the
    // adapter half; this pins the walk skipping ahead instead of stopping).
    expect(outcome).toEqual({
      ok: false,
      pending: ["enter-recorder", "arm-floor"],
      cause,
    });
    // The walk stopped AT the throw — it did not skip past it and keep going.
    expect(performed).toEqual(["enter-segments"]);
  });

  it("a LATER key's write throws: the keys already performed before it are not requeued, only the ones behind it", () => {
    const outcome = replayQueue(allThree, (write) => {
      if (write === "enter-recorder") throw new Error("history throw");
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.pending).toEqual(["arm-floor"]);
  });

  it("the LAST key's write throws: pending is empty, but ok is still false — the caller must not read an empty pending as a clean walk", () => {
    const outcome = replayQueue(allThree, (write) => {
      if (write === "arm-floor") throw new Error("history throw");
    });
    expect(outcome).toEqual({
      ok: false,
      pending: [],
      cause: expect.any(Error),
    });
  });

  it("the throwing write's OWN key is never in `pending` — requeuing it would retry the same failing call every landing, forever, with nothing to break the cycle", () => {
    const outcome = replayQueue(allThree, (write) => {
      if (write === "enter-recorder") throw new Error("history throw");
    });
    if (!outcome.ok) expect(outcome.pending).not.toContain("enter-recorder");
  });
});
