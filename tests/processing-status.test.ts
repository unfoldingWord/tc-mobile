import { describe, expect, it } from "vitest";

import { processingStatusKind } from "@/components/processing-status";

/**
 * The classifier, and only the classifier: which of two status states the
 * recorder shows while `processing` (#39). The words themselves live in
 * `components/strings.ts`; nothing below asserts copy.
 *
 * What is NOT covered here: the recorder rendering the status, and the state
 * transitions into `processing`. That the interruption path freezes into
 * `processing` is `use-recorder`'s behaviour (browser surface, no DOM runner
 * here); this pins only the rule that decides which status applies.
 */
describe("processingStatusKind", () => {
  it("shows the saving status once Back has committed the take", () => {
    // isClosing: close() has run, the sheet is committing (stop → decode →
    // save). The status is in-progress.
    expect(processingStatusKind(true)).toBe("saving");
  });

  it("shows the interrupted status for a frozen, uncommitted take", () => {
    // Not closing: the #59 interruption parked the take in `processing` with no
    // Back yet. The status must point at the exit that saves it.
    expect(processingStatusKind(false)).toBe("interrupted");
  });
});
