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
 * `close()` holds `isClosing` across the save, are `use-recorder`/`recorder`
 * behaviours — browser surface, no DOM runner here.
 */
describe("recorderStatusKind", () => {
  it("shows 'saving' for the whole commit, even after decode flips state to idle", () => {
    // The bug round 1 caught: decode finishes, `use-recorder` sets `idle`, but
    // `close()` is still awaiting `saveTake`. `isClosing` is what spans it.
    expect(recorderStatusKind("idle", true)).toBe("saving");
    // And while state is still `processing` inside the same close.
    expect(recorderStatusKind("processing", true)).toBe("saving");
    // Defensive: `isClosing` wins the instant it is set, before stop() has
    // moved state off recording/paused.
    expect(recorderStatusKind("recording", true)).toBe("saving");
    expect(recorderStatusKind("paused", true)).toBe("saving");
  });

  it("shows 'interrupted' for a frozen take with no close in flight (#59)", () => {
    expect(recorderStatusKind("processing", false)).toBe("interrupted");
  });

  it("says nothing when no take is committing", () => {
    expect(recorderStatusKind("idle", false)).toBeNull();
    expect(recorderStatusKind("recording", false)).toBeNull();
    expect(recorderStatusKind("paused", false)).toBeNull();
    expect(recorderStatusKind("requesting", false)).toBeNull();
  });
});
