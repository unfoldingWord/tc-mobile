import { describe, expect, it } from "vitest";

import { pausePlan } from "@/lib/audio/pause-plan";

/**
 * What `pause()` owes each `MediaRecorder.state` (George R1 P2-1, #58).
 *
 * The defect this pins: `pause()` guarded on `recorder.state !== "recording"`
 * and RETURNED. That was safe while its only caller was the Record control,
 * which is rendered from React state that a user tap keeps aligned with the
 * recorder. #58 added a caller — the `pagehide` handler — that fires from a
 * native lifecycle event, where the two can disagree: if the user agent has
 * already moved the recorder to `"paused"` under us, the old guard skipped the
 * whole freeze (`recordingRef`, the elapsed bank, `clearTick`,
 * `setState("paused")`) and left the UI claiming a live take over a recorder
 * that is not capturing.
 *
 * The table is pure so both of its non-trivial rows are proven in Node. What the
 * hook then DOES with the verdict — the native `pause()` call, the elapsed
 * arithmetic, the `setState` — is browser-bound and device-only, as
 * `tests/pagehide.test.ts` says for the sibling table.
 */

/**
 * Every `MediaRecorder.state`, as a total map so a value added to the parameter
 * type is a type error HERE as well as in the implementation's switch — the
 * exhaustiveness a bare array of cases only claims (George R1 P3-4).
 *
 * Written against `Parameters`/`ReturnType` rather than imported unions: the
 * module exports one function and nothing else, and an exported type that only a
 * test imports is dead surface knip cannot see through.
 */
const PLANS = {
  recording: "pause-and-freeze",
  paused: "freeze-only",
  inactive: "ignore",
} satisfies Record<
  Parameters<typeof pausePlan>[0],
  ReturnType<typeof pausePlan>
>;

describe("pausePlan", () => {
  it("pauses and freezes a recorder that is actually recording", () => {
    // Unchanged from before #58: the Record control's path, byte for byte.
    expect(pausePlan("recording")).toBe("pause-and-freeze");
  });

  it("freezes WITHOUT a native pause when the recorder is already paused", () => {
    // The fix. Calling `MediaRecorder.pause()` again would throw an
    // InvalidStateError, but the freeze the rest of the recorder assumes — the
    // stopped tick, the banked elapsed, the frozen scope, `state === "paused"` —
    // still has to happen, or the UI keeps rendering a live take.
    expect(pausePlan("paused")).toBe("freeze-only");
  });

  it("ignores an inactive recorder", () => {
    // NOT this table's business. A recorder that went inactive on its own is a
    // #59 mic interruption, and `onInterrupted` owns it: it takes the recorder to
    // `"processing"`, where `stop()` still recovers the chunks. Freezing to
    // `"paused"` here would paint a Resume the recorder cannot honour over a take
    // that already has a recovery path.
    expect(pausePlan("inactive")).toBe("ignore");
  });

  it("covers every state in the map, so a new one cannot be skipped", () => {
    for (const [state, plan] of Object.entries(PLANS)) {
      expect(pausePlan(state as Parameters<typeof pausePlan>[0])).toBe(plan);
    }
  });
});
