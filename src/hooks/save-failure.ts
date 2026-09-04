/**
 * Why a save failed, in the one word the recovery screen needs.
 *
 * `instanceof DOMException` would be the obvious test and is deliberately not
 * used: it ties the check to a browser global, and the point of this module is
 * that it can be exercised in plain Node. The shape is duck-typed instead.
 *
 * The words a translator actually reads live in `components/`; this only picks
 * which of them applies.
 */

import type { SaveFailureKind } from "@/lib/takes/pending-take";

/**
 * Re-exported, not redeclared: the kind is a field of the held take, so it is
 * defined beside the state machine in `lib/takes/pending-take.ts`, which `lib/`
 * cannot reach into `hooks/` for. This module is the classifier only.
 */
export type { SaveFailureKind };

export function isQuotaExceeded(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const e = cause as { name?: unknown; code?: unknown };
  // 22 is the legacy DOMException code for a quota failure, which is still
  // what some WebKit builds report instead of the name.
  return e.name === "QuotaExceededError" || e.code === 22;
}

export function saveFailureKind(cause: unknown): SaveFailureKind {
  return isQuotaExceeded(cause) ? "quota" : "unknown";
}

/**
 * The whole vocabulary a screen may say about a caught failure (#172).
 *
 * Every key is an entry in `components/strings.ts`, and the screens index that
 * table with what {@link failureKey} returns — so a key with no entry there is a
 * compile error at the use site rather than a blank Notice on a phone. The keys
 * live here, beside the classifier that produces them, because `hooks/` cannot
 * import `components/` (the onion rule) and both halves have to agree.
 *
 * Deliberately four words, not one code per call site: this is what a translator
 * can act on. "No room left on this phone" is a thing to go and fix; "could not
 * save" is a thing to retry. WHICH site failed is the maintainer's question, and
 * it travels with the cause to `reportFailure`, never to the screen.
 */
export type FailureKey = "loadFailed" | "saveFailed" | "eraseFailed" | "noRoom";

/**
 * Which word this failure gets: `noRoom` when the cause is a quota rejection,
 * otherwise the caller's fallback.
 *
 * Routing every catch through here is the point. Quota was classified in exactly
 * ONE place before — the take save — so the same full phone read as
 * "UnknownError: Internal error opening backing store" on every other write:
 * gibberish to a reader, and unactionable to someone who could have freed space.
 *
 * Reads only the cause's shape (`isQuotaExceeded` duck-types it), never its
 * message. A browser's exception text is English, untranslatable, and is exactly
 * what must not reach a screen built for people who may not read.
 */
export function failureKey(cause: unknown, fallback: FailureKey): FailureKey {
  return isQuotaExceeded(cause) ? "noRoom" : fallback;
}
