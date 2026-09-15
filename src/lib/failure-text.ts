/**
 * Turning an arbitrary thrown value into text that is safe to store and safe to
 * carry off the phone (#205).
 *
 * Pure and DOM-free on purpose: this is the half of the durable failure log
 * that can be unit-tested without a browser, and it is the half most likely to
 * be wrong. A `throw` can carry anything — an `Error`, a string, `undefined`, a
 * cyclic object, a `DOMException`, a `Proxy` whose getters throw — and the sink
 * that renders it runs at the exact moment the app is already failing, so every
 * path here must terminate without throwing.
 */

import type { StoredFailure } from "@/types/failure";

/**
 * Longest message or stack kept, in characters.
 *
 * The log is a ring of {@link FAILURE_LOG_LIMIT} entries in the same IndexedDB
 * the recordings live in, so an unbounded field is a way to spend a
 * translator's storage on text. A minified production stack is a few hundred
 * characters; 2000 keeps a real one whole and truncates only the pathological
 * case (a stringified buffer, a stack from a runaway recursion).
 */
const MAX_TEXT = 2000;

/**
 * Clip to {@link MAX_TEXT}, marking that something was dropped.
 *
 * Exported because `componentStack` needs it too and is bounded at the sink
 * rather than here: it does not come from the cause, it comes from React, so
 * `describeCause` never sees it. It was the one unbounded field in a stored row
 * (George, round 2) — a deep tree stored uncut next to a cut stack, in the same
 * database the recordings live in.
 */
export function boundText(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}…[cut]`;
}

/**
 * Render a thrown value to a bounded message, plus its stack when it has one.
 *
 * Never throws. `String(cause)` is itself a hazard — an object whose `toString`
 * or whose `Symbol.toPrimitive` throws, and a `Symbol`, which throws on
 * implicit conversion — so the conversion is guarded and falls back to a
 * description of the shape rather than losing the entry entirely.
 *
 * Reading `.stack` is guarded separately: a value can be an `Error` with a
 * perfectly good message and still be a `Proxy` (or a subclass) whose `stack`
 * getter throws. Losing the stack must not lose the message with it.
 */
export function describeCause(cause: unknown): {
  message: string;
  stack?: string;
} {
  let message: string;
  try {
    // `Error` first: `String(err)` gives "Name: message", which is the line a
    // maintainer wants, and skips the `[object Object]` a plain cast can give.
    message =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`
        : typeof cause === "string"
          ? cause
          : String(cause);
  } catch {
    // The conversion itself failed. Say what little is knowable rather than
    // dropping the report — that a failure happened at all is the fact the log
    // exists to keep.
    message = `[unstringifiable ${typeof cause}]`;
  }

  let stack: string | undefined;
  try {
    const raw = (cause as { stack?: unknown } | null | undefined)?.stack;
    if (typeof raw === "string" && raw !== "") stack = boundText(raw);
  } catch {
    // A throwing `stack` getter. The message above still stands.
  }

  return stack === undefined
    ? { message: boundText(message) }
    : { message: boundText(message), stack };
}

/**
 * Render the whole log as the plain text a facilitator hands to a maintainer.
 *
 * Plain text, not JSON: the file is opened by a person on whatever they have,
 * often a phone mail client, and a wall of escaped JSON is a worse artifact
 * than a wall of lines. Entries are written newest first, because the failure
 * being asked about is almost always the last one.
 *
 * Timestamps go out as ISO-8601 UTC. A local-time render would be read by
 * someone in another timezone than the phone that produced it, and the whole
 * value of the line is correlating it with a build and a session.
 */
export function formatFailureLog(
  entries: readonly StoredFailure[],
  appVersion: string
): string {
  const header = [
    `tc-mobile failure log`,
    `app version: ${appVersion}`,
    `entries: ${entries.length}`,
    `written: ${new Date().toISOString()}`,
  ].join("\n");

  if (entries.length === 0) return `${header}\n\n(no failures recorded)\n`;

  const body = entries.map((entry) => {
    const lines = [
      `── ${new Date(entry.at).toISOString()} [${entry.context}]`,
      entry.message,
    ];
    if (entry.stack !== undefined) lines.push(entry.stack);
    if (entry.componentStack !== undefined)
      lines.push(`component tree:${entry.componentStack}`);
    return lines.join("\n");
  });

  return `${header}\n\n${body.join("\n\n")}\n`;
}
