import { useEffect, useState } from "react";

import { boundText, describeCause } from "@/lib/failure-text";
import {
  appendFailure,
  clearFailures,
  countFailures,
} from "@/lib/storage/failures";
import { reportFailure, subscribeToFailures } from "./report-failure";
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
 * How many times a failed count read is retried before it waits for the app to
 * be brought to the foreground again. Five attempts on the backoff below spans
 * roughly half a minute, which covers a second tab being closed; past that,
 * returning to the app is a better signal than a timer that never stops.
 */
const MAX_COUNT_RETRIES = 5;

/** First retry delay, doubling each attempt. */
const RETRY_BACKOFF_MS = 1_000;

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
      // Bounded like the other two (George P3-C, round 2). React's tree is not
      // part of the cause, so `describeCause` never sees it — it was the one
      // field that could be stored uncut, in the database the recordings live
      // in, next to a stack that had been cut.
      ...(report.componentStack === undefined
        ? {}
        : { componentStack: boundText(report.componentStack) }),
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
 * REJECTS to the caller, and reports on the way past. Both halves matter and
 * neither is redundant (Frank #2 ≡ George #4, round 1): the rejection is how the
 * panel knows not to report the log as discarded, and the report is the only
 * evidence a maintainer will ever get, since nothing below here — neither
 * `clearFailures` nor `getDb` — says anything of its own. Without it a clear
 * that failed produced no UI change AND no trace, which is the "errors have a
 * channel" bar failing in the one module that exists to satisfy it.
 *
 * **Through the funnel, not to the console** (Frank, takeover round 9). Round 1
 * settled for `console.error` here on the argument that a row about a failed
 * clear is noise in the log it failed to clear. That trade reads differently now
 * that the share path reports its own failures: the console is not a channel on
 * a phone in a village — AGENTS.md says so in as many words — and this was the
 * last path in the feature that had only one. The row is not noise, it is the
 * answer to "why is this log still here after I discarded it", and it goes out
 * with the next report.
 *
 * It cannot recurse. The append this queues is behind the failed clear on the
 * same lane, and if it fails too `writeEntry` swallows it: a failure of the log's
 * own write is the one place this module does not report. What would recurse is
 * reporting from inside `writeEntry`, which is exactly what that function's
 * docblock refuses to do.
 */
export function clearFailureLog(): Promise<void> {
  return enqueue(async () => {
    try {
      await clearFailures();
    } catch (clearFailure) {
      reportFailure(clearFailure, "failure-log-clear");
      throw clearFailure;
    }
    notifyWatchers();
  });
}

/**
 * Resolve once everything currently queued on the lane has settled.
 *
 * The crash screen's Restart is a synchronous `location.reload()`, and a
 * render-phase throw reports through this module BEFORE any effect has run — so
 * that write is often the `getDb` open itself, and on a device coming from v5 it
 * carries the v6 upgrade too. Reloading into that unloads the page mid-open, and
 * this repo already treats an iOS `pagehide` as a real race rather than a
 * theoretical one. A render crash is the failure the durable log most exists to
 * keep; losing it to the button offered for recovering from it is the worst
 * possible trade (George, round 2).
 *
 * Awaits the LANE, not a specific write, so it covers whatever a cascade
 * queued. It cannot reject: the lane is kept settled by `enqueue`.
 */
export function flushFailureLog(): Promise<void> {
  return lane;
}

/**
 * How many failures the log holds, kept current as new ones land.
 *
 * This is what the Books screen reads: the marker on the ≡ control is the
 * state-in-place signal that something went wrong, and it needs a number, not
 * the stacks behind it. A read that fails resolves to 0 — a marker that cannot
 * be trusted to appear is better than a screen that reports the log's own read
 * failure to a translator (#172).
 *
 * `recoveryToken` is the caller saying **the user has just tried to fix
 * whatever was broken** — on Books, the shelf's Try again (George R1 P2, this
 * takeover). Bumping it starts the retry ladder over from zero and re-reads at
 * once.
 *
 * Why that is not a nicety. The ladder below spends roughly half a minute and
 * then waits for the app to be backgrounded and brought forward. The copy on
 * `DatabaseBlockedError` tells the user to close the other copy of the app and
 * THEN try again — a sequence that can easily outlast the ladder, and one that
 * ends with the user still looking at the app rather than leaving it. Without
 * this the shelf would repaint, the recordings would come back, and the log
 * would stay invisible with rows on disk: the ≡ mark quiet and `FailureLogPanel`
 * unmounted, because both are gated on this count. That is round 2's
 * "log on disk, marker never appears" defect again, minus the one recovery the
 * screen actually offers.
 *
 * It is a dependency of the whole effect rather than a second effect: a bump
 * should re-arm everything this hook holds — the ladder, the watcher
 * subscription and the foreground listeners — from the state a fresh mount would
 * have. `count` is React state and survives the re-run, so the number on screen
 * does not flash to 0 on the way past.
 */
export function useFailureCount(recoveryToken = 0): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    // One pending retry at a time (George R1 P3-4). `refresh` is reached from
    // three places — the ladder, the watchers after a write, and the foreground
    // listeners — so two of them arriving while a retry is pending used to leave
    // an orphan timer that only the LAST handle's `clearTimeout` could reach.
    // Extra reads rather than a stuck marker, but the cleanup then lied about
    // what it cancelled.
    const armRetry = (delayMs: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(refresh, delayMs);
    };

    const refresh = () => {
      void countFailures().then(
        (n) => {
          if (!live) return;
          attempt = 0;
          setCount(n);
        },
        () => {
          if (!live) return;
          // Quiet, but NOT final (George, round 2). Staying quiet is right —
          // a failed `getDb` is already on the shelf's own Notice with a Try
          // again, and a second voice for the same cause, somewhere a
          // translator cannot act, is noise. Giving up is not: the read fails
          // on a TRANSIENT open (a second tab holding an upgrade,
          // `DatabaseBlockedError`, #221), the shelf's Try again does not
          // re-run this effect, and the count then sat at 0 forever — so a log
          // that was on disk and had survived a reload stayed invisible, and
          // the panel that sends it never mounted, because it is gated on the
          // count.
          attempt += 1;
          if (attempt > MAX_COUNT_RETRIES) return;
          armRetry(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
        }
      );
    };

    // Coming back to the app is the moment the blocking copy is most likely to
    // be gone, and it resets the ladder so a returning user is never stuck with
    // a spent one. It is NOT the only such moment, which is what `recoveryToken`
    // is for: a user who fixes the problem without ever leaving the app is the
    // case the shelf's own Try again covers.
    const onForeground = () => {
      if (document.hidden) return;
      attempt = 0;
      // A pending retry from the spent ladder would otherwise fire on top of
      // this read and spend an attempt the reset just handed back.
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      refresh();
    };

    watchers.add(refresh);
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    refresh();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      watchers.delete(refresh);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [recoveryToken]);

  return count;
}
