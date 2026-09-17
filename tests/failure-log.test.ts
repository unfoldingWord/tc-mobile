import "fake-indexeddb/auto";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { unwrap } from "idb";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFailureLog,
  flushFailureLog,
  installFailureLog,
  readFailureLog,
  useFailureCount,
  useLogGeneration,
} from "@/hooks/failure-log";
import { reportFailure } from "@/hooks/report-failure";
import { getDb } from "@/lib/storage/db";
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

/**
 * What a screen reads on its FIRST paint — one render of the hook, no effects.
 *
 * There is no renderer in this suite, but `renderToStaticMarkup` runs a
 * component body exactly once and resolves `useSyncExternalStore` through its
 * server snapshot. That is precisely the paint at issue whenever the question is
 * "what does Books show the instant it comes back", and it is the only way to
 * read these two hooks here.
 */
function firstPaintCount(): number {
  let seen = 0;
  renderToStaticMarkup(
    createElement(function CountProbe() {
      seen = useFailureCount();
      return null;
    })
  );
  return seen;
}

function firstPaintGeneration(): number {
  let seen = 0;
  renderToStaticMarkup(
    createElement(function GenerationProbe() {
      seen = useLogGeneration();
      return null;
    })
  );
  return seen;
}

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

  it("leaves NO unhandled rejection behind when its transaction aborts", async () => {
    // The recursion this guards (Frank, takeover round 2). `idb` builds the
    // transaction's `done` promise eagerly, when it wraps the transaction — so a
    // transaction that aborts always has a rejected promise in existence. An
    // `appendFailure` that throws from a request, before it reaches `await
    // done`, leaves that rejection unobserved; in a browser that fires
    // `unhandledrejection`, which `install-failure-listeners.ts` routes into
    // `reportFailure`, which lands back HERE — under the same full disk that
    // caused the first one, forever. `writeEntry`'s swallow cannot see it: the
    // rejection escapes around the outside of the call it swallows.
    //
    // Asserted on a GENUINELY aborted transaction rather than a mocked
    // `appendFailure`, because the promise that leaks is one `idb` created, not
    // one this code wrote.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const db = await getDb();
      const raw = unwrap(db);
      const open = raw.transaction.bind(raw);
      vi.spyOn(raw, "transaction").mockImplementation(
        (...args: Parameters<IDBDatabase["transaction"]>) => {
          const tx = open(...args);
          // Abort once the append's request is in flight: the request rejects,
          // `appendFailure` throws out of it, and `tx.done` rejects too.
          queueMicrotask(() => {
            tx.abort();
          });
          return tx;
        }
      );

      await expect(appendFailure(entry())).rejects.toBeDefined();
      // Node reports an unhandled rejection at the end of the turn, so give it
      // one: asserting synchronously would pass with the guard removed.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.restoreAllMocks();
    }
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
   * Wait until the log holds exactly `expected` rows.
   *
   * Waits for the OUTCOME, not for a quiet poll (Frank #3, round 1). The
   * previous version returned as soon as two consecutive reads matched, so an
   * append that had not yet opened its transaction read 0 twice and `settle()`
   * returned while the write was still in flight — the repo's "a test that
   * passes while the code is broken" class, and it would have let the
   * failed-write cases assert an empty log for the wrong reason. Asserting the
   * count we expect means a write that never lands fails here, loudly, instead
   * of passing quietly.
   */
  const settle = async (expected: number) => {
    for (let i = 0; i < 500; i++) {
      if ((await countFailures()) === expected) return;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error(
      `the log never reached ${expected} rows (held ${await countFailures()})`
    );
  };

  /**
   * Wait for a `console.error` line matching `fragment`.
   *
   * The completion signal for a case where NOTHING lands in the store: a failed
   * append is observable only through the terminal it falls back to, so this is
   * what "the write finished failing" looks like. `settle(0)` cannot serve —
   * the log reads 0 before the write starts as well as after it fails.
   */
  const logLine = async (fragment: string) => {
    for (let i = 0; i < 500; i++) {
      if (logged.some((args) => String(args[0]).includes(fragment))) return;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error(`no console.error containing ${fragment}`);
  };

  it("stores a reported failure as text, keeping the context", async () => {
    reportFailure(new RangeError("out of range"), "unhandled-rejection");
    await settle(1);

    const rows = await readFailures();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.context).toBe("unhandled-rejection");
    expect(rows[0]?.message).toBe("RangeError: out of range");
    expect(rows[0]?.stack).toContain("RangeError");
    expect(rows[0]?.at).toBeGreaterThan(0);
  });

  it("keeps a render throw's component tree", async () => {
    reportFailure(new Error("render blew up"), "render", "\n  in Recorder");
    await settle(1);
    expect((await readFailures())[0]?.componentStack).toBe("\n  in Recorder");
  });

  it("omits stack entirely when the cause never had one", async () => {
    // Same hazard as componentStack below: an explicit `stack: undefined`
    // structured-clones as a present-but-undefined field, and
    // `formatFailureLog` then writes the string "undefined" into a
    // maintainer's file where a stack should be.
    reportFailure("a thrown string has no stack", "uncaught-error");
    await settle(1);
    const row = await readFailures().then((r) => r[0]);
    expect(row?.message).toBe("a thrown string has no stack");
    expect(row && "stack" in row).toBe(false);
  });

  it("omits componentStack entirely when the report carried none", async () => {
    // An explicit `componentStack: undefined` would structured-clone as a
    // present-but-undefined field, which `formatFailureLog` then renders as the
    // string "undefined" into a maintainer's file.
    reportFailure(new Error("no tree"), "uncaught-error");
    await settle(1);
    const row = await readFailures().then((r) => r[0]);
    expect(row && "componentStack" in row).toBe(false);
  });

  it("stores every failure of a cascade, none lost to the one before it", async () => {
    reportFailure(new Error("one"), "a");
    reportFailure(new Error("two"), "b");
    reportFailure(new Error("three"), "c");
    await settle(3);

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

    // Real turns, not only microtasks. A landed append now also re-reads the
    // count into the module store before the lane advances (George R2 P2-1),
    // and an IndexedDB read does not settle on the microtask queue. Draining
    // timers gives the second report MORE chance to jump the queue, not less —
    // and a version that drained only microtasks left the second append in
    // flight past `restoreAllMocks`, so it stored a row into the NEXT case.
    const drain = async () => {
      for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    };

    reportFailure(new Error("one"), "a");
    reportFailure(new Error("two"), "b");
    // Give the second report every chance to jump the queue.
    await drain();
    expect(spy).toHaveBeenCalledTimes(1);

    release?.();
    await drain();
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
    // The failed append lands nothing, so the log's own count cannot say it
    // finished — its terminal is what says so.
    await logLine("could not store a failure");
    spy.mockRestore();

    reportFailure(new Error("kept"), "second");
    await settle(1);

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
    // Waiting on the log line, not on a count: an empty log reads 0 before the
    // write starts as well as after it fails, so `settle(0)` would pass on a
    // write that never ran at all.
    await logLine("could not store a failure");

    expect(await countFailures()).toBe(0);
  });

  it("bounds componentStack like the other two fields", async () => {
    // George P3-C, round 2: React's tree does not come from the cause, so
    // `describeCause` never sees it, and it was the one field that could be
    // stored uncut — a deep tree next to a stack that HAD been cut, in the same
    // database the recordings live in.
    reportFailure(new Error("deep"), "render", "x".repeat(5000));
    await settle(1);
    const row = await readFailures().then((r) => r[0]);
    expect(row?.componentStack?.length).toBeLessThan(2100);
    expect(row?.componentStack?.endsWith("…[cut]")).toBe(true);
  });

  it("flushFailureLog resolves only after a queued write has landed", async () => {
    // George P2-B, round 2. The crash screen's Restart awaits this before
    // reloading: on a render throw no effect has run, so the queued write is
    // often the `getDb` open itself, and reloading into it unloads mid-write.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = failuresStore.appendFailure;
    vi.spyOn(failuresStore, "appendFailure").mockImplementationOnce(
      async (entry) => {
        await held;
        await real(entry);
      }
    );

    reportFailure(new Error("mid-flight"), "render");

    let flushed = false;
    const flush = flushFailureLog().then(() => {
      flushed = true;
    });
    for (let i = 0; i < 50; i++) await Promise.resolve();
    // Still held: a flush that resolved here would be no better than not
    // waiting at all.
    expect(flushed).toBe(false);
    expect(await countFailures()).toBe(0);

    release?.();
    await flush;
    expect(flushed).toBe(true);
    // The row is on disk BEFORE the reload the caller does next.
    expect(await countFailures()).toBe(1);
  });

  it("flushFailureLog never rejects, even after a failed write", async () => {
    // The caller is `reload()`, which has no failure arm — a rejecting flush
    // would leave the crash screen's Restart doing nothing at all.
    vi.spyOn(failuresStore, "appendFailure").mockRejectedValueOnce(
      new Error("disk full")
    );
    reportFailure(new Error("boom"), "render");
    await expect(flushFailureLog()).resolves.toBeUndefined();
  });

  it("stops storing once uninstalled", async () => {
    uninstall?.();
    uninstall = null;
    reportFailure(new Error("after"), "gone");
    // Nothing is queued, so there is no landing to wait for. Drain generously
    // and assert the log stayed empty; a write that did start would land inside
    // this window and fail the assertion.
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 1));
    expect(await countFailures()).toBe(0);
  });

  it("clearFailureLog empties what the sink stored", async () => {
    reportFailure(new Error("boom"), "a");
    await settle(1);
    await clearFailureLog();
    expect(await countFailures()).toBe(0);
  });

  it("a clear cannot overtake an append still in flight", async () => {
    // Frank #1 ≡ George #1, round 1. The clear used to call the store directly,
    // in its own transaction concurrent with the lane: a clear issued while an
    // append was in flight emptied the store FIRST and the append landed after
    // it, so a log the person had explicitly discarded came back holding a row.
    //
    // Both operations are now on one lane, so this is deterministic: the append
    // completes, then the clear empties what it wrote.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = failuresStore.appendFailure;
    vi.spyOn(failuresStore, "appendFailure").mockImplementationOnce(
      async (entry) => {
        await held;
        await real(entry);
      }
    );

    reportFailure(new Error("mid-flight"), "a");
    // The clear is issued while the append is still held — the exact overlap.
    const cleared = clearFailureLog();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    release?.();
    await cleared;

    expect(await countFailures()).toBe(0);
  });

  it("a failed clear rejects to the caller AND lands in the durable log", async () => {
    // The panel needs the rejection (so it does not report the log as
    // discarded); a maintainer needs the reason (nothing under
    // `clearFailureLog` says anything of its own). Frank #2 ≡ George #4, round
    // 1 — and the reason goes through the FUNNEL rather than to the console
    // (Frank, takeover round 9): a console line is not a channel on a phone in a
    // village, which is the whole premise of this feature, and this was the last
    // path in it that had only one.
    reportFailure(new Error("boom"), "a");
    await settle(1);

    vi.spyOn(failuresStore, "clearFailures").mockRejectedValueOnce(
      new Error("connection closed")
    );

    await expect(clearFailureLog()).rejects.toThrow("connection closed");
    // The append queued by that report is behind the failed clear on the same
    // lane, so waiting for the log to reach two rows is waiting for it to land.
    await settle(2);
    const rows = await readFailures();
    expect(rows[0]).toMatchObject({
      context: "failure-log-clear",
      message: "Error: connection closed",
    });
    // And the original row is still there — a failed clear loses nothing.
    expect(rows).toHaveLength(2);
  });

  it("a failed clear does not poison the lane", async () => {
    vi.spyOn(failuresStore, "clearFailures").mockRejectedValueOnce(
      new Error("connection closed")
    );
    await expect(clearFailureLog()).rejects.toThrow("connection closed");

    reportFailure(new Error("after a failed clear"), "later");
    await settle(1);
  });
});

/**
 * The count the ≡ marker reads, across the unmount `App` does on every chapter.
 *
 * There is no renderer in this suite, so "first paint" is `renderToStaticMarkup`
 * — which runs the component body once, with no effects, and reads
 * `useSyncExternalStore` through its server snapshot. That is exactly the paint
 * George R2 P2-1 is about: the one Books does the instant it remounts, before
 * any `countFailures()` this hook starts could possibly have landed. A hook that
 * begins each mount at `useState(0)` renders "0" here; a hook reading the module
 * store renders the number that is actually on disk.
 */
describe("the count a remount inherits", () => {
  let uninstall: (() => void) | null = null;

  beforeEach(async () => {
    await clearAllStores();
    // Puts the module store at a known 0 as well as the database, so a case
    // cannot pass on a number an earlier case left behind.
    await clearFailureLog();
    uninstall = installFailureLog();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  /** One mount, one paint, no effects — what Books does coming Back. */
  const firstPaint = () =>
    renderToStaticMarkup(
      createElement(function CountProbe() {
        return createElement("span", null, String(useFailureCount()));
      })
    );

  it("first-paints failures reported while nothing was mounted", async () => {
    // Nothing has rendered yet: this is the chapter visit, with Books gone.
    reportFailure(new Error("during a chapter"), "unhandled-rejection");
    reportFailure(new Error("and another"), "uncaught-error");
    await flushFailureLog();

    // Back to Books. The mark has to be there on the FIRST paint, because a
    // facilitator who taps ≡ in the window before an async read lands gets the
    // menu a quiet phone gets.
    expect(firstPaint()).toBe("<span>2</span>");
  });

  it("carries the count across an unmount and back", async () => {
    reportFailure(new Error("before the chapter"), "unhandled-rejection");
    await flushFailureLog();
    expect(firstPaint()).toBe("<span>1</span>");

    // Unmount (open a chapter), remount (Back). Same number, first paint.
    expect(firstPaint()).toBe("<span>1</span>");
  });

  it("drops to 0 on a clear, with nothing mounted to notice", async () => {
    reportFailure(new Error("to be discarded"), "unhandled-rejection");
    await flushFailureLog();
    await clearFailureLog();

    expect(firstPaint()).toBe("<span>0</span>");
  });
});

/**
 * The log's ordering lane, on the READ side.
 *
 * Round 1 put the clear on the write lane. Round 3 found the same shape twice on
 * the read side (George R3 P2-1, P2-3), which is what turned three fixes into
 * one rule: **everything that touches the log goes through `enqueue`.** These
 * cases pin the rule rather than the two symptoms it was found through.
 */
describe("every read of the log is on the write lane", () => {
  let uninstall: (() => void) | null = null;

  beforeEach(async () => {
    await clearAllStores();
    await clearFailureLog();
    uninstall = installFailureLog();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.restoreAllMocks();
  });

  it("queues a read behind an append that has not landed yet", async () => {
    // The crash screen's shape: a render throw queues its row from
    // `componentDidCatch`, and the facilitator taps Send on that same screen —
    // possibly while a transcode sweep's one-row-per-clip cascade is still
    // draining. An off-lane read hands over a file that does not contain the
    // crash it was sent about, and nothing on the phone can take that back.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realAppend = failuresStore.appendFailure;
    vi.spyOn(failuresStore, "appendFailure").mockImplementationOnce(
      async (pending) => {
        await held;
        await realAppend(pending);
      }
    );

    reportFailure(new Error("the crash itself"), "render");
    const reading = readFailureLog();
    let settled = false;
    void reading.then(() => {
      settled = true;
    });

    // Every chance to jump the queue.
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);

    release?.();
    const rows = await reading;
    expect(rows.map((row) => row.context)).toEqual(["render"]);
  });

  it("a clear cannot be overtaken by a count read that started before it", async () => {
    // The foreground shape: `visibilitychange`/`focus` start a count read, the
    // person then taps bin → confirm Clear, and an off-lane read resolves
    // afterwards with the pre-clear number — leaving the marker lit over an
    // empty store and a panel whose Send has nothing to send.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realCount = failuresStore.countFailures;
    vi.spyOn(failuresStore, "countFailures").mockImplementationOnce(
      async () => {
        await held;
        return realCount();
      }
    );

    reportFailure(new Error("one row"), "unhandled-rejection");
    const clearing = clearFailureLog();
    release?.();
    await clearing;

    // The count read resolved 1 while the clear was already queued behind it.
    // On the lane, the clear is the last word.
    expect(firstPaintCount()).toBe(0);
    expect(await countFailures()).toBe(0);
  });

  /**
   * The wiring, not just the primitive.
   *
   * `readFailureLog` being lane-ordered is worth nothing if a caller goes around
   * it, and nothing else in this repo would notice: knip sees an import that is
   * used, ESLint sees a legal layer, and no runtime test can reach the share
   * hook's `prepare` without a renderer. So the rule is asserted directly — one
   * module owns the store, and everything else asks that module.
   */
  it("nothing in src/ reaches the store except the log module itself", () => {
    const root = new URL("../src/", import.meta.url).pathname;
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((found) => {
        const full = join(dir, found.name);
        if (found.isDirectory()) return walk(full);
        return /\.tsx?$/.test(found.name) ? [full] : [];
      });

    const importers = walk(root)
      .filter((file) =>
        /from "[^"]*storage\/failures"/.test(readFileSync(file, "utf8"))
      )
      .map((file) => file.slice(root.length))
      .sort();

    expect(importers).toEqual(["hooks/failure-log.ts"]);
  });
});

/**
 * The count and the generation answer two different questions, and the ring is
 * the reason one cannot stand in for the other.
 */
describe("the log's generation", () => {
  let uninstall: (() => void) | null = null;

  beforeEach(async () => {
    await clearAllStores();
    await clearFailureLog();
    uninstall = installFailureLog();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("moves on an append the count cannot see, at the ring's limit", async () => {
    // Fill to the cap. From here every append also prunes, so the number the
    // marker shows is frozen at 50 for the rest of this phone's life.
    for (let i = 0; i < FAILURE_LOG_LIMIT; i++) {
      reportFailure(new Error(`filler ${i}`), "unhandled-rejection");
    }
    await flushFailureLog();
    expect(firstPaintCount()).toBe(FAILURE_LOG_LIMIT);
    const armed = firstPaintGeneration();

    reportFailure(new Error("the one the facilitator is sending"), "render");
    await flushFailureLog();

    // The count is unchanged — which is exactly why the panel cannot use it to
    // decide whether an armed File is still a true snapshot of the rows.
    expect(firstPaintCount()).toBe(FAILURE_LOG_LIMIT);
    expect(firstPaintGeneration()).not.toBe(armed);
  });

  it("moves on a clear", async () => {
    reportFailure(new Error("to be discarded"), "unhandled-rejection");
    await flushFailureLog();
    const armed = firstPaintGeneration();

    await clearFailureLog();
    expect(firstPaintGeneration()).not.toBe(armed);
  });

  it("does NOT move on a plain re-read", async () => {
    // A routine foreground count must not throw away an armed share: nothing
    // about the rows changed, so the snapshot in the person's hand is still true.
    reportFailure(new Error("one row"), "unhandled-rejection");
    await flushFailureLog();
    const armed = firstPaintGeneration();

    await readFailureLog();
    await flushFailureLog();

    expect(firstPaintGeneration()).toBe(armed);
  });
});
