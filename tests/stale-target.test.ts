import { describe, expect, it } from "vitest";

import {
  isMissingChapterFailure,
  isMissingChapterOrSegmentFailure,
  isMissingSegmentFailure,
} from "@/lib/storage/stale-target";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * The pure #378 classifier: missing chapter/segment store errors mean the live
 * screen's target is stale, not that the translator should see a raw UUID.
 *
 * Deliberately narrow like `isStaleBookFailure`: exact-id helpers require the
 * same id the caller acted on, and the save-failure helper only accepts the two
 * store strings whose ids cannot be recreated by retrying the held take.
 */
describe("stale chapter/segment target classification (#378)", () => {
  const chapter = "chapter-1" as ChapterId;
  const segment = "segment-1" as SegmentId;

  it("matches the exact missing chapter the caller was acting on", () => {
    expect(
      isMissingChapterFailure(new Error(`No such chapter: ${chapter}`), chapter)
    ).toBe(true);
    expect(
      isMissingChapterFailure(new Error("No such chapter: other"), chapter)
    ).toBe(false);
  });

  it("matches the exact missing segment the caller was acting on", () => {
    expect(
      isMissingSegmentFailure(new Error(`No such segment: ${segment}`), segment)
    ).toBe(true);
    expect(
      isMissingSegmentFailure(new Error("No such segment: other"), segment)
    ).toBe(false);
  });

  it("does not accept non-Error values or unrelated store strings", () => {
    expect(
      isMissingChapterFailure(`No such chapter: ${chapter}`, chapter)
    ).toBe(false);
    expect(isMissingSegmentFailure(null, segment)).toBe(false);
    expect(isMissingChapterOrSegmentFailure(new Error("No such book: x"))).toBe(
      false
    );
    expect(isMissingChapterOrSegmentFailure(new Error("quota"))).toBe(false);
  });

  it("recognises chapter/segment misses as non-retryable save targets", () => {
    expect(
      isMissingChapterOrSegmentFailure(new Error("No such chapter: x"))
    ).toBe(true);
    expect(
      isMissingChapterOrSegmentFailure(new Error("No such segment: x"))
    ).toBe(true);
    expect(
      isMissingChapterOrSegmentFailure(new Error("No such segment: "))
    ).toBe(false);
  });
});
