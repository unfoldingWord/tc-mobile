import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * `instanceof` walks `cause`'s own prototype chain — an ordinary check for an
 * ordinary object, but a revoked Proxy's `[[GetPrototypeOf]]` throws instead
 * of answering, and `instanceof` has no other way to ask. Discovered while
 * closing out Frank r2 P2 on #886 (issuecomment-5822215744): fixing
 * `isQuotaExceeded`/`isDatabaseDowngrade` in `hooks/save-failure.ts` alone
 * left `saveFailureKind` still able to throw here, the next classifier in
 * its chain, on the same hostile shape (a revoked Proxy, not the throwing-
 * getter shape — a plain object's fixed prototype link never throws).
 * Falling through to `null` is the correct classification, not a swallow:
 * a cause whose own prototype cannot even be read is not, and can never be
 * shown to be, one with this message.
 */
function messageOf(cause: unknown): string | null {
  try {
    return cause instanceof Error ? cause.message : null;
  } catch {
    return null;
  }
}

export function isMissingChapterFailure(
  cause: unknown,
  chapterId: ChapterId
): boolean {
  return messageOf(cause) === `No such chapter: ${chapterId}`;
}

export function isMissingSegmentFailure(
  cause: unknown,
  segmentId: SegmentId
): boolean {
  return messageOf(cause) === `No such segment: ${segmentId}`;
}

export function isMissingChapterOrSegmentFailure(cause: unknown): boolean {
  const message = messageOf(cause);
  return (
    message !== null &&
    (/^No such chapter: .+/.test(message) ||
      /^No such segment: .+/.test(message))
  );
}
