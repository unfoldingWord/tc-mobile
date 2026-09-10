import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearFailureLog, installFailureLog } from "@/hooks/failure-log";
import { reportFailure } from "@/hooks/report-failure";
import * as failuresStore from "@/lib/storage/failures";
import {
  appendFailure,
  clearFailures,
  countFailures,
  readFailures,
} from "@/lib/storage/failures";
import { FAILURE_LOG_LIMIT, type StoredFailure } from "@/types/failure";
import { clearAllStores } from "./support";

/**
 * The durable failure log (#205) — the store, and the sink that feeds it.
 *
 * Not covered here, and not claimed: the panel and the marker. There is no
 * renderer in this suite (`vitest.config.ts` sets `environment: "node"`, and
 * this repo has declined jsdom before), so `FailureLogPanel`, the `≡` marker on
 * Books, and the share handoff are verified in a browser and recorded on the PR.
 * What IS covered is everything they read: the ring, the order, the sink's
 * ordering guarantee, and the sink's refusal to re-enter the funnel.
 */

const entry = (over: Partial<StoredFailure> = {}): StoredFailure => ({
  at: 1_000,
  context: "test",
  message: "Error: boom",
  ...over,
});

describe("the failure store", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it("reads back an appended entry whole", async () => {
    await appendFailure(entry({ stack: "at x", componentStack: "\n  in App" }));
    expect(await readFailures()).toEqual([
      {
        at: 1_000,
        context: "test",
        message: "Error: boom",
        stack: "at x",
        componentStack: "\n  in App",
      },
    ]);
  });

  it("reads newest first", async () => {
    await appendFailure(entry({ message: "first" }));
    await appendFailure(entry({ message: "second" }));
    await appendFailure(entry({ message: "third" }));
    expect((await readFailures()).map((e) => e.message)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("orders by insertion, NOT by the timestamp on the row", async () => {
    // A phone that has been off for a week does not have a monotonic clock, and
    // the store is deliberately keyed by insertion order rather than by `at`.
    // Appending a row stamped in the past must not sort itself to the back.
    await appendFailure(entry({ at: 9_000, message: "recorded first" }));
    await appendFailure(entry({ at: 1, message: "recorded second" }));
    expect((await readFailures()).map((e) => e.message)).toEqual([
      "recorded second",
      "recorded first",
    ]);
  });

  it("keeps the log at its limit, dropping the oldest", async () => {
    for (let i = 0; i < FAILURE_LOG_LIMIT + 5; i++) {
      await appendFailure(entry({ message: `f${i}` }));
    }
    const rows = await readFailures();
    expect(rows).toHaveLength(FAILURE_LOG_LIMIT);
    // Newest kept, oldest five gone.
    expect(rows[0]?.message).toBe(`f${FAILURE_LOG_LIMIT + 4}`);
    expect(rows[rows.length - 1]?.message).toBe("f5");
    expect(rows.some((e) => e.message === "f4")).toBe(false);
  });

  it("does not prune while the log is under its limit", async () => {
    // The other half of the gate: a prune that ran unconditionally would eat
    // the log one row at a time and every assertion above would still pass.
    for (let i = 0; i < FAILURE_LOG_LIMIT; i++) {
      await appendFailure(entry({ message: `f${i}` }));
    }
    expect(await countFailures()).toBe(FAILURE_LOG_LIMIT);
    expect((await readFailures())[FAILURE_LOG_LIMIT - 1]?.message).toBe("f0");
  });

  it("converges a log left over-long by an older build", async () => {
    // The prune is a loop, not a single delete, so a log written when the limit
    // was higher (or by a build with no prune at all) comes back into range on
    // the next append rather than staying over forever.
    const db = await (await import("@/lib/storage/db")).getDb();
    const tx = db.transaction("failures", "readwrite");
    for (let i = 0; i < FAILURE_LOG_LIMIT + 10; i++) {
      await tx.objectStore("failures").add(entry({ message: `old${i}` }));
    }
    await tx.done;

    await appendFailure(entry({ message: "new" }));
    expect(await countFailures()).toBe(FAILURE_LOG_LIMIT);
    expect((await readFailures())[0]?.message).toBe("new");
  });

  it("counts without reading the rows", async () => {
    expect(await countFailures()).toBe(0);
    await appendFailure(entry());
    await appendFailure(entry());
    expect(await countFailures()).toBe(2);
  });

  it("empties the log, and clearing an empty log is a no-op", async () => {
    await appendFailure(entry());
    await clearFailures();
    expect(await readFailures()).toEqual([]);
    await clearFailures();
    expect(await countFailures()).toBe(0);
  });

  it("appends a repeated failure twice rather than de-duplicating it", async () => {
    // Deliberate, and documented in the module: a save that failed ten times is
    // a different fact from one that failed once, and that count is the signal
    // the log exists to carry.
    await appendFailure(entry({ message: "same" }));
    await appendFailure(entry({ message: "same" }));
    expect(await countFailures()).toBe(2);
  });
});

describe("the durable sink", () => {
  let uninstall: (() => void) | null = null;
  let logged: unknown[][];

  beforeEach(async () => {
    await clearAllStores();
    logged = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    uninstall = installFailureLog();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.restoreAllMocks();
  });

  /**
   * Let the sink's write lane drain.
   *
   * Polls the store until the count stops moving rather than yielding a fixed
   * number of ticks: each append is a real IndexedDB transaction, so how many
   * turns of the loop a serialised run of them needs is not a number a test
   * should be guessing. A fixed-tick version of this was flaky under exactly
   * the case it was written for (three reports in one tick).
   */
  const settle = async () => {
    let previous = -1;
    for (let i = 0; i < 200; i++) {
      const now = await countFailures();
      if (now === previous) return;
      previous = now;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error("the failure-log write lane never drained");
  };

  it("stores a reported failure as text, keeping the context", async () => {
    reportFailure(new RangeError("out of range"), "unhandled-rejection");
    await settle();

    const rows = await readFailures();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.context).toBe("unhandled-rejection");
    expect(rows[0]?.message).toBe("RangeError: out of range");
    expect(rows[0]?.stack).toContain("RangeError");
    expect(rows[0]?.at).toBeGreaterThan(0);
  });

  it("keeps a render throw's component tree", async () => {
    reportFailure(new Error("render blew up"), "render", "\n  in Recorder");
    await settle();
    expect((await readFailures())[0]?.componentStack).toBe("\n  in Recorder");
  });

  it("omits stack entirely when the cause never had one", async () => {
    // Same hazard as componentStack below: an explicit `stack: undefined`
    // structured-clones as a present-but-undefined field, and
    // `formatFailureLog` then writes the string "undefined" into a
    // maintainer's file where a stack should be.
    reportFailure("a thrown string has no stack", "uncaught-error");
    await settle();
    const row = await readFailures().then((r) => r[0]);
    expect(row?.message).toBe("a thrown string has no stack");
    expect(row && "stack" in row).toBe(false);
  });

  it("omits componentStack entirely when the report carried none", async () => {
    // An explicit `componentStack: undefined` would structured-clone as a
    // present-but-undefined field, which `formatFailureLog` then renders as the
    // string "undefined" into a maintainer's file.
    reportFailure(new Error("no tree"), "uncaught-error");
    await settle();
    const row = await readFailures().then((r) => r[0]);
    expect(row && "componentStack" in row).toBe(false);
  });

  it("stores every failure of a cascade, none lost to the one before it", async () => {
    reportFailure(new Error("one"), "a");
    reportFailure(new Error("two"), "b");
    reportFailure(new Error("three"), "c");
    await settle();

    expect((await readFailures()).map((e) => e.context).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("serialises the writes: the next append does not start until the last settles", async () => {
    // WHY this is asserted on the CALLS and not on the stored order: the reason
    // the lane exists is that IndexedDB does not promise two transactions
    // opened in one tick commit in the order they were opened, and the log's
    // whole read is insertion order. `fake-indexeddb` happens to commit them in
    // order, so an assertion about the stored order would pass with the lane
    // removed — a test that can never fail. What IS observable in Node is the
    // property the lane actually provides: one append in flight at a time.
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(failuresStore, "appendFailure")
      .mockImplementationOnce(() => first)
      .mockImplementation(() => Promise.resolve());

    reportFailure(new Error("one"), "a");
    reportFailure(new Error("two"), "b");
    // Give the second report every chance to jump the queue.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);

    release?.();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]?.context).toBe("b");
  });

  it("keeps writing after a write that failed", async () => {
    // A failed append must not poison the lane: the chain's rejection handler
    // is what keeps the next failure storable.
    const spy = vi
      .spyOn(failuresStore, "appendFailure")
      .mockRejectedValueOnce(new Error("disk full"));

    reportFailure(new Error("lost"), "first");
    await settle();
    spy.mockRestore();

    reportFailure(new Error("kept"), "second");
    await settle();

    expect((await readFailures()).map((e) => e.context)).toEqual(["second"]);
  });

  it("swallows a failed log write instead of reporting it back into the funnel", async () => {
    // The one place swallowing is correct: this function IS the destination of
    // the failure channel. Reporting a failed append through `reportFailure`
    // would append a row describing the failure to append a row, and on a full
    // disk that recurses until the tab dies.
    vi.spyOn(failuresStore, "appendFailure").mockRejectedValue(
      new Error("disk full")
    );

    reportFailure(new Error("boom"), "quota");
    await settle();

    expect(await countFailures()).toBe(0);
    expect(
      logged.some((args) =>
        String(args[0]).includes("could not store a failure")
      )
    ).toBe(true);
  });

  it("stops storing once uninstalled", async () => {
    uninstall?.();
    uninstall = null;
    reportFailure(new Error("after"), "gone");
    await settle();
    expect(await countFailures()).toBe(0);
  });

  it("clearFailureLog empties what the sink stored", async () => {
    reportFailure(new Error("boom"), "a");
    await settle();
    await clearFailureLog();
    expect(await countFailures()).toBe(0);
  });
});
