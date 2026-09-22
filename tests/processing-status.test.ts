import { describe, expect, it } from "vitest";

import { recorderStatusKind } from "@/components/processing-status";

/**
 * The recorder's commit-window status gate (#39). This pins the WHOLE gate, not
 * just the two-way classification: round 1 (Frank/George) showed the real
 * defect was the mount predicate — a status keyed on `state === "processing"`
 * unmounts the instant decode finishes, before `close()`'s IndexedDB write —
 * and a classifier that only mapped a boolean to a word could not catch it.
 *
 * The words themselves live in `lib/strings.ts`; nothing below asserts
 * copy. That the interruption path actually freezes into `processing`, and that
 * a commit holds `isClosing` across the save, are `use-recorder`/`recorder`
 * behaviours — browser surface, no DOM runner here.
 *
 * The gate has ONE answer since #614. It used to have two: a frozen #59 take
 * with no close in flight showed "interrupted", telling the translator to tap
 * Back to save it. Nothing waits on them now — the sheet commits an ended take
 * in place — so that arm folded into "saving" rather than being reworded.
 */
describe("recorderStatusKind", () => {
  it("shows 'saving' for the whole commit, even after decode flips state to idle", () => {
    // The bug round 1 caught: decode finishes, `use-recorder` sets `idle`, but
    // `close()` is still awaiting `saveTake`. `isClosing` is what spans it.
    expect(recorderStatusKind("idle", true)).toBe("saving");
    // And while state is still `processing` inside the same close.
    expect(recorderStatusKind("processing", true)).toBe("saving");
    // Defensive: `isClosing` wins the instant it is set, before stop() has
    // moved state off recording.
    expect(recorderStatusKind("recording", true)).toBe("saving");
  });

  it("shows 'saving' for a frozen #59 take with no commit in flight yet", () => {
    // The interruption ends the take; the sheet's own effect commits it one
    // render later. "Saving" is true in both halves of that, which is why the
    // second status kind is gone.
    expect(recorderStatusKind("processing", false)).toBe("saving");
  });

  it("says nothing when no take is committing", () => {
    expect(recorderStatusKind("idle", false)).toBeNull();
    expect(recorderStatusKind("recording", false)).toBeNull();
    expect(recorderStatusKind("requesting", false)).toBeNull();
  });
});
