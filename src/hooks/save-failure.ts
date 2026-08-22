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
