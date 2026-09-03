import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reportFailure,
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";

/**
 * The failure sink, and only the sink.
 *
 * What is NOT covered here: the boundary that feeds it. `ErrorBoundary` renders
 * and `componentDidCatch` fires only in a browser, and this repo has no
 * renderer at all (`vitest.config.ts` sets `environment: "node"`, and there is
 * no jsdom or testing-library in `package.json`). Adding one for a single
 * component is a dependency this project has declined before, so the boundary's
 * render and the two `window` listeners in `src/app/main.tsx` are verified by
 * hand in a browser and recorded on the PR — not here, and not claimed here.
 *
 * The module holds process-wide state (the one sink slot, and the last cause
 * seen), so every case installs through the `subscribe` helper below — which
 * undoes the subscription after the case whether it passed or not — and uses
 * its own distinct cause object.
 */
describe("reportFailure", () => {
  let logged: unknown[][];
  /**
   * Every subscription made in a case, undone after it — including a case that
   * fails partway. A leaked sink is not a tidiness problem here: the next case
   * would find the slot occupied, take the "second sink replaced" log, and fail
   * for a reason that has nothing to do with what it asserts.
   */
  let installed: (() => void)[];

  const subscribe = (
    listener: (report: FailureReport) => void
  ): (() => void) => {
    const off = subscribeToFailures(listener);
    installed.push(off);
    return off;
  };

  beforeEach(() => {
    logged = [];
    installed = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });

  afterEach(() => {
    for (const off of installed) off();
    vi.restoreAllMocks();
  });

  it("logs once and hands the cause and context to the subscriber", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    const cause = new Error("write failed");
    reportFailure(cause, "render");

    expect(logged).toHaveLength(1);
    expect(seen).toEqual([{ context: "render", cause }]);
  });

  it("carries a component stack when one is given, and only then", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // The boundary's third argument (#167 review). It has to reach the log as
    // its own argument — the cause must stay the second one — and the report
    // must not grow an empty field when there is no tree to carry.
    const withTree = new Error("threw in render");
    const componentStack = "\n    in Recorder\n    in App";
    reportFailure(withTree, "render", componentStack);
    reportFailure(new Error("nothing caught this"), "unhandled-rejection");

    expect(logged[0]).toEqual(["[render]", withTree, componentStack]);
    expect(logged[1]).toHaveLength(2);
    expect(seen[0]?.componentStack).toBe(componentStack);
    expect(seen[1]).not.toHaveProperty("componentStack");
  });

  it("stops delivering after the subscription is dropped", () => {
    const seen: FailureReport[] = [];
    const off = subscribe((report) => seen.push(report));
    off();

    reportFailure(new Error("after unsubscribe"), "render");

    // Still logged — the log is the channel that never depends on a subscriber.
    expect(logged).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it("keeps one sink, says so, and lets the replaced unsubscribe be harmless", () => {
    const first: FailureReport[] = [];
    const second: FailureReport[] = [];
    const offFirst = subscribe((report) => first.push(report));
    subscribe((report) => second.push(report));

    // The replacement is reported, not silent.
    expect(logged).toHaveLength(1);

    // The displaced subscriber's unsubscribe must not clear the live slot.
    offFirst();
    reportFailure(new Error("two sinks"), "render");

    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
  });

  it("collapses the same cause object reported twice", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // Two feeds reach one sink — the boundary and the `window` listeners — so
    // the same thrown object can arrive twice. One failure, one line.
    const cause = new Error("thrown once");
    reportFailure(cause, "render");
    reportFailure(cause, "uncaught-error");

    expect(logged).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.context).toBe("render");
  });

  it("does not collapse two failures that merely look alike", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // Distinct objects with the same message are distinct failures...
    reportFailure(new Error("same words"), "render");
    reportFailure(new Error("same words"), "render");
    // ...and a primitive cause carries no identity at all, so two of them are
    // two failures rather than one repeated.
    reportFailure("string cause", "unhandled-rejection");
    reportFailure("string cause", "unhandled-rejection");

    expect(logged).toHaveLength(4);
    expect(seen).toHaveLength(4);
  });

  it("survives a cause that is not an Error", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // A rejected promise can carry anything, including nothing.
    expect(() => reportFailure(undefined, "unhandled-rejection")).not.toThrow();
    expect(() => reportFailure(null, "unhandled-rejection")).not.toThrow();
    expect(() => reportFailure(0, "unhandled-rejection")).not.toThrow();
    expect(() =>
      reportFailure({ reason: "no room" }, "unhandled-rejection")
    ).not.toThrow();

    expect(logged).toHaveLength(4);
    expect(seen.map((report) => report.cause)).toEqual([
      undefined,
      null,
      0,
      { reason: "no room" },
    ]);
  });

  it("does not let a throwing sink become a second failure", () => {
    subscribe(() => {
      throw new Error("the sink itself failed");
    });

    expect(() => reportFailure(new Error("original"), "render")).not.toThrow();
    // The original failure, then the sink's own — both visible, neither thrown.
    expect(logged).toHaveLength(2);
  });
});
