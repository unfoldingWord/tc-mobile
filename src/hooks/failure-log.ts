import { useEffect, useState } from "react";

import { describeCause } from "@/lib/failure-text";
import {
  appendFailure,
  clearFailures,
  countFailures,
} from "@/lib/storage/failures";
import { subscribeToFailures } from "./report-failure";
import type { StoredFailure } from "@/types/failure";

/**
 * The durable end of the failure funnel (#205), and the seam the UI reads it
 * through.
 *
 * `report-failure.ts` is the funnel; `lib/storage/failures.ts` is the store.
 * This is the part that must know about both, plus the two things neither can
 * own: that a log write must never re-enter the funnel, and that EVERY write
 * has to be serialised.
 *
 * ── Why the writes are serialised ──
 *
 * The store's append-and-prune is one transaction, so concurrency cannot
 * corrupt the ring. What it CAN do is reorder: two failures reported in the same
 * tick open two transactions whose commit order IndexedDB does not promise to
 * match the order they were reported in, and the log's whole read — newest
 * first — is insertion order. A failure cascade (one throw producing three) is
 * exactly when the order matters most. So the writes go through one promise
 * chain, which also bounds how many transactions a cascade opens at once.
 *
 * **A clear is a write, and goes through the same lane** (Frank #1 ≡ George #1,
 * round 1). It used to call the store directly, which put it in its own
 * transaction concurrent with any in-flight append: a clear that overtook a
 * pending append emptied the store and then the append landed, so a log the
 * person had explicitly cleared came back holding a row. Ordering the clear
 * against the appends is the only thing that makes "cleared" mean cleared.
 */

/**
 * The serialising lane. Every append AND every clear waits for the previous
 * operation to settle.
 *
 * The lane itself never rejects — {@link enqueue} keeps it settled — so a failed
 * operation cannot poison the ones behind it.
 */
let lane: Promise<void> = Promise.resolve();

/**
 * Run `op` after everything already queued, and hand its result back to the
 * caller.
 *
 * Two different promises on purpose. The one returned is `op`'s own, so a caller
 * that needs to know whether the write succeeded — the panel's Clear — sees the
 * rejection. The one stored as the lane has both arms flattened to `undefined`,
 * so the NEXT operation runs whatever happened to this one. Collapsing those
 * into a single promise is what would make one failed write stop the log
 * forever.
 */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = lane.then(op);
  lane = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * UI subscribers, notified after a write lands so a screen showing the log (or
 * a count of it) can re-read. Separate from `subscribeToFailures`: that fires
 * when a failure is REPORTED, this fires when one is STORED, and a marker that
 * lit before the row existed would send a facilitator to an empty log.
 */
const watchers = new Set<() => void>();

function notifyWatchers(): void {
  for (const watcher of Array.from(watchers)) {
    try {
      watcher();
    } catch (watcherFailure) {
      // Direct, not through `reportFailure`: a watcher is only ever a React
      // state setter, and routing its throw back into the funnel would append a
      // row, notify the watchers, and arrive here again.
      console.error("[failure-log] a log watcher threw", watcherFailure);
    }
  }
}

/**
 * Install the durable sink. Returns the uninstall.
 *
 * Called once from `src/app/install-failure-listeners.ts` — the entry's first
 * import — so the log is live before the App graph evaluates and catches the
 * failure that looks like the app never started. The uninstall exists for tests;
 * the app never removes it.
 */
export function installFailureLog(): () => void {
  return subscribeToFailures((report) => {
    const { message, stack } = describeCause(report.cause);
    const entry: StoredFailure = {
      at: Date.now(),
      context: report.context,
      message,
      ...(stack === undefined ? {} : { stack }),
      ...(report.componentStack === undefined
        ? {}
        : { componentStack: report.componentStack }),
    };
    // Queued synchronously, inside the subscriber, so two reports in one tick
    // are ordered by the order they arrived here — not by whichever transaction
    // commits first. `writeEntry` swallows its own failure, so there is nothing
    // for this caller to observe and nothing to leave unhandled.
    void enqueue(() => writeEntry(entry));
  });
}

/**
 * One append, with its failure swallowed.
 *
 * This is the one place in the app where swallowing is the correct behaviour and
 * not the defect AGENTS.md bans, so the reason is here rather than left implied:
 * this function IS the destination of the failure channel. Reporting a failed
 * log write through `reportFailure` would append a row describing the failure to
 * append a row — and if the cause is a full disk or a closed connection, that
 * recurses until the tab dies. `console.error` is the honest terminal for
 * exactly this one case: the channel's own failure has no channel.
 */
async function writeEntry(entry: StoredFailure): Promise<void> {
  try {
    await appendFailure(entry);
    notifyWatchers();
  } catch (writeFailure) {
    console.error("[failure-log] could not store a failure", writeFailure);
  }
}

/**
 * Empty the log, ordered against the appends, then tell the watchers.
 *
 * On the shared lane (C1 above), so a clear cannot overtake an append that is
 * still in flight and leave the person with a row they thought they discarded.
 *
 * REJECTS to the caller, and logs on the way past. Both halves matter and
 * neither is redundant (Frank #2 ≡ George #4, round 1): the rejection is how the
 * panel knows not to report the log as discarded, and the `console.error` is the
 * only evidence a maintainer will ever get, since nothing below here — neither
 * `clearFailures` nor `getDb` — logs anything of its own. Without it a clear
 * that failed produced no UI change AND no trace, which is the "errors have a
 * channel" bar failing in the one module that exists to satisfy it.
 */
export function clearFailureLog(): Promise<void> {
  return enqueue(async () => {
    try {
      await clearFailures();
    } catch (clearFailure) {
      console.error("[failure-log] could not clear the log", clearFailure);
      throw clearFailure;
    }
    notifyWatchers();
  });
}

/**
 * How many failures the log holds, kept current as new ones land.
 *
 * This is what the Books screen reads: the marker on the ≡ control is the
 * state-in-place signal that something went wrong, and it needs a number, not
 * the stacks behind it. A read that fails resolves to 0 — a marker that cannot
 * be trusted to appear is better than a screen that reports the log's own read
 * failure to a translator (#172).
 */
export function useFailureCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void countFailures().then(
        (n) => {
          if (live) setCount(n);
        },
        () => {
          // Deliberately quiet. `getDb` failing is already surfaced by the
          // shelf's own Notice with a Try again; a second voice for the same
          // cause, in a place a translator cannot act on, is noise.
        }
      );
    };
    watchers.add(refresh);
    refresh();
    return () => {
      live = false;
      watchers.delete(refresh);
    };
  }, []);

  return count;
}
