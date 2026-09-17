/**
 * The durable failure log (#205).
 *
 * AGENTS.md states the bar this closes: "an unhandled rejection must reach an
 * error boundary and a single sink — `console.error` is not a channel on a
 * phone in a village." #188 built the boundary and the sink; the sink's only
 * terminal output was `console.error`, which on a phone means the failure is
 * gone the moment the page is. This is the destination.
 *
 * ── Why IndexedDB, and why in the same database as the recordings ──
 *
 * It has to survive a reload, an app update, and the process being killed, and
 * it has to be readable back by code that can then hand it to the share sheet.
 * That is IndexedDB. Putting it in `tc-mobile` rather than a database of its own
 * keeps one connection, one version ladder and one `blocked`/downgrade story —
 * a second database would double the open paths that #221 and #170 are still
 * working through, for a store that holds at most 50 short rows.
 *
 * ── The ring, and what "idempotent" means for a log ──
 *
 * AGENTS.md requires every write to be safely re-runnable or documented as to
 * why not. This one is NOT: appending the same failure twice appends two rows,
 * on purpose. A log's value is that it counts occurrences — a save that fails
 * ten times is a different fact from one that failed once, and de-duplicating by
 * content would erase exactly the signal a maintainer is looking for.
 * `reportFailure` already collapses the one double-arrival that is an artifact
 * rather than a repeat (the same object reaching both the boundary and the
 * `window` feed in one tick), which is the right layer for that.
 *
 * What IS guaranteed: the append and the prune are ONE transaction, so the log
 * is never observed over its limit and a failed prune cannot leave a row
 * appended without it. The store is keyed by an out-of-line auto-increment, so
 * insertion order IS key order and the oldest row is always the front of the
 * cursor — no timestamp comparison, and no dependence on the clock, which on a
 * phone that has been off for a week is not monotonic.
 */

import { getDb } from "./db";
import { FAILURE_LOG_LIMIT, type StoredFailure } from "@/types/failure";

/**
 * Append one entry, then drop the oldest rows until the log is within its
 * limit. One transaction, so a reader never sees an over-long log.
 *
 * Rejects like any other write. The caller — the sink in
 * `hooks/failure-log.ts` — must swallow that: a log write that failed cannot be
 * reported through the funnel it is the destination of.
 */
export async function appendFailure(entry: StoredFailure): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    "failures",
    "readwrite",
    // Strict durability, the bar `openTakeTx` and `commitTranscode` already hold
    // (George R1 P3-2, this takeover). Under the browser default — relaxed on
    // Chromium — a transaction can report success before the bytes are flushed.
    // That default is survivable for most writes and is NOT survivable for this
    // one: the crash screen's Restart awaits `flushFailureLog()` and then calls
    // `location.reload()`, so a `done` that resolves ahead of the flush unloads
    // the page in the window the flush was added to close, and the row lost is
    // the record of the crash the user is recovering from. Inference rather than
    // a measurement — nobody here has observed Chromium's flush timing — but the
    // repo's own invariant says so, the option costs nothing, and WebKit
    // ignoring it makes this a no-op rather than a regression.
    { durability: "strict" }
  );
  const done = tx.done;
  // Observe `done` NOW, not only on the happy path (Frank, takeover round 2).
  //
  // `idb` builds the transaction's `done` promise eagerly, when it wraps the
  // transaction — `cacheDonePromiseForTransaction` runs from
  // `transformCachableValue`, not from the `done` getter. So a transaction that
  // errors or aborts ALWAYS has a rejected promise in existence, whether or not
  // anything is awaiting it. If a request below rejects, this function throws
  // before reaching `await done`, and that rejection is then unhandled.
  //
  // Unhandled here is not a lint nit, it is a loop. An unhandled rejection in a
  // browser fires `unhandledrejection`, which `app/install-failure-listeners.ts`
  // feeds into `reportFailure`, which reaches THIS function again — under the
  // same full disk or dead connection that caused the first one. Each turn adds
  // another. `writeEntry`'s swallow, the guard that exists for exactly this
  // recursion, never sees it: the rejection escapes around the outside of the
  // call it swallows.
  //
  // One handler settles it. The `await done` below is still the real wait and
  // still throws on failure, so nothing about the success path changes; this
  // only says the rejection has been looked at.
  void done.catch(() => undefined);
  const store = tx.objectStore("failures");
  await store.add(entry);

  // Prune from the front. `count()` inside the same transaction sees the row
  // just added, so this is the post-append length. The loop deletes at most one
  // row per append in steady state; it is a loop rather than a single delete so
  // a log left over-long by an older build (or by a lowered limit) converges.
  let over = (await store.count()) - FAILURE_LOG_LIMIT;
  if (over > 0) {
    let cursor = await store.openCursor();
    while (cursor && over > 0) {
      await cursor.delete();
      over -= 1;
      cursor = await cursor.continue();
    }
  }
  await done;
}

/**
 * The log, newest first — the order both the on-screen count and the shared
 * text file want, and the order a person reading it expects.
 *
 * `getAll` returns rows in ascending key order, which for this store is oldest
 * first, so this reverses a copy. The array is at most
 * {@link FAILURE_LOG_LIMIT} short rows.
 */
export async function readFailures(): Promise<StoredFailure[]> {
  const db = await getDb();
  const rows = await db.getAll("failures");
  return rows.reverse();
}

/**
 * How many entries the log holds.
 *
 * Separate from {@link readFailures} because the Books screen needs only this —
 * the marker on the menu control — and reading it as a count avoids pulling
 * every stack into memory on a screen that is not showing them.
 */
export async function countFailures(): Promise<number> {
  const db = await getDb();
  return db.count("failures");
}

/**
 * Empty the log.
 *
 * Idempotent, and the one write here that is: clearing an empty store is a
 * no-op. Offered because the log is the only thing in this database a person
 * can be told to discard without losing work — and a facilitator who has
 * already carried it off the phone should be able to get back to a quiet
 * marker, or the marker stops meaning "something went wrong today".
 */
export async function clearFailures(): Promise<void> {
  const db = await getDb();
  // Same strict durability as the append, and for the mirror-image reason: a
  // facilitator who cleared the log and then had the app killed must not find it
  // back. `db.clear` would open a default-durability transaction, so the
  // transaction is opened here instead of using the shortcut.
  const tx = db.transaction("failures", "readwrite", { durability: "strict" });
  const done = tx.done;
  // Observed on every exit path, exactly as in `appendFailure` above — see the
  // comment there for why an unobserved `done` rejection is a loop rather than a
  // lint nit.
  void done.catch(() => undefined);
  await tx.objectStore("failures").clear();
  await done;
}
