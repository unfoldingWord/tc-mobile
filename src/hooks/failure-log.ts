import { useEffect, useSyncExternalStore } from "react";

import { boundText, describeCause } from "@/lib/failure-text";
import {
  appendFailure,
  clearFailures,
  countFailures,
  readFailures,
} from "@/lib/storage/failures";
import { reportFailure, subscribeToFailures } from "./report-failure";
import { FAILURE_LOG_LIMIT, type StoredFailure } from "@/types/failure";

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
 * ── The log's state, and the one rule that keeps it honest ──
 *
 * Two numbers, updated together, at module scope so they outlive the screen
 * that reads them.
 *
 * **`count`** is how many rows the log holds. It is the Books marker's whole
 * input. It lives here rather than in `useState` because `App` unmounts
 * `BooksScreen` for the length of a chapter visit (George R2 P2-1): a hook that
 * began each mount at 0 would blink the one state-in-place signal this feature
 * has out of existence exactly when a facilitator went to check whether the
 * recording survived and came Back, and a tap in that window opens the menu a
 * quiet phone gets. The screen's other two standing markers already treat that
 * remount as load-bearing — `useStoragePersistence` caches its settled answer
 * at module scope, encoder health is a `useSyncExternalStore`. This is the
 * third. A cold first launch still starts at 0, which is inherent; a remount
 * must not.
 *
 * **`generation`** is which VERSION of the log those rows are. It moves on
 * every landed write, including the ones that leave `count` alone. That is not
 * a hypothetical: the ring prunes at FAILURE_LOG_LIMIT, so at the cap
 * every further append deletes the oldest row and the count stays put. A panel
 * that watched the count would hold an armed snapshot that is missing the newest
 * row and still contains the pruned one, and the Notice beside it would agree
 * with neither — the same "screen and file disagree, and a maintainer cannot
 * tell from the file" mismatch the armed-snapshot drop exists to close, at the
 * exact bound this store is built around (George R3 P2-2).
 *
 * **The rule: everything that touches the log goes through {@link enqueue}.**
 * Not only the writes. Round 1 put the clear on the write lane because a clear
 * that overtook an append un-cleared itself. Round 3 found the same shape on the
 * read side twice over — a count read racing a clear lands the pre-clear number
 * and lights the marker over an empty store, and the crash screen's Send read
 * the rows while the crash's own row was still queued behind a transcode sweep,
 * so tap 1 could send a file that does not contain the crash it was sent about
 * (George R3 P2-1, P2-3). One lane for every read and every write is one rule
 * instead of three guards, and it is the only version of this that a later
 * reader can apply without being told the list.
 *
 * The one exception is marked where it lives: code already running INSIDE a lane
 * op calls the store helpers directly, because re-entering `enqueue` there would
 * wait on a lane that is waiting on it.
 */
let logCount = 0;
let logGeneration = 0;

/**
 * Subscribers to the two numbers above, in the `useSyncExternalStore` shape.
 *
 * Fires when a row is STORED or cleared, not when a failure is REPORTED: those
 * are different moments, and a marker that lit before the row existed would send
 * a facilitator to an empty log.
 */
const logWatchers = new Set<() => void>();

/** Subscribe to the log's state. The store half of `useSyncExternalStore`. */
function subscribeToLog(onChange: () => void): () => void {
  logWatchers.add(onChange);
  return () => {
    logWatchers.delete(onChange);
  };
}

/**
 * The snapshot halves. Each returns a cached primitive, never a fresh read:
 * React may call these many times per render and they must be stable and
 * synchronous. Primitives rather than an object for the same reason — an object
 * rebuilt per call would re-render on every notification forever.
 */
function getFailureCount(): number {
  return logCount;
}

/**
 * Also exported, and not only as the `useSyncExternalStore` snapshot: a TAP
 * HANDLER has to be able to ask what the generation is **now** (Frank R8 P2).
 *
 * The number a component captured at render is the one thing that is provably
 * stale in the window that matters — a write lands, the store notifies, React
 * commits, and the passive effect that acts on it has not run yet. A handler
 * reading the render's value in that window reads the version from before the
 * write and concludes nothing changed. Reading it straight from the module is
 * the only answer that cannot be a render behind.
 *
 * `useLogGeneration` remains the way a component RENDERS the generation; this
 * is the way an event handler DECIDES on it. Both are pinned to one consumer by
 * the wiring gate in `tests/failure-log.test.ts`.
 */
export function getLogGeneration(): number {
  return logGeneration;
}

function notifyLog(): void {
  for (const watcher of Array.from(logWatchers)) {
    try {
      watcher();
    } catch (watcherFailure) {
      // Direct, not through `reportFailure`: a watcher here is only ever
      // React's own store subscription, and routing its throw back into the
      // funnel would append a row, notify the watchers, and arrive here again.
      console.error("[failure-log] a log watcher threw", watcherFailure);
    }
  }
}

/**
 * A write landed: the rows are different now, whether or not the NUMBER is.
 *
 * INSIDE a lane op only. Re-reads the count rather than adjusting it, because an
 * append at the ring's limit also prunes and a guess would drift from the store
 * it describes — and because a failure reported during a chapter visit has no
 * mounted reader to do it.
 *
 * A failed re-read is never reported — the write it followed SUCCEEDED, and
 * `writeEntry`'s own swallow is the terminal for anything that goes wrong on
 * this path — but it must not leave the number behind either (George R6 P2-1).
 * The append and the count are two separate trips through `getDb()`, so a
 * connection terminated between them is enough to lose the read; and on the
 * FIRST failure of a page, keeping the old number means `useSyncExternalStore`
 * compares 0 to 0, bails out, and the ≡ mark never appears over a row that is
 * durably on disk. Nothing recovers that until the app is foregrounded: the
 * hook's retry ladder is armed by ITS OWN read failing and never learns about
 * this one. So the count advances by the one write known to have landed,
 * clamped to the ring — a floor, not a reconciliation. If the number was
 * already stale-low it stays low, but it is non-zero, which is all the mark
 * needs; `readCountIntoStore` on the next foreground is still the reconciler.
 *
 * One notification carrying both facts, so a Books re-render is decided once.
 * Books reads only `count`, so once the ring is at its limit
 * `useSyncExternalStore` compares the same number and bails out — which is what
 * keeps the marker from re-rendering on every append. It is React's bail-out
 * doing that, not an equality guard here, and the difference matters: a guard
 * here would also have suppressed the generation the panel needs.
 */
async function markLogWritten(): Promise<void> {
  try {
    logCount = await countFailures();
  } catch {
    // The append landed, so the store holds one more than it did — up to the
    // ring's limit, past which the same append also pruned. Not routed through
    // `refreshCount()`: that enqueues, and this already runs inside a lane op.
    logCount = Math.min(logCount + 1, FAILURE_LOG_LIMIT);
  }
  logGeneration += 1;
  notifyLog();
}

/**
 * A clear landed. INSIDE a lane op only.
 *
 * Set rather than re-read: the transaction that just committed emptied the
 * store, so the number is known exactly.
 */
function markLogCleared(): void {
  logCount = 0;
  logGeneration += 1;
  notifyLog();
}

/**
 * A pure read corrected the count. INSIDE a lane op only.
 *
 * Does NOT move the generation: nothing about the rows changed, so an armed
 * share is still a true snapshot of them and must not be thrown away by a
 * routine foreground read.
 */
async function readCountIntoStore(): Promise<void> {
  const next = await countFailures();
  if (next === logCount) return;
  logCount = next;
  notifyLog();
}

/**
 * Re-read the count, ON THE LANE. Resolves to `true` when the read landed.
 *
 * The lane is the whole point (George R3 P2-3). The hook calls this from its
 * mount, from the retry ladder, and from `visibilitychange`/`focus` — and a
 * count read started on foreground could otherwise still be in flight when the
 * person taps bin → confirm Clear, resolve afterwards with the pre-clear number,
 * and leave the ≡ saying "1 problem recorded" over an empty store. Queued behind
 * the clear, it reads the store the clear left.
 *
 * NOT called from inside a lane op — {@link markLogWritten} is that path.
 */
function refreshCount(): Promise<boolean> {
  return enqueue(readCountIntoStore).then(
    () => true,
    () => false
  );
}

/**
 * Read the log's rows, ON THE LANE.
 *
 * The share path's entry point, and the reason it is not `readFailures` directly
 * (George R3 P2-1). A render throw reports from `componentDidCatch`, which
 * queues its append — behind whatever is already on the lane, and the unchanged
 * transcode sweep can queue one row per failed Finished clip. The crash screen's
 * Send is on that same screen, and the runbook tells a facilitator to use it
 * BEFORE Restart. An off-lane read there could snapshot the pre-crash log: "There
 * is nothing to send now" while the crash is still in memory, or a file with no
 * `[render]` entry in it — and on a deterministic home-path throw, Restart lands
 * back on the crash screen, so Books never becomes a second door. The file has
 * already left the phone by then.
 *
 * Queued, rather than `await flushFailureLog()` and then read, because a flush
 * only proves the lane WAS empty: a write can queue between the flush resolving
 * and the read opening its transaction. Being on the lane is the property.
 *
 * **It hands back the generation those rows are, not just the rows** (George R5
 * P2-1). A caller that arms a payload from this read has to know which version
 * of the log the payload IS, and it cannot ask afterwards: a write landing
 * between this op finishing and the caller's continuation running would already
 * have moved the number, so a later read would stamp the payload as covering a
 * row it does not contain. Read inside the same lane op, the two cannot
 * disagree — no write can interleave with itself.
 */
export function readFailureLog(): Promise<{
  entries: StoredFailure[];
  generation: number;
}> {
  return enqueue(async () => ({
    entries: await readFailures(),
    generation: logGeneration,
  }));
}

/**
 * Whether the most recent `render` row reached the store. `null` until one has
 * been attempted on this page.
 *
 * This exists for exactly one caller: the crash screen's Restart (George R5
 * P2-2). That control reloads the document, so it must not run until the row
 * describing the crash is actually on disk — and "the lane settled" is not that
 * claim. `getDb` REJECTS on a blocked open (`db.ts`'s `blocked()`, #221: a
 * second copy of the app holding an upgrade); `writeEntry` swallows the
 * rejection, because it is the channel's terminal and reporting it would
 * recurse; `enqueue` keeps the lane settled so one failed write cannot stop the
 * ones behind it. Every one of those three is correct on its own, and together
 * they mean `flushFailureLog()` resolves cheerfully on the exact failure where
 * reloading destroys the only record of the crash and lands on the same blocked
 * open.
 *
 * Keyed on the `render` CONTEXT rather than being a plain last-write flag: a
 * transcode-sweep append queued behind a failed crash write would otherwise set
 * a last-write flag true and let Restart reload anyway. The question the crash
 * screen is asking is not "did some write land", it is "did MINE".
 */
let renderRowLanded: boolean | null = null;

/**
 * The render row itself, kept only while it has NOT landed.
 *
 * Without it, "held" is a dead end (Frank, round 6): `renderRowLanded` goes
 * `false` once and nothing ever re-appends, so a facilitator who closes the
 * blocking copy of the app and taps Restart again is refused forever — while the
 * screen's own copy tells them to try again. A control that says "try again" and
 * cannot succeed is worse than one that does nothing, because it spends the one
 * recovery the person actually has.
 *
 * One bounded row for the life of a crashed page: `describeCause` and
 * `boundText` have already cut every field by the time it gets here. Cleared the
 * moment it lands, so nothing is retained once there is nothing to retry.
 */
let pendingRenderRow: StoredFailure | null = null;

/**
 * The `name` of the error that refused the render row last, or `null`.
 *
 * `writeEntry` swallows the error itself and that stays right — it is the
 * channel's terminal, and reporting its own failure would recurse. But swallowing
 * the error is not the same as swallowing WHICH error, and the crash screen has
 * to tell two opposite refusals apart (George R7 P2-1): a blocked open clears
 * when the person closes the other copy, and the yield latch never clears at all.
 * The name is the smallest thing that answers that, and it is what
 * {@link isTerminalOpenRefusal} reads.
 *
 * Kept beside {@link renderRowLanded} and moved with it, so the pair cannot
 * disagree: cleared on a landed write, set on a refused one.
 */
let renderRowRefusal: string | null = null;

/**
 * Has the row for this page's render crash reached the store?
 *
 * `true` landed, `false` refused, `null` none attempted — and `null` must not be
 * read as failure: a boundary that caught nothing has nothing to wait for.
 */
export function renderFailureStored(): boolean | null {
  return renderRowLanded;
}

/**
 * Which error refused the render row, by name, or `null` if none did.
 *
 * Only meaningful while {@link renderFailureStored} is `false`. Pass it to
 * {@link isTerminalOpenRefusal} rather than comparing here: the names belong
 * next to the classes that carry them, in `lib/storage/db.ts`.
 */
export function renderFailureRefusal(): string | null {
  return renderRowRefusal;
}

/**
 * Try the render row again, on the lane. Resolves to whether it is stored now.
 *
 * The crash screen's Restart calls this before deciding to reload. The state it
 * exists for is SOMETIMES recoverable, and the caller is what tells the two
 * apart: a `DatabaseBlockedError` means another copy of the app is holding an
 * upgrade (#221), closing that copy is exactly what the crash screen's copy asks
 * for, and without a retry the first refusal would be permanent and that ask
 * would be a lie. A `DatabaseDowngradeError` is the other half and this function
 * cannot help with it — the retry below will refuse again, every time, because
 * the connection is gone for the life of the page. That is why the answer is
 * read together with {@link renderFailureRefusal} through
 * `isTerminalOpenRefusal`, and not on its own.
 *
 * Idempotent, and cheap when there is nothing owed: with no pending row it
 * reports the state it already has rather than writing anything. It cannot
 * duplicate the row either — {@link pendingRenderRow} is cleared the moment an
 * append succeeds, so a second tap after a successful retry writes nothing.
 */
export function retryRenderFailureWrite(): Promise<boolean> {
  const owed = pendingRenderRow;
  if (owed === null) return Promise.resolve(renderRowLanded !== false);
  // `writeEntry` swallows its own failure and updates both flags, so this
  // resolves either way and the answer is read from the state it left.
  return enqueue(() => writeEntry(owed)).then(() => renderRowLanded !== false);
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
    if (entry.context === "render") {
      renderRowLanded = true;
      pendingRenderRow = null;
      renderRowRefusal = null;
    }
    // Direct, not `refreshCount`: this function is ALREADY a lane op, and
    // re-entering `enqueue` here would wait on a lane that is waiting on this.
    // Awaited, so the store update stays inside the op that caused it — which
    // is also what makes `flushFailureLog` cover the count and the generation,
    // not just the row.
    await markLogWritten();
  } catch (writeFailure) {
    // Recorded before the swallow, so the crash screen can tell a refused write
    // from a settled lane. The swallow itself stays: this function IS the
    // channel's terminal and reporting its own failure would recurse.
    if (entry.context === "render") {
      renderRowLanded = false;
      pendingRenderRow = entry;
      // The error is still swallowed; only its name is kept, and only so the
      // crash screen can tell a refusal that clears from one that cannot.
      renderRowRefusal =
        (writeFailure as { name?: string } | null)?.name ?? null;
    }
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
    markLogCleared();
  });
}

/**
 * Resolve once everything currently queued on the lane has settled.
 *
 * The crash screen's Restart awaits THIS — it is what the `await` in
 * `error-boundary.tsx`'s `reload()` is waiting on, and the reason that control
 * now paints `busy` while it waits. A render-phase throw reports through this
 * module BEFORE any effect has run — so
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
 * Which version of the log is on disk — a number that moves on every landed
 * write and every landed clear, and on nothing else.
 *
 * What it is for: `FailureLogPanel` arms a File from the rows at tap 1 and hands
 * it over at tap 2, and it has to drop that armed payload if the rows changed in
 * between. The count cannot tell it — at the ring's limit an append prunes the
 * oldest and the count stays exactly where it was, so the panel would send a
 * snapshot that is missing the newest row and still contains a row that is gone,
 * while the Notice beside it agrees with neither (George R3 P2-2).
 *
 * Deliberately NOT the count, and deliberately a second hook rather than one
 * hook returning both: Books reads only the count and must not re-render when a
 * generation moves without it, which is the whole reason the ring's no-op
 * appends were made quiet in the first place.
 *
 * It is a counter, not a timestamp or a key. A wall clock can go backwards on a
 * phone whose date is wrong, and the store's keys are out-of-line
 * auto-increments this module has no other reason to read.
 */
export function useLogGeneration(): number {
  return useSyncExternalStore(
    subscribeToLog,
    getLogGeneration,
    getLogGeneration
  );
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
 * should re-arm everything this hook holds — the ladder and the foreground
 * listeners — from the state a fresh mount would have. The number itself lives
 * in the module-level store, so it does not flash to 0 on the way past.
 *
 * **The value comes from {@link getFailureCount}, not from `useState(0)`**
 * (George R2 P2-1). Books is unmounted for the whole of a chapter visit, so a
 * hook that starts each mount at 0 loses the mark exactly when a facilitator
 * goes to check whether the recording survived and comes back. The effect below
 * still owns READING — the ladder, the recovery token, the foreground listeners
 * — but what it reads into is the store, and every write updates that store
 * whether or not this screen is mounted.
 */
export function useFailureCount(recoveryToken = 0): number {
  const count = useSyncExternalStore(
    subscribeToLog,
    getFailureCount,
    // Server snapshot: this app never server-renders, but `renderToStaticMarkup`
    // is how `tests/error-boundary.test.ts` reaches the crash screen's markup,
    // and that tree now contains a share control that mounts this hook's
    // neighbours. Same value, so the two can never disagree.
    getFailureCount
  );

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    // One pending retry at a time (George R1 P3-4). `refresh` is reached from
    // three places — this effect's own mount, the ladder, and the foreground
    // listeners — so two of them arriving while a retry is pending used to leave
    // an orphan timer that only the LAST handle's `clearTimeout` could reach.
    // Extra reads rather than a stuck marker, but the cleanup then lied about
    // what it cancelled. (A write landing was a fourth caller until round 2 moved
    // the count into the module store; it no longer reaches this effect at all.)
    const armRetry = (delayMs: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(refresh, delayMs);
    };

    const refresh = () => {
      void refreshCount().then((landed) => {
        if (!live) return;
        if (landed) {
          attempt = 0;
          return;
        }
        // Quiet, but NOT final (George, round 2). Staying quiet is right — a
        // failed `getDb` is already on the shelf's own Notice with a Try again,
        // and a second voice for the same cause, somewhere a translator cannot
        // act, is noise. Giving up is not: the read fails on a TRANSIENT open (a
        // second tab holding an upgrade, `DatabaseBlockedError`, #221), the
        // shelf's Try again does not re-run this effect on its own, and the
        // count then sat at 0 forever — so a log that was on disk and had
        // survived a reload stayed invisible, and the panel that sends it never
        // mounted, because it is gated on the count.
        attempt += 1;
        if (attempt > MAX_COUNT_RETRIES) return;
        armRetry(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
      });
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

    // No watcher registration here any more: a write updates the store itself
    // (`writeEntry` → `markLogWritten`, which re-reads the count on the lane and
    // advances it by one if that read fails), which is what makes a failure
    // reported while Books is unmounted — during a chapter visit — visible the
    // moment Books comes back. This effect owns only the READ and its recovery,
    // and its recovery covers its own reads only.
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    refresh();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [recoveryToken]);

  return count;
}
