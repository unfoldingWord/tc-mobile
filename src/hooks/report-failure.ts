/**
 * The one place a failure nobody could handle is reported (#167).
 *
 * Before this module there was no channel at all: 25 `console.error` call sites
 * in `src/` were the terminal destination of every caught failure, a render
 * throw unmounted the tree with no boundary above it, and a rejected promise
 * nothing awaited was invisible to everyone including the maintainer. AGENTS.md
 * states the bar — "an unhandled rejection must reach an error boundary and a
 * single sink; `console.error` is not a channel on a phone in a village" — and
 * this is the sink half of it.
 *
 * What it deliberately is NOT: a network reporter, a third-party SDK, or a
 * queue. This app is offline-first and runs on phones whose owners did not
 * consent to telemetry. Nothing here leaves the device — the destination #205
 * added is a bounded log in the same IndexedDB the recordings live in, and it
 * leaves the phone only when a person hands it to the OS share sheet.
 *
 * Layer: `hooks/`, not `app/`, because the callers the follow-up routes here
 * live in `hooks/` and `components/`, and neither may import from `app/`
 * (the onion rule, enforced in `eslint.config.mjs`). It touches no browser API
 * of its own — the `window` listeners that feed it are registered in
 * `src/app/install-failure-listeners.ts`, the entry's first import, which is
 * where page-level wiring belongs.
 */

/**
 * One reported failure: what went wrong, and where it was noticed.
 *
 * `cause` is `unknown` on purpose. A `throw` can carry anything, a rejected
 * promise can reject with anything, and the two things this repo must never do
 * with it are assume it is an `Error` and show it to a translator.
 *
 * The durable sink (#205) renders it to `StoredFailure` before storing: `cause`
 * is not safely structured-cloneable, and nothing in this shape may reach a
 * translator's screen.
 */
export interface FailureReport {
  /**
   * A short, stable key for the site that noticed the failure — `"render"`,
   * `"unhandled-rejection"`, `"uncaught-error"`. A free string rather than a
   * union: the follow-up that routes the existing `console.error` sites here
   * adds one key per site, and a union would make that a two-file change for
   * no gain a reader of the log can feel.
   */
  readonly context: string;
  readonly cause: unknown;
  /**
   * React's own component tree for a render throw, as `componentDidCatch`
   * receives it.
   *
   * Present only on the boundary's reports — a `window` listener has no such
   * thing to give — and never rendered. In a production build the cause's own
   * stack is minified, and this is the half that says which component threw, so
   * dropping it costs the maintainer the one fact the log exists to carry.
   */
  readonly componentStack?: string;
}

type FailureListener = (report: FailureReport) => void;

/**
 * The subscribers. A set, not one slot — changed in #205, and the reason is
 * worth keeping.
 *
 * This was a single slot, on the argument that a second consumer of the same
 * failures is a second place to keep in sync. What that shape actually produced
 * was a displacement bug (#188 round 3, Frank P2, deferred to #205): a second
 * `subscribeToFailures` REPLACED the first, and the second subscriber's
 * unsubscribe then emptied the only slot. With #205 there is a durable sink
 * installed for the life of the page, so any transient subscriber — a panel that
 * wants to refresh a count while it is open — would silently take the durable
 * log offline and leave nothing behind when it closed.
 *
 * The two alternatives were "the durable sink wins" (the first subscription is
 * un-displaceable, later ones are refused) and this. A set is chosen because
 * refusing a subscription is a failure mode with no channel to report it
 * through, and because "one sink" was never the property that mattered — the
 * property AGENTS.md asks for is one FUNNEL, which `reportFailure` still is.
 *
 * Iterated over a copy on dispatch, so a listener that unsubscribes (or
 * subscribes) while being called cannot mutate the collection mid-walk.
 */
const sinks = new Set<FailureListener>();

/**
 * The last object-identity cause reported, and the context it was reported
 * under, for the double-report window below. The cause is never read as a value
 * — only compared by reference; the context is compared by string equality. The
 * pair is the dedup key: one thrown object reaching both feeds under the SAME
 * context collapses, but the SAME object surfacing under a DIFFERENT context is
 * a distinct failure and is kept (Frank, round 2).
 */
let lastCause: unknown = null;
let lastContext: string | null = null;

/**
 * Add a failure subscriber. Returns the removal.
 *
 * The production subscriber is the durable log in `hooks/failure-log.ts`
 * (#205), installed once from the entry so it is live before the App graph
 * evaluates. What a translator SEES when a failure is reported from outside
 * React's render — a background rejection, while a screen is working — is still
 * deliberately not "replace the live tree": that would unmount `App`, and `App`
 * is where a failed-save recording is held in RAM (#38). So the answer stays
 * report it, record it, mark the control, tear nothing down. Tracked on #167.
 *
 * Subscribing the same listener twice is a no-op (it is a set), and the
 * returned removal is safe to call more than once.
 */
export function subscribeToFailures(listener: FailureListener): () => void {
  sinks.add(listener);
  return () => {
    sinks.delete(listener);
  };
}

/**
 * Report a failure nothing else could handle.
 *
 * Never throws. Every caller is a place where a throw has nowhere to go — a
 * `componentDidCatch`, a `window` event handler, a `catch` block — so a sink
 * that could fail would turn one failure into two.
 *
 * Logs once. Consecutive reports of the SAME object UNDER THE SAME CONTEXT are
 * collapsed, because there are two independent feeds — the boundary and the
 * `window` listeners — and one thrown object can reach both. That double arrival
 * was NOT observed in the dev-mode Chromium probe on the PR: a render throw
 * produced exactly one report there. The guard costs a reference comparison plus
 * a string compare and is what keeps the one log honest if a browser does raise
 * it on both paths; it is not a claim that one does. Object identity is the only
 * test used for the cause, and only for objects — two separate rejections that
 * both carry the string `"failed"` are two failures and are logged twice.
 *
 * Context is part of the key so the same object surfacing under two DIFFERENT
 * contexts — a shared sentinel `Error` reported as `"save"` and then `"export"`
 * — is two failures, not one swallowed (Frank, round 2). Only the true
 * double-feed, which carries one context, collapses.
 *
 * One consequence of collapsing by identity, stated rather than guarded: if the
 * same object ever did reach both feeds, the report kept is the FIRST to
 * arrive, so a `window` report that beat the boundary would keep the version
 * without a `componentStack`. Nothing observed does this — the boundary is what
 * React calls for a caught render throw — and a second flag to cover an
 * unobserved ordering is more machinery than the fact is worth today.
 */
export function reportFailure(
  cause: unknown,
  context: string,
  componentStack?: string
): void {
  const isObject =
    cause !== null &&
    (typeof cause === "object" || typeof cause === "function");
  if (isObject && cause === lastCause && context === lastContext) return;
  lastCause = isObject ? cause : null;
  lastContext = isObject ? context : null;

  // Collapse the SAME object under the SAME context only within one tick, then
  // forget it. The window exists so one thrown object reaching both feeds
  // (boundary + `window`) in the same turn — or a StrictMode double-invoke —
  // logs once; it must NOT swallow a genuine LATER failure that happens to reuse
  // the object (a retried save that rejects the same sentinel twice). Clearing
  // on a microtask keeps the synchronous collapse and reopens the channel for
  // the next tick. Guarded by the full key so a newer report that already
  // replaced the slot is left alone.
  if (isObject) {
    const collapsedCause = cause;
    const collapsedContext = context;
    queueMicrotask(() => {
      if (lastCause === collapsedCause && lastContext === collapsedContext) {
        lastCause = null;
        lastContext = null;
      }
    });
  }

  // Appended as a third argument rather than folded into the message, so the
  // cause stays the second argument every reader (and every existing case)
  // expects, and a report with no tree keeps exactly the two it had.
  //
  // `console.error` is KEPT alongside the durable log (#205), not replaced by
  // it. It is not a channel on a phone in a village — that is what the log is
  // for — but it is the channel on a maintainer's desk, where a live console is
  // the fastest read there is, and it is the only one left if the durable write
  // is what failed.
  if (componentStack === undefined) console.error(`[${context}]`, cause);
  else console.error(`[${context}]`, cause, componentStack);

  if (sinks.size === 0) return;
  const report: FailureReport =
    componentStack === undefined
      ? { context, cause }
      : { context, cause, componentStack };
  // A copy, so a listener that subscribes or unsubscribes from inside its own
  // call cannot mutate the set being walked.
  for (const listener of Array.from(sinks)) {
    try {
      listener(report);
    } catch (sinkFailure) {
      // Logged directly rather than through `reportFailure`, which would
      // recurse straight back into the sink that just threw. One throwing
      // subscriber must not cost the others their report, which is why this is
      // caught per listener and not around the loop.
      console.error("[report-failure] a failure subscriber threw", sinkFailure);
    }
  }
}
