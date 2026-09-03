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
 * consent to telemetry. The value here is that there is ONE function to change
 * when a real destination is chosen, instead of 25 call sites to find.
 *
 * Layer: `hooks/`, not `app/`, because the callers the follow-up routes here
 * live in `hooks/` and `components/`, and neither may import from `app/`
 * (the onion rule, enforced in `eslint.config.mjs`). It touches no browser API
 * of its own — the `window` listeners that feed it are registered in
 * `src/app/main.tsx`, which is the only file that owns page-level wiring.
 */

/**
 * One reported failure: what went wrong, and where it was noticed.
 *
 * `cause` is `unknown` on purpose. A `throw` can carry anything, a rejected
 * promise can reject with anything, and the two things this repo must never do
 * with it are assume it is an `Error` and show it to a translator.
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
}

type FailureListener = (report: FailureReport) => void;

/**
 * The single subscriber. One slot, not a list: a second consumer of the same
 * failures is a second place to keep in sync, and this exists precisely so
 * there is one.
 */
let sink: FailureListener | null = null;

/**
 * The last object-identity cause reported, for the double-report window below.
 * Never read as a value — only compared by reference.
 */
let lastCause: unknown = null;

/**
 * Install the failure sink. Returns the uninstall.
 *
 * Nothing in `src/` subscribes yet: choosing what a translator sees when a
 * failure is reported from OUTSIDE React's render — a background rejection,
 * while a screen is working — is deliberately not decided in the PR that builds
 * the channel. Replacing the live tree on any stray rejection would unmount
 * `App`, and `App` is where a failed-save recording is held in RAM (#38), so
 * the safe default until the pending take can be handed off (#180 owns the slot
 * this needs) is: report it, do not tear anything down. Tracked on #167.
 */
export function subscribeToFailures(listener: FailureListener): () => void {
  if (sink) {
    // Not silent, and not a throw: losing the first sink would lose the only
    // channel, and throwing here would take down whatever installed the second.
    console.error("A second failure sink replaced the first; one is kept.");
  }
  sink = listener;
  return () => {
    // Only if it is still ours: a later subscriber's slot is not this one's to
    // clear.
    if (sink === listener) sink = null;
  };
}

/**
 * Report a failure nothing else could handle.
 *
 * Never throws. Every caller is a place where a throw has nowhere to go — a
 * `componentDidCatch`, a `window` event handler, a `catch` block — so a sink
 * that could fail would turn one failure into two.
 *
 * Logs once. Consecutive reports of the SAME object are collapsed, because
 * there are two independent feeds — the boundary and the `window` listeners —
 * and one thrown object can reach both. That double arrival was NOT observed in
 * the dev-mode Chromium probe on the PR: a render throw produced exactly one
 * report there. The guard costs a reference comparison and is what keeps the
 * one log honest if a browser does raise it on both paths; it is not a claim
 * that one does. Identity is the only test used, and only for objects — two
 * separate rejections that both carry the string `"failed"` are two failures
 * and are logged twice.
 */
export function reportFailure(cause: unknown, context: string): void {
  const isObject =
    cause !== null &&
    (typeof cause === "object" || typeof cause === "function");
  if (isObject && cause === lastCause) return;
  lastCause = isObject ? cause : null;

  console.error(`[${context}]`, cause);

  const listener = sink;
  if (!listener) return;
  try {
    listener({ context, cause });
  } catch (sinkFailure) {
    // Logged directly rather than through `reportFailure`, which would recurse
    // straight back into the sink that just threw.
    console.error("[report-failure] the failure sink threw", sinkFailure);
  }
}
