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
 * A thrown value as the bare message a caller can put on screen or on a report.
 *
 * The expression this replaces — `cause instanceof Error ? cause.message :
 * String(cause)` — was written out inline across the hooks, and once more
 * behind a private `messageOf` in `mp3-codec.ts` (#160, L-15). How many is
 * deliberately not stated here: a census in prose cannot be re-checked and
 * goes stale the first time someone adds a hook, and the number in this
 * docblock's first draft was simply wrong (Frank on `25c336fd5`).
 * `tests/failure-text.test.ts` pins it as an assertion instead — the
 * expression survives in exactly one file, this one.
 *
 * Deliberately NOT {@link describeCause}, and the difference is the reason both
 * exist. `describeCause` renders for the durable log: it prefixes the error's
 * NAME ("TypeError: …"), walks the `cause` chain, and bounds the result, because
 * a maintainer reading the log days later needs all three. This renders for a
 * caller that is about to hold the string as state — `setError`, a report's
 * `message` field — where the name is noise and the chain is not wanted.
 *
 * Also not `stale-target.ts`'s same-named local, which returns `string | null`
 * on purpose: it feeds an equality test against a known message, so a non-Error
 * must render as `null` rather than as its own text, or a THROWN STRING reading
 * "No such chapter: …" would be mistaken for the store's own failure. Folding
 * that one into this would be a behaviour change in a predicate, not a
 * deduplication, so it stays where it is.
 *
 * Never throws (#721). Every caller here is a `catch` block, so if this
 * conversion itself threw, a handled failure would become an unhandled one
 * inside the code meant to report it. `instanceof` can throw on a revoked
 * `Proxy`; `cause.message` can throw on a getter that does, even on a real
 * `Error`; and `String(cause)` can throw on a hostile `toString`, a throwing
 * `Symbol.toPrimitive`, or a null-prototype object with neither. `Symbol` and
 * `BigInt` are NOT among these — `String()` does not throw on either, only
 * implicit conversion does — so they still render their own text rather than
 * the fallback. For an ordinary `Error` or a string, nothing here changes:
 * the guarded expression is the same one as before, and only its unreachable
 * failure path is new.
 */
export function errorMessage(cause: unknown): string {
  try {
    return cause instanceof Error ? cause.message : String(cause);
  } catch {
    return `[unstringifiable ${typeof cause}]`;
  }
}

/**
 * How many `cause` links are followed past the value that was thrown.
 *
 * Three, because the wrapping in this app is shallow by construction — a sweep
 * wraps a codec error, a codec error wraps a worker or an IndexedDB one — and
 * because the cap is also the cycle guard: `a.cause = b; b.cause = a` is legal
 * JavaScript and a `while` without a bound would hang the sink at the exact
 * moment the app is already failing.
 */
const MAX_CAUSE_DEPTH = 3;

/** One value, rendered. Never throws; see {@link describeCause}. */
function renderValue(cause: unknown): string {
  try {
    // `Error` first: `String(err)` gives "Name: message", which is the line a
    // maintainer wants, and skips the `[object Object]` a plain cast can give.
    return cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : typeof cause === "string"
        ? cause
        : String(cause);
  } catch {
    // The conversion itself failed. Say what little is knowable rather than
    // dropping the report — that a failure happened at all is the fact the log
    // exists to keep.
    return `[unstringifiable ${typeof cause}]`;
  }
}

/** One value's stack, if it has a readable one. Never throws. */
function readStack(cause: unknown): string | undefined {
  try {
    const raw = (cause as { stack?: unknown } | null | undefined)?.stack;
    return typeof raw === "string" && raw !== "" ? boundText(raw) : undefined;
  } catch {
    // A throwing `stack` getter — a `Proxy`, or a subclass with a getter that
    // depends on state the failure destroyed. The message still stands.
    return undefined;
  }
}

/** One link of the chain. Never throws: `cause` can be a throwing getter too. */
function readCause(cause: unknown): unknown {
  try {
    return (cause as { cause?: unknown } | null | undefined)?.cause;
  } catch {
    return undefined;
  }
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
 *
 * ── The `cause` chain, and why it is not optional here (George R4 P2-2) ──
 *
 * This function used to read `name`, `message` and `stack` and stop. That is
 * fine for a value thrown raw, and wrong for the only high-volume production
 * reporter this log receives: `finish-transcode.ts` wraps every sweep and
 * segment failure as `new Error("Transcoding finished segment <id> failed; its
 * PCM is kept", { cause })` so that `context` can stay a short, stable site key
 * rather than becoming an unbounded dedup set of segment ids. The wrapper names
 * WHICH segment; the cause is the only thing that says whether the encoder
 * stalled, the worker died, storage refused the write, or the commit failed.
 * Browsers do not fold the chain into `error.stack` — that concatenation is
 * Node's — so without this walk, the row that named the segment was the row
 * that had lost the reason. `mp3-codec.ts` folds `messageOf(cause)` into its own
 * wrapper message and so never had the problem; transcode does not, and every
 * row it writes went out undiagnosable.
 *
 * Messages only, deliberately: each link's stack is NOT appended. The chain's
 * diagnostic value is the sequence of reasons, the frames below a wrapper are
 * from the same tick as the frames above it, and the whole field shares one
 * {@link MAX_TEXT} budget that a second stack would mostly spend on repetition.
 * The outermost stack is kept because it is the one that names the site.
 *
 * `null` and `undefined` both end the walk. A `{ cause: null }` renders as
 * nothing rather than as the line "Caused by: null", which is noise dressed as
 * information.
 */
export function describeCause(cause: unknown): {
  message: string;
  stack?: string;
} {
  let message = renderValue(cause);

  let inner = readCause(cause);
  let depth = 0;
  while (inner !== undefined && inner !== null) {
    if (depth === MAX_CAUSE_DEPTH) {
      // Say that it was cut rather than letting a reader believe the chain
      // ended here — the same honesty `boundText`'s "…[cut]" marker carries.
      message += `\nCaused by: …[cause chain cut]`;
      break;
    }
    depth += 1;
    message += `\nCaused by: ${renderValue(inner)}`;
    inner = readCause(inner);
  }

  const stack = readStack(cause);

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
