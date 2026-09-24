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

import { isMissingChapterOrSegmentFailure } from "@/lib/storage/stale-target";
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

/**
 * The stored data is newer than this build asks for, so no write from this copy
 * can ever land — `getDb()` fails the version check before a transaction is
 * reached, every time.
 *
 * Matched by name, duck-typed like `isQuotaExceeded` above and for the same
 * reason: `instanceof` would tie this to the class in `lib/storage/db.ts`, which
 * does not export it, and the point of this module is that it runs in plain
 * Node.
 */
export function isDatabaseDowngrade(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  return (cause as { name?: unknown }).name === "DatabaseDowngradeError";
}

export function saveFailureKind(cause: unknown): SaveFailureKind {
  if (isQuotaExceeded(cause)) return "quota";
  // Ahead of `unknown`, which is a retryable blip: this one is not. A newer copy
  // of the app has upgraded the database past this build, and the recovery
  // screen must stop counting attempts at something that cannot succeed
  // (George R1 P2-1).
  if (isDatabaseDowngrade(cause)) return "downgrade";
  // A save target that is gone cannot be recreated by Retry: segment/chapter ids
  // are not reusable, and the held PCM has no valid row to land on (#378).
  if (isMissingChapterOrSegmentFailure(cause)) return "stale";
  return "unknown";
}

/**
 * The general failure vocabulary for Books and Segments (#172), distinct from
 * {@link SaveFailureKind} above: that one names the four outcomes the
 * take-save RECOVERY screen distinguishes (quota / downgrade / stale /
 * unknown), each with its own headline. This one is the small set of keys
 * every OTHER hook site in `use-books.ts`, `use-chapter-segments.ts` and
 * `use-erase-segment.ts` stores instead of a raw `cause.message` — a load, a
 * write or an erase failed, or the device is out of room, full stop. Screens
 * look the key up in `strings`, so a key with no entry is a compile error at
 * the call site rather than a blank Notice on a phone.
 *
 * Kept here, beside {@link isQuotaExceeded}, rather than in `components/`:
 * `hooks/` may not import `components/` (the onion rule), so only the WORDS
 * these keys select live in `strings.ts` — the keys themselves are a hooks
 * concern, same split `SaveFailureKind` already follows.
 */
export type FailureKey = "loadFailed" | "saveFailed" | "eraseFailed" | "noRoom";

/**
 * Map a caught failure to one of {@link FailureKey}: `"noRoom"` whenever
 * {@link isQuotaExceeded} says so — a full disk is the one condition a
 * translator can act on, and it is worth naming on every write, not only the
 * take save — and `fallback` (the call site's own word for "a load failed" /
 * "a write failed" / "an erase failed") otherwise.
 */
export function failureKey(cause: unknown, fallback: FailureKey): FailureKey {
  return isQuotaExceeded(cause) ? "noRoom" : fallback;
}
