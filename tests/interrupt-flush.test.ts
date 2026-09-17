import { describe, expect, it } from "vitest";

import {
  decideInterruptFinalize,
  type InterruptFinalizeDecision,
  planStopFlush,
  type RecorderLifecycleState,
  type StopFlushPlan,
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
    // Exhaustive at COMPILE time, not by hand: a `Record` over the union means
    // adding a state to `RecorderLifecycleState` without adding it here fails
    // `npm run typecheck`. A hand-written array would have type-checked while
    // silently stopping short of the new state, so the claim in this test's
    // name would have quietly become false (Frank R1 P3).
    const expected: Record<RecorderLifecycleState, InterruptFinalizeDecision> =
      {
        inactive: "already-flushed",
        recording: "drive-flush",
        paused: "drive-flush",
      };
    // Indexing `expected` is what ties each literal below to the union: a state
    // that is not a key of the record is a type error here too.
    for (const recorderState of ["inactive", "recording", "paused"] as const) {
      expect(
        decideInterruptFinalize({ recorderState, isCurrentGeneration: true })
      ).toBe(expected[recorderState]);
      // And the generation always wins, whatever the state.
      expect(
        decideInterruptFinalize({ recorderState, isCurrentGeneration: false })
      ).toBe("skip-stale");
    }
  });
});

/**
 * `stop()`'s side of the same handshake. The reason this is a separate pure
 * decision rather than an `if` in the hook: it is the only place a reviewer can
 * CHECK the invariant the whole change rests on — that with no driven flush
 * outstanding, `stop()` takes exactly the branch it took before this change.
 */
describe("planStopFlush", () => {
  // The invariant, as a table over the entire input space. The `satisfies
  // Record<...>` makes the lifecycle half exhaustive at compile time: adding a
  // state to `RecorderLifecycleState` without adding a row fails
  // `npm run typecheck` rather than silently skipping the new state.
  const table = {
    inactive: { owned: "await-driven-flush", free: "seal-inactive" },
    recording: { owned: "await-driven-flush", free: "drive-stop" },
    paused: { owned: "await-driven-flush", free: "drive-stop" },
  } satisfies Record<
    RecorderLifecycleState,
    { readonly owned: StopFlushPlan; readonly free: StopFlushPlan }
  >;

  it("leaves stop() on exactly its pre-existing branch when no driven flush owns the recorder", () => {
    // THE LOAD-BEARING CASE. `"seal-inactive"` and `"drive-stop"` are the two
    // arms `stop()` has always had, and this pins that the choice between them
    // still turns on `recorderState === "inactive"` and nothing else. If this
    // test ever needs changing, the iOS-verified interruption path has moved.
    for (const recorderState of ["inactive", "recording", "paused"] as const) {
      expect(
        planStopFlush({ recorderState, drivenFlushOwnsRecorder: false })
      ).toBe(table[recorderState].free);
    }
  });

  it("hands teardown to the driven flush from every state, including a recorder its stop() left live", () => {
    // Includes `"recording"`/`"paused"`: if the driven `recorder.stop()` threw,
    // the recorder never went inactive, but the flush still owns its tracks,
    // its timer and its `onstop`. Falling through to `"drive-stop"` there would
    // issue a second stop and overwrite the handler the flush is waiting on
    // (George R1 P2, use-recorder.ts:914).
    for (const recorderState of ["inactive", "recording", "paused"] as const) {
      expect(
        planStopFlush({ recorderState, drivenFlushOwnsRecorder: true })
      ).toBe(table[recorderState].owned);
    }
  });

  it("never plans a second stop while a driven flush is outstanding", () => {
    for (const recorderState of ["inactive", "recording", "paused"] as const) {
      expect(
        planStopFlush({ recorderState, drivenFlushOwnsRecorder: true })
      ).not.toBe("drive-stop");
    }
  });
});
