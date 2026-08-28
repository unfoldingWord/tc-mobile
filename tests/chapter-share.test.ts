import { describe, expect, it } from "vitest";

import { classifyShareError } from "@/hooks/use-chapter-share";

/**
 * B7 Share Chapter — the share-rejection classifier.
 *
 * The two-gesture flow lives in `useChapterShare`, whose state machine and the
 * `navigator.share` handoff are React + browser glue this repo has no renderer
 * to exercise (the constraint `tests/use-erase-segment.test.ts` documents). What
 * IS node-testable is the pure decision the classifier makes about a rejection,
 * and it is the one with real product weight: it decides whether a translator
 * sees a failure, gets a silent retry, or the flow simply ends.
 *
 * The distinction that matters most is `NotAllowedError` → `retry`. That was the
 * P1 that sent this PR back: encoding spent the iOS activation window and the
 * share was refused. The rework prevents the refusal, but if one still arrives,
 * treating it as `failed` would throw away the already-encoded File and send the
 * translator back to re-encode — so it must classify as `retry`, keeping the
 * File armed for a fresh tap.
 */
describe("classifyShareError", () => {
  it("treats a dismissed sheet (AbortError) as dismissed, not a failure", () => {
    const abort = new DOMException("user cancelled", "AbortError");
    expect(classifyShareError(abort)).toBe("dismissed");
  });

  it("treats a spent activation (NotAllowedError) as retry, keeping the File", () => {
    const notAllowed = new DOMException("permission denied", "NotAllowedError");
    expect(classifyShareError(notAllowed)).toBe("retry");
  });

  it("treats any other DOMException as a real failure", () => {
    const other = new DOMException("boom", "DataError");
    expect(classifyShareError(other)).toBe("failed");
  });

  it("treats a plain Error as a real failure", () => {
    expect(classifyShareError(new Error("network"))).toBe("failed");
  });

  it("treats a non-error throw as a real failure", () => {
    expect(classifyShareError("nope")).toBe("failed");
    expect(classifyShareError(undefined)).toBe("failed");
  });
});
