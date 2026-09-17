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

/** Every `CaptureState`, so a state added to the union cannot skip the table. */
const STATES: readonly CaptureState[] = [
  "idle",
  "requesting",
  "recording",
  "paused",
  "processing",
];

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

  it("does nothing from idle or requesting when the page IS persisted", () => {
    // Nothing has been captured: `idle` has no recorder, and `requesting` is a
    // `getUserMedia` await that a freeze cannot resolve either way.
    expect(pageHideAction("idle", true)).toBe("none");
    expect(pageHideAction("requesting", true)).toBe("none");
  });
});
