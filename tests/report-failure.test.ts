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
 * The module holds process-wide state (the subscriber set, and the last cause
 * seen), so every case installs through the `subscribe` helper below — which
 * undoes the subscription after the case whether it passed or not — and uses
 * its own distinct cause object.
 */
describe("reportFailure", () => {
  let logged: unknown[][];
  /**
   * Every subscription made in a case, undone after it — including a case that
   * fails partway. A leaked subscriber is not a tidiness problem here: the set
   * is process-wide, so the next case would push into a previous case's array
   * and fail for a reason that has nothing to do with what it asserts.
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

  it("delivers to every subscriber, and a second does not displace the first", () => {
    // This was one slot until #205. That shape had a displacement bug (#188
    // round 3, Frank P2): a second subscription REPLACED the first, and the
    // second's unsubscribe then emptied the only slot — so a transient UI
    // subscriber could take the durable log offline and leave nothing behind.
    const first: FailureReport[] = [];
    const second: FailureReport[] = [];
    subscribe((report) => first.push(report));
    subscribe((report) => second.push(report));

    reportFailure(new Error("two sinks"), "render");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // Still one line: subscribers do not multiply the log.
    expect(logged).toHaveLength(1);
  });

  it("keeps the durable subscriber when a transient one unsubscribes", () => {
    // The exact sequence the single slot got wrong, in the order it happens in
    // the app: the durable log installs at the entry, a panel subscribes when it
    // opens, and the panel closes.
    const durable: FailureReport[] = [];
    subscribe((report) => durable.push(report));
    const offTransient = subscribe(() => {});
    offTransient();

    reportFailure(new Error("after the panel closed"), "render");

    expect(durable).toHaveLength(1);
  });

  it("subscribing the same listener twice delivers once", () => {
    const seen: FailureReport[] = [];
    const listener = (report: FailureReport) => seen.push(report);
    subscribe(listener);
    subscribe(listener);

    reportFailure(new Error("once"), "render");

    expect(seen).toHaveLength(1);
  });

  it("one subscription's removal does not cancel another's", () => {
    // Delivery is per LISTENER; lifetime is per SUBSCRIPTION. Collapsing the two
    // is the single slot's displacement bug at one remove: the first caller's
    // unsubscribe emptied the only entry and took the second caller's live
    // subscription with it, silently, leaving the funnel with a subscriber it
    // believed it still had (Frank, takeover round 6).
    const seen: FailureReport[] = [];
    const listener = (report: FailureReport) => seen.push(report);
    const offFirst = subscribe(listener);
    subscribe(listener);

    offFirst();
    reportFailure(new Error("the second subscription is still live"), "render");
    expect(seen).toHaveLength(1);

    // And idempotent: a caller that releases in both a cleanup and an unmount
    // must not spend the other subscription's count doing it.
    offFirst();
    reportFailure(new Error("still live after a repeated removal"), "render");
    expect(seen).toHaveLength(2);
  });

  it("stops delivering once the LAST subscription holding a listener goes", () => {
    const seen: FailureReport[] = [];
    const listener = (report: FailureReport) => seen.push(report);
    const offFirst = subscribe(listener);
    const offSecond = subscribe(listener);

    offFirst();
    offSecond();
    reportFailure(new Error("nobody is listening"), "render");

    expect(seen).toEqual([]);
  });

  it("a throwing subscriber does not cost the others their report", () => {
    // Caught per listener, not around the loop: the durable log must still get
    // the row when a UI subscriber throws, which is the whole reason the funnel
    // can now hold more than one.
    const durable: FailureReport[] = [];
    subscribe(() => {
      throw new Error("subscriber blew up");
    });
    subscribe((report) => durable.push(report));

    reportFailure(new Error("delivered anyway"), "render");

    expect(durable).toHaveLength(1);
    expect(
      logged.some((args) =>
        String(args[0]).includes("a failure subscriber threw")
      )
    ).toBe(true);
  });

  it("a subscriber added DURING a dispatch does not receive that report", () => {
    // The dispatch walks a COPY of the set, and this is the case that needs it.
    // Deleting from a live Set mid-iteration is well-defined and skips nothing,
    // so removal alone would pass either way; ADDING is what a live Set gets
    // wrong — `Set` iteration visits entries inserted after the walk started, so
    // the newcomer would be handed a report from before it existed.
    const seen: string[] = [];
    const late = () => seen.push("late");
    subscribe(() => {
      seen.push("first");
      subscribe(late);
    });

    reportFailure(new Error("mid-walk insert"), "render");
    expect(seen).toEqual(["first"]);

    // And it does get the NEXT one.
    reportFailure(new Error("the next one"), "render");
    expect(seen).toEqual(["first", "first", "late"]);
  });

  it("collapses the same object reported twice under the SAME context", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // One thrown object arriving twice with one context — a StrictMode
    // double-invoke of the boundary, or one throw reaching both feeds under the
    // same key. One failure, one line.
    const cause = new Error("thrown once");
    reportFailure(cause, "render");
    reportFailure(cause, "render");

    expect(logged).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.context).toBe("render");
  });

  it("does NOT collapse the same object under a DIFFERENT context", () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // A shared sentinel Error reused by two unrelated operations, synchronously.
    // Different contexts make them two distinct failures — dropping the second
    // would silently lose one (Frank, round 2).
    const cause = new Error("shared sentinel");
    reportFailure(cause, "save");
    reportFailure(cause, "export");

    expect(logged).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen.map((report) => report.context)).toEqual(["save", "export"]);
  });

  it("reports the same object again in a later tick, collapsing only the synchronous same-context pair", async () => {
    const seen: FailureReport[] = [];
    subscribe((report) => seen.push(report));

    // Same object, same context, same turn is one failure...
    const cause = new Error("recurs");
    reportFailure(cause, "render");
    reportFailure(cause, "render");
    expect(logged).toHaveLength(1);
    expect(seen).toHaveLength(1);

    // ...but the window is one tick, not forever. A genuine LATER failure that
    // reuses the same object under the same context — a retried save rejecting
    // the same sentinel — must still be reported. Let the collapse window's
    // microtask run, then repeat.
    await Promise.resolve();
    reportFailure(cause, "render");
    expect(logged).toHaveLength(2);
    expect(seen).toHaveLength(2);
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
