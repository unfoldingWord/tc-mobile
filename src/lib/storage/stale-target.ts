import type { ChapterId, SegmentId } from "@/types/domain";

export type MissingTargetKind = "chapter" | "segment";

function messageOf(cause: unknown): string | null {
  return cause instanceof Error ? cause.message : null;
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
