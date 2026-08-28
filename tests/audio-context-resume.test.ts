import { describe, expect, it } from "vitest";

import { contextNeedsResume } from "@/hooks/audio-io";

/**
 * `contextNeedsResume` is the one audibility decision extracted from the browser-
 * only audio boundary so it can be tested in Node. The regression it guards: a
 * context in WebKit's `"interrupted"` state (iOS enters it on a call / route
 * change / backgrounding) must be resumed, or every later playback is silent
 * with no error. The pre-fix guard only handled `"suspended"`, so the
 * `"interrupted"` case is the mutation that must fail if the fix is removed.
 */
describe("contextNeedsResume", () => {
  it("resumes a suspended context", () => {
    expect(contextNeedsResume("suspended")).toBe(true);
  });

  it("resumes an interrupted context — iOS's non-standard fourth state", () => {
    expect(contextNeedsResume("interrupted")).toBe(true);
  });

  it("leaves a running context alone", () => {
    expect(contextNeedsResume("running")).toBe(false);
  });

  it("does not resume a closed context — resume() would reject", () => {
    expect(contextNeedsResume("closed")).toBe(false);
  });
});
