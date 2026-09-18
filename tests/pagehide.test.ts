import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pageHideAction } from "@/lib/audio/pagehide";
import type { CaptureState } from "@/lib/takes/close-plan";

/**
 * What a `pagehide` owes the capture, as a table (#58).
 *
 * The defect this pins: the handler used to call `leave()` — and so
 * `cancelRecording()` — on EVERY `pagehide`, ignoring `event.persisted`. Under
 * the F8 commit-on-close model nothing has been written yet, so a page the
 * browser only SUSPENDED (bfcache: `persisted === true`, restorable intact via
 * `pageshow`) took a multi-minute take with it and left no recovery slot.
 *
 * The decision is pure and lives here so every cell is checked in plain Node.
 * What the hook then DOES with the verdict — `leave()`, `pauseRecording()`,
 * silencing playback — is browser wiring, and the `pause()`/`resume()` calls it
 * makes are only meaningful against a real `MediaRecorder`. Nothing below is
 * evidence about a device; see the test file's sibling note in
 * `tests/audio-session.test.ts` and the PR body's device-checks section.
 */

/**
 * Every `CaptureState` and what it owes a PERSISTED `pagehide`, as a TOTAL map.
 *
 * `Record<CaptureState, ...>` is the load-bearing part (George R1 P3-4). A bare
 * `readonly CaptureState[]` was a subset assignment: a sixth member of the union
 * still typechecked, so the comment claiming "a state added to the union cannot
 * skip the table" was a comment that cost CI time rather than a gate. With the
 * `satisfies`, a new state is a missing property — a type error in THIS file as
 * well as in the implementation's exhaustive switch.
 *
 * Spelled against `ReturnType<typeof pageHideAction>` rather than an imported
 * action union: the module exports one function, and an exported type only a
 * test imports is dead surface that knip's entry-point rule cannot see through.
 */
const WHEN_PERSISTED = {
  idle: "none",
  requesting: "release",
  recording: "pause",
  paused: "none",
  processing: "none",
} satisfies Record<CaptureState, ReturnType<typeof pageHideAction>>;

const STATES = Object.keys(WHEN_PERSISTED) as CaptureState[];

describe("pageHideAction", () => {
  it("releases everything from every state when the page is NOT persisted", () => {
    // A real teardown — the page is going away and may never come back. This is
    // byte-identical to the pre-#58 behaviour, on purpose: a hot microphone on a
    // page that is being discarded is not arguable, and there is no platform
    // guarantee that an async stop → decode → write started here would finish.
    for (const state of STATES) {
      expect(pageHideAction(state, false)).toBe("release");
    }
  });

  it("answers every state the same way the map does when it IS persisted", () => {
    for (const [state, action] of Object.entries(WHEN_PERSISTED)) {
      expect(pageHideAction(state as CaptureState, true)).toBe(action);
    }
  });

  it("pauses a live take when the page IS persisted", () => {
    // The whole of #58. `pause()` keeps the recorder, the stream and the chunks
    // alive, so a `pageshow` restore finds a take the existing Resume control
    // continues and the existing close path commits.
    expect(pageHideAction("recording", true)).toBe("pause");
  });

  it("leaves a paused take alone when the page IS persisted", () => {
    // The mic is already suspended-but-held and still owns the floor; pausing a
    // paused recorder is a no-op and releasing would discard the take.
    expect(pageHideAction("paused", true)).toBe("none");
  });

  it("never disturbs a processing take when the page IS persisted", () => {
    // `processing` is where a #59 mic interruption freezes a REAL take whose
    // chunks `stop()` still recovers. "release" here would call `cancel()` and
    // throw those away — the same loss this issue is about, one state over.
    expect(pageHideAction("processing", true)).toBe("none");
  });

  it("does nothing from idle when the page IS persisted", () => {
    // Nothing has been captured: idle has no recorder and nothing to release.
    expect(pageHideAction("idle", true)).toBe("none");
  });

  it("releases a not-yet-recording mic from requesting when the page IS persisted (George R3 P2-1)", () => {
    // `requesting` spans TWO windows inside `start()`: the `getUserMedia`
    // prompt (no stream yet — a frozen page cannot resolve it either way, and
    // `cancel()`'s generation bump is what makes a late resolve abandon the
    // stream it just opened) and, after the grant, the `await
    // raceAudioResume()` window where `streamRef` already holds a live stream
    // but no recorder exists yet. "none" would leave a granted, hot
    // microphone that nothing in the UI can reach — `release` is the pre-#58
    // behaviour, kept for both windows.
    expect(pageHideAction("requesting", true)).toBe("release");
  });
});

/**
 * The one wiring fact about `recorder.tsx`'s preview auto-play that a pure
 * table cannot hold (George R3 P2-2), asserted against the SOURCE TEXT — the
 * same shape and comment-stripping as `tests/recorder-resume-race.test.ts`
 * and `tests/pause-plan.test.ts`'s `stop()` gate, because the alternative is
 * no gate at all: this repo has no renderer, so this `if` is unreachable from
 * Node.
 *
 * What it pins: the auto-play `if` that follows a preview decode checks
 * `document.visibilityState === "visible"` alongside `audio.audioNeedsGesture()`.
 * Deleting the visibility conjunct, or moving it out of this `if`, must fail
 * here.
 *
 * What it does NOT pin, and cannot: that the conjunct actually stops a sound
 * from a real hidden page, that `document.visibilityState` reads correctly
 * across every engine, or any other runtime behaviour — this repo has no
 * renderer in its test suite. This is a TEXTUAL gate only.
 */
describe("recorder.tsx's preview auto-play refuses a hidden page (#58, George R3 P2-2)", () => {
  const sourceUrl = new URL("../src/components/recorder.tsx", import.meta.url);
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const source = () => stripComments(readFileSync(sourceUrl, "utf8"));

  it("gates the preview auto-play on page visibility as well as the gesture check", () => {
    const code = source();
    const gestureAt = code.indexOf("audio.audioNeedsGesture()");
    const visibilityAt = code.indexOf('document.visibilityState === "visible"');
    // Both anchors asserted present FIRST. Without this, deleting either one
    // makes `indexOf` return -1, which is "less than" any real index and
    // would pass a naive distance check — the exact trap
    // `tests/pause-plan.test.ts` names for `stop()`'s gate.
    expect(gestureAt).toBeGreaterThan(-1);
    expect(visibilityAt).toBeGreaterThan(-1);
    // The two checks must be close together — in the same `if` — not merely
    // present somewhere in a file this large. A generous window that still
    // fails if either anchor moves into an unrelated branch.
    expect(Math.abs(gestureAt - visibilityAt)).toBeLessThan(200);
  });
});
