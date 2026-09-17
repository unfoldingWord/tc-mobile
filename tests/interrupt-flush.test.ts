import { describe, expect, it } from "vitest";

import {
  decideInterruptFinalize,
  type RecorderLifecycleState,
} from "@/lib/audio/interrupt-flush";

/**
 * The pure half of the #59 code residual (audit finding A-4).
 *
 * `onInterrupted` used to release the microphone ONLY when the recorder had
 * already gone `"inactive"` on its own; on the `recorder.onerror`-while-still-
 * active branch the capture tracks and the VU tap's cloned tracks stayed live
 * until the translator tapped Back. This function is the decision that branch
 * now turns on, lifted out of the hook so it can be mutated and pinned in Node —
 * the hook half (the driven `recorder.stop()`, the bounded timer, the pending
 * flush handshake) has no MediaRecorder in this suite and is NOT covered here.
 */
describe("decideInterruptFinalize", () => {
  it("reports an already-flushed recorder when it went inactive on its own", () => {
    expect(
      decideInterruptFinalize({
        recorderState: "inactive",
        isCurrentGeneration: true,
      })
    ).toBe("already-flushed");
  });

  it("drives the flush when the recorder is still recording", () => {
    expect(
      decideInterruptFinalize({
        recorderState: "recording",
        isCurrentGeneration: true,
      })
    ).toBe("drive-flush");
  });

  // Pins that `"paused"` is not accidentally excluded. A take interrupted while
  // paused holds the microphone exactly as a recording one does, and
  // `MediaRecorder.stop()` is valid from `"paused"` — narrowing this to
  // `"recording"` would silently restore the hot mic for every paused take.
  it("drives the flush when the recorder is still paused", () => {
    expect(
      decideInterruptFinalize({
        recorderState: "paused",
        isCurrentGeneration: true,
      })
    ).toBe("drive-flush");
  });

  // Precedence is load-bearing and checked FIRST: a superseded interruption (a
  // cancel()/newer start() has bumped the generation) must arm nothing at all,
  // even when the recorder state on its own would qualify for a teardown. The
  // newer take owns the refs by then.
  it("skips a stale generation even when the recorder is inactive", () => {
    expect(
      decideInterruptFinalize({
        recorderState: "inactive",
        isCurrentGeneration: false,
      })
    ).toBe("skip-stale");
  });

  it("skips a stale generation while the recorder is still active", () => {
    expect(
      decideInterruptFinalize({
        recorderState: "recording",
        isCurrentGeneration: false,
      })
    ).toBe("skip-stale");
  });

  it("decides for every lifecycle state the recorder can report", () => {
    // Exhaustive over the union, so a future state added to
    // `RecorderLifecycleState` cannot fall through this suite untested.
    const states: readonly RecorderLifecycleState[] = [
      "inactive",
      "recording",
      "paused",
    ];
    for (const recorderState of states) {
      expect(
        decideInterruptFinalize({ recorderState, isCurrentGeneration: true })
      ).not.toBe("skip-stale");
    }
  });
});
