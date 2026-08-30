import { describe, expect, it } from "vitest";

import { classifyShareError } from "@/hooks/share-flow";

/**
 * B7 Share (chapter + book) — the share-rejection classifier.
 *
 * The two-gesture flow lives in `useShareFlow` (wrapped by `useChapterShare` and
 * `useBookShare`), whose state machine and the `navigator.share` handoff are
 * React + browser glue this repo has no renderer to exercise (the constraint
 * `tests/use-erase-segment.test.ts` documents). What IS node-testable is the pure
 * decision the classifier makes about a rejection,
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
  it("treats a dismissed sheet (AbortError) as dismissed, whatever the activation", () => {
    const abort = new DOMException("user cancelled", "AbortError");
    expect(classifyShareError(abort, false)).toBe("dismissed");
    expect(classifyShareError(abort, true)).toBe("dismissed");
  });

  it("treats NotAllowedError with NO live activation as retry, keeping the File", () => {
    // The tap's activation was spent; a fresh tap can still hand over the File.
    const notAllowed = new DOMException("permission denied", "NotAllowedError");
    expect(classifyShareError(notAllowed, false)).toBe("retry");
  });

  it("treats NotAllowedError WITH live activation as a real failure, not a loop", () => {
    // Activation was live and share still refused: a standing block (Permissions
    // Policy), so surface an error rather than a "Share now" that never works.
    const notAllowed = new DOMException("blocked by policy", "NotAllowedError");
    expect(classifyShareError(notAllowed, true)).toBe("failed");
  });

  it("treats any other DOMException as a real failure", () => {
    const other = new DOMException("boom", "DataError");
    expect(classifyShareError(other, false)).toBe("failed");
    expect(classifyShareError(other, true)).toBe("failed");
  });

  it("treats a plain Error as a real failure", () => {
    expect(classifyShareError(new Error("network"), false)).toBe("failed");
  });

  it("treats a non-error throw as a real failure", () => {
    expect(classifyShareError("nope", false)).toBe("failed");
    expect(classifyShareError(undefined, true)).toBe("failed");
  });
});
