import { readFileSync } from "node:fs";

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
  /** The take is still the recorder's own live capture. */
  live: {
    recording: "pause-and-freeze",
    paused: "freeze-only",
    inactive: "ignore",
  },
  /** Another exit has already claimed it — pause is not the one to answer. */
  claimed: {
    recording: "ignore",
    paused: "ignore",
    inactive: "ignore",
  },
} satisfies Record<
  "live" | "claimed",
  Record<Parameters<typeof pausePlan>[0], ReturnType<typeof pausePlan>>
>;

describe("pausePlan", () => {
  it("pauses and freezes a recorder that is actually recording", () => {
    // Unchanged from before #58: the Record control's path, byte for byte.
    expect(pausePlan("recording", true)).toBe("pause-and-freeze");
  });

  it("freezes WITHOUT a native pause when the recorder is already paused", () => {
    // Calling `MediaRecorder.pause()` again would throw an InvalidStateError,
    // but the freeze the rest of the recorder assumes — the stopped tick, the
    // banked elapsed, the frozen scope, `state === "paused"` — still has to
    // happen, or the UI keeps rendering a live take.
    expect(pausePlan("paused", true)).toBe("freeze-only");
  });

  it("ignores an inactive recorder", () => {
    // A recorder that went inactive on its own is a #59 mic interruption, and
    // `onInterrupted` owns it: it takes the recorder to `"processing"`, where
    // `stop()` still recovers the chunks. Freezing to `"paused"` here would paint
    // a Resume the recorder cannot honour over a take that already has a
    // recovery path.
    expect(pausePlan("inactive", true)).toBe("ignore");
  });

  it("refuses every state once another exit has claimed the take", () => {
    // George R2 P2-1. `onInterrupted` fires on `MediaRecorder.onerror` too, and
    // THAT arm is written for a recorder still natively "recording" — it sets
    // `recordingRef` false and `setState("processing")` without touching
    // `recorderStateRef`. A persisted `pagehide` in the same hide transition then
    // read "recording", planned "pause-and-freeze", and `setState("paused")` won
    // the race: Resume painted over a take #59 had already declared dead, on a
    // recorder it cannot honour.
    //
    // `recording` is the row that closes it. The other two are not reachable by
    // that race — an interrupted-and-inactive recorder was already "ignore", and
    // nothing claims a take and leaves the recorder natively paused — but they
    // are asserted so the refusal is a property of the input, not a special case
    // bolted onto one cell.
    expect(pausePlan("recording", false)).toBe("ignore");
    expect(pausePlan("paused", false)).toBe("ignore");
    expect(pausePlan("inactive", false)).toBe("ignore");
  });

  it("covers every state in both claims, so a new one cannot be skipped", () => {
    for (const [claim, states] of Object.entries(PLANS)) {
      for (const [state, plan] of Object.entries(states)) {
        expect(
          pausePlan(state as Parameters<typeof pausePlan>[0], claim === "live")
        ).toBe(plan);
      }
    }
  });
});

/**
 * The one wiring fact about `stop()` that a pure table cannot hold (George R2
 * P2-2), asserted against the SOURCE TEXT — the same shape and the same
 * comment-stripping as `tests/recorder-resume-race.test.ts`, because the
 * alternative is no gate at all: this repo has no renderer, so `stop()`'s body
 * is unreachable from Node.
 *
 * What it pins: `stop()` re-arms the shared audio context, un-awaited, before it
 * yields. Deleting the call, awaiting it, moving it below the first `await`, or
 * emptying its `catch` must each fail here.
 *
 * What it does NOT pin, and cannot: that the context is actually interrupted
 * after a bfcache restore, that a fire-and-forget resume has settled by the time
 * `decodeAudioData` runs, or that a system Back carries a gesture at all. Those
 * are device facts, listed in the PR.
 */
describe("stop() re-arms the audio context in the gesture (#58 / George R2 P2-2)", () => {
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  /** `stop()`'s body alone, brace-counted out of the stripped source. */
  const stopBody = (): string => {
    const code = stripComments(readFileSync(sourceUrl, "utf8"));
    const declStart = code.indexOf("const stop = useCallback");
    expect(declStart).toBeGreaterThan(-1);
    const braceOpen = code.indexOf("{", declStart);
    expect(braceOpen).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = braceOpen; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) return code.slice(braceOpen, i + 1);
      }
    }
    throw new Error("stop()'s body is not brace-balanced");
  };

  it("calls resumeAudioContext exactly once, and never awaits it", () => {
    const body = stopBody();
    const calls = body.match(/resumeAudioContext\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // An unbounded await here would be #108 one function over. The repo-wide ban
    // lives in `recorder-resume-race.test.ts`; this asserts it locally so a
    // reader of THIS call site sees the constraint it is under.
    expect(body).not.toMatch(/await\s+resumeAudioContext\s*\(/);
  });

  it("fires it before stop() yields, so it is spent inside the caller's gesture", () => {
    // The whole point: iOS will not honour an un-suspend once the activation is
    // gone, and every `await` below this line is a chance to lose it. Moving the
    // call down past the flush — where it would be useless — must fail this.
    const body = stopBody();
    const resumeAt = body.indexOf("resumeAudioContext");
    const firstAwaitAt = body.indexOf("await");
    // Both anchors asserted present FIRST. Without this, deleting the call
    // outright makes `indexOf` return -1, which is "less than" any index and
    // passes — a gate that goes green on the state it exists to catch. The
    // deletion mutation found exactly that here.
    expect(resumeAt).toBeGreaterThan(-1);
    expect(firstAwaitAt).toBeGreaterThan(-1);
    expect(resumeAt).toBeLessThan(firstAwaitAt);
  });

  it("routes a rejected resume to a sink rather than swallowing it", () => {
    // AGENTS.md: never swallow an error silently. Mirrors `resume()`'s own
    // handling exactly — an empty `.catch(() => {})` must fail this.
    expect(stopBody()).toMatch(/resumeAudioContext\s*\(\s*\)\s*\.catch\s*\(/);
  });
});
