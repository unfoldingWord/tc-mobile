import { describe, expect, it } from "vitest";

import { preemptPausedMic, reclaimMic } from "@/lib/audio/floor-transitions";
import { createAudioSession, type Stoppable } from "@/lib/audio/session";

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
