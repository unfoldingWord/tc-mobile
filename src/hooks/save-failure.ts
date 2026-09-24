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

/**
 * Every duck-typed classifier below reads `name`/`code` off a `cause` this
 * module does not control the shape of. A getter that throws instead of
 * returning a value — or a revoked Proxy, where every property read throws —
 * would otherwise take the classifier down with it, at exactly the moment a
 * failure is being handled (Frank r2 P2 on #886, issuecomment-5822215744).
 *
 * The catch below is not a silent swallow: a shape that cannot even be READ
 * has already answered the question every classifier is asking ("is this
 * object a QuotaExceededError/DatabaseDowngradeError by name or code?") —
 * no, because there is no name or code to compare, only a throw. Falling
 * through to `{}` (so every classifier's `=== `comparison misses) is the
 * correct classification, not a fabricated one, and there was never a real
 * value here to hand `reportFailure` either. Centralized once here, so every
 * classifier below shares one try/catch rather than each wrapping its own.
 */
function readFailureShape(cause: unknown): { name?: unknown; code?: unknown } {
  if (typeof cause !== "object" || cause === null) return {};
  try {
    const e = cause as { name?: unknown; code?: unknown };
    return { name: e.name, code: e.code };
  } catch {
    return {};
  }
}

export function isQuotaExceeded(cause: unknown): boolean {
  const { name, code } = readFailureShape(cause);
  // 22 is the legacy DOMException code for a quota failure, which is still
  // what some WebKit builds report instead of the name.
  return name === "QuotaExceededError" || code === 22;
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
  return readFailureShape(cause).name === "DatabaseDowngradeError";
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
