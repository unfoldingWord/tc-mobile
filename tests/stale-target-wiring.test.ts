import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * #378's UI wiring cannot be rendered in this suite: `SegmentsScreen` mounts
 * the audio/session hooks and this repo has no hook runner for effects. The
 * pure classifier lives in `tests/stale-target.test.ts`; this pins the two
 * textual joints that make it visible to a translator instead of leaving the
 * old raw `No such ...` Notice behavior in place.
 */
describe("stale chapter/segment targets pop the Segments screen back to Books (#378)", () => {
  const hook = readFileSync(
    new URL("../src/hooks/use-chapter-segments.ts", import.meta.url),
    "utf8"
  );
  const screen = readFileSync(
    new URL("../src/components/segments-screen.tsx", import.meta.url),
    "utf8"
  );

  it("the hook classifies missing chapter/segment errors as staleTarget", () => {
    expect(hook).toContain("setStaleTarget(true)");
    expect(hook).toContain("isMissingChapterFailure(cause, chapterId)");
    expect(hook).toContain("isMissingSegmentFailure(cause, segmentId)");
    expect(hook).toContain("staleTarget,");
  });

  it("the screen leaves the stale chapter instead of rendering the raw store string", () => {
    const effectIdx = screen.indexOf("if (staleTarget) onBack();");
    expect(effectIdx).toBeGreaterThan(-1);
    const deps = screen.slice(effectIdx, effectIdx + 80);
    expect(deps).toContain("[onBack, staleTarget]");
  });
});
