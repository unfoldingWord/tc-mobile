import { useCallback, useEffect, useState } from "react";

import { describeCause } from "@/lib/failure-text";
import {
  appendFailure,
  clearFailures,
  countFailures,
  readFailures,
} from "@/lib/storage/failures";
import { subscribeToFailures } from "./report-failure";
import type { StoredFailure } from "@/types/failure";

/**
 * The durable end of the failure funnel (#205), and the seam the UI reads it
 * through.
 *
 * `report-failure.ts` is the funnel; `lib/storage/failures.ts` is the store.
 * This is the part that must know about both, plus the two things neither can
 * own: that a log write must never re-enter the funnel, and that writes have to
 * be serialised.
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
 */

/** The serialising lane. Every append waits for the previous one to settle. */
let lane: Promise<void> = Promise.resolve();

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
    // The lane is advanced synchronously, inside the subscriber, so two reports
    // in one tick are ordered by the order they arrived here — not by whichever
    // transaction commits first.
    //
    // One `.then` arm, not two: `writeEntry` swallows its own failure and can
    // never reject, so the lane can never be in a rejected state and a rejection
    // handler here would be unreachable. That is load-bearing — a lane that
    // COULD reject and had no second arm would poison every later append — so
    // the two facts are stated together rather than one relying on the other.
    lane = lane.then(() => writeEntry(entry));
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

/** Empty the log, then tell the watchers. */
export async function clearFailureLog(): Promise<void> {
  await clearFailures();
  notifyWatchers();
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

/** What {@link useFailureEntries} hands back. */
export interface FailureEntries {
  /** The log, newest first. Empty until the first read lands. */
  readonly entries: readonly StoredFailure[];
  /** The first read (or a re-read) is in flight. */
  readonly loading: boolean;
  /** Empty the log. Rejects like any other write; the caller decides the copy. */
  readonly clear: () => Promise<void>;
}

/**
 * The log itself, read while a panel showing it is open.
 *
 * Mounted only by the panel, so the stacks are in memory only while someone is
 * looking at them — and re-read on every store, because the panel is reachable
 * from the same screen a failure can land on.
 */
export function useFailureEntries(): FailureEntries {
  const [entries, setEntries] = useState<readonly StoredFailure[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void readFailures().then(
        (rows) => {
          if (!live) return;
          setEntries(rows);
          setLoading(false);
        },
        () => {
          if (!live) return;
          // The panel shows "no failures recorded" over a log it could not
          // read. Honest for the one thing the panel is for — carrying the log
          // off the phone — because there is nothing to carry either way, and
          // the alternative is raw exception text on a translator's screen.
          setLoading(false);
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

  const clear = useCallback(() => clearFailureLog(), []);

  return { entries, loading, clear };
}
