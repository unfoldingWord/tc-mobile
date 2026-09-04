import { describe, expect, it } from "vitest";

import {
  preemptPausedMic,
  reclaimAfterPreview,
  reclaimMic,
} from "@/lib/audio/floor-transitions";
import {
  createAudioSession,
  type AudioSession,
  type Stoppable,
} from "@/lib/audio/session";

/**
 * The approach-B floor transitions the paused-take preview (#101) performs,
 * tested against the REAL arbiter — not a manual `stopAll`/`claim` sequence, so a
 * mutation that drops `preemptPausedMic`'s `stopAll` or `reclaimMic`'s `claim`
 * dies here (Frank R6). What stays on-device is the hook CALLING these and the
 * browser wiring around them; the floor decisions are covered here.
 */

/** A stand-in playback handle that records how often it was stopped. */
function handle(): Stoppable & { stops: number } {
  return {
    stops: 0,
    stop() {
      this.stops++;
    },
  };
}

describe("preemptPausedMic", () => {
  it("releases a paused mic's floor claim so a take can then claim", () => {
    const session = createAudioSession();
    session.claim("mic"); // a paused take holds the floor
    expect(session.claim("take")).toBeNull(); // refused before the preempt

    const token = preemptPausedMic(session, true, 7);

    expect(token).toBeNull(); // the mic token is surrendered
    expect(session.live).toBeNull(); // floor released (the mic itself has no handle to stop)
    expect(session.claim("take")).not.toBeNull(); // the preview is now admitted
  });

  it("does NOT preempt a LIVE recording", () => {
    const session = createAudioSession();
    session.claim("mic");

    const token = preemptPausedMic(session, false, 7); // recorder not paused

    expect(token).toBe(7); // token unchanged
    expect(session.live).toBe("mic"); // the live mic keeps the floor
  });

  it("is a no-op when the floor is not the mic's", () => {
    const session = createAudioSession();
    session.claim("take"); // playback holds the floor

    const token = preemptPausedMic(session, true, null);

    expect(token).toBeNull(); // unchanged
    expect(session.live).toBe("take"); // untouched
  });
});

describe("reclaimMic", () => {
  it("reclaims the floor from a sounding preview and stops it", () => {
    const session = createAudioSession();
    session.claim("mic");
    session.stopAll(); // a preview released the mic's claim
    const token = session.claim("take") as number; // the preview holds the floor
    const preview = handle();
    session.settle(token, preview);

    const result = reclaimMic(session, null);

    expect(result.reclaimed).toBe(true);
    expect(result.token).not.toBeNull();
    expect(preview.stops).toBe(1); // reclaiming stopped the preview
    expect(session.live).toBe("mic");
    expect(session.isCurrent(token)).toBe(false); // the preview's token is superseded
  });

  it("is a no-op when the mic already holds the floor (plain pause→resume)", () => {
    const session = createAudioSession();
    const micToken = session.claim("mic") as number;

    const result = reclaimMic(session, micToken);

    expect(result.reclaimed).toBe(false);
    expect(result.token).toBe(micToken); // the current token stands
    expect(session.live).toBe("mic");
  });
});

/**
 * #129 / George G1 — every way a preview ends must hand the floor back.
 *
 * This pins `reclaimAfterPreview`, the GATE the hook now delegates to at all
 * three exits (natural end, user stop, decode failure). It does NOT pin the hook
 * calling it: the three call sites in `use-audio-session.ts` are browser wiring
 * and remain review + on-device surface. Round 1 flagged the earlier version of
 * this case for claiming otherwise (Frank F1, George G2); the gate lives in lib
 * now precisely so the decision is testable in Node.
 */
describe("reclaimAfterPreview", () => {
  /** Preempt a paused mic, sound a preview, and give the floor back. */
  function afterPreview(): { session: AudioSession; micToken: number | null } {
    const session = createAudioSession();
    session.claim("mic"); // a paused take holds the floor
    const micToken = preemptPausedMic(session, true, 1); // the preview borrows it
    const token = session.claim("take") as number;
    session.settle(token, handle());
    session.release(token); // the preview is over; the floor is now free
    expect(session.live).toBeNull(); // the gap #129 names
    return { session, micToken };
  }

  it("reclaims for a paused mic, so a preempt-less take is refused again", () => {
    const { session, micToken } = afterPreview();

    const token = reclaimAfterPreview(session, true, micToken);

    expect(token).not.toBeNull();
    expect(session.live).toBe("mic");
    expect(session.claim("take")).toBeNull(); // the invariant is restored
  });

  it("does NOT claim a floor for a recorder that is no longer paused", () => {
    // The stale-state hazard: a mic that has already stopped must not be handed
    // a claim nothing will ever release.
    const { session, micToken } = afterPreview();

    const token = reclaimAfterPreview(session, false, micToken);

    expect(token).toBe(micToken); // unchanged
    expect(session.live).toBeNull(); // floor left free
    expect(session.claim("take")).not.toBeNull(); // playback still possible
  });

  it("is a no-op when the mic never lost the floor (no preview ran)", () => {
    const session = createAudioSession();
    const micToken = session.claim("mic") as number;

    const token = reclaimAfterPreview(session, true, micToken);

    expect(token).toBe(micToken); // the current claim stands
    expect(session.live).toBe("mic");
  });
});
