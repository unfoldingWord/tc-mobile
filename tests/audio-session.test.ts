import { describe, expect, it } from "vitest";

import { createAudioSession, type Stoppable } from "@/lib/audio/session";

/**
 * The arbiter is pure, so the races that produced issues #2, #3 and #10 can be
 * replayed here deterministically — the interleavings that need a slow phone
 * and a fast thumb in the field are just call order in Node.
 *
 * What is NOT covered here, and is not coverable: everything the hook does
 * with the result. There is no jsdom and no renderer in this project, and
 * jsdom implements neither MediaRecorder nor AudioContext, so `useAudioSession`
 * and the screens can only be verified on-device — and as of 2026-08-22 that
 * check has not been run: nothing in this project has touched real hardware.
 * See AGENTS.md.
 *
 * In particular, "the session never stops the microphone" is not asserted
 * below and cannot be: it is a property of `hooks/use-audio-session.ts`, which
 * never settles a mic handle, not of the arbiter, which has no idea what kind
 * of handle it was given. What is asserted here is the part the arbiter can
 * break — that `claim("mic")` is never refused, that playback is refused while
 * the mic holds the floor, and that a playback handle arriving after the mic
 * claimed is stopped rather than adopted.
 */

/** A stand-in for a playback handle that records how often it was stopped. */
function handle(): Stoppable & { stops: number } {
  return {
    stops: 0,
    stop() {
      this.stops++;
    },
  };
}

describe("createAudioSession", () => {
  it("starts with nothing live", () => {
    const session = createAudioSession();
    expect(session.live).toBeNull();
  });

  it("keeps the handle that settled last and stops the one that lost", () => {
    // Issue #2, verbatim: tap section A, tap section B, and B's clip finishes
    // loading first. Both claims were opened before either resolved.
    const session = createAudioSession();
    const a = session.claim("take");
    const b = session.claim("take");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    const hA = handle();
    const hB = handle();

    expect(session.settle(b as number, hB)).toBe(true);
    expect(session.settle(a as number, hA)).toBe(false);

    // A's source is stopped by the session itself rather than being handed
    // back to a caller who might drop it and leave it sounding forever.
    expect(hA.stops).toBe(1);
    expect(hB.stops).toBe(0);

    // The other half of the name, and the half that carries issue #2's actual
    // symptom: B has to be the handle the session can still reach. A stale
    // branch that stops the loser *and* adopts it leaves both assertions above
    // true while the winner plays on with nothing able to silence it, so the
    // floor is asked directly — `stopAll` is what `leave()` and the pagehide
    // handler call.
    session.stopAll();
    expect(hB.stops).toBe(1);
    expect(hA.stops).toBe(1);
    expect(session.live).toBeNull();
  });

  it("invalidates the superseded token", () => {
    const session = createAudioSession();
    const a = session.claim("take") as number;
    const b = session.claim("take") as number;
    expect(session.isCurrent(a)).toBe(false);
    expect(session.isCurrent(b)).toBe(true);
  });

  it("stops the live source and orphans in-flight ones on stopAll", () => {
    // Issues #3 and #10: navigating away while a clip is still being read.
    const session = createAudioSession();
    const live = handle();
    const first = session.claim("take") as number;
    session.settle(first, live);

    const inFlight = session.claim("take") as number;
    session.stopAll();

    expect(live.stops).toBe(1);
    expect(session.live).toBeNull();

    const late = handle();
    expect(session.settle(inFlight, late)).toBe(false);
    expect(late.stops).toBe(1);
  });

  it("lets the microphone take the floor from playback", () => {
    const session = createAudioSession();
    const take = handle();
    session.settle(session.claim("take") as number, take);

    expect(session.claim("mic")).not.toBeNull();
    expect(take.stops).toBe(1);
    expect(session.live).toBe("mic");
  });

  it("refuses playback while the microphone holds the floor", () => {
    // George's case: a take must not begin playing after recording has started,
    // and that has to be an invariant rather than a consequence of which
    // buttons the section view happens to be rendering.
    const session = createAudioSession();
    session.claim("mic");

    expect(session.claim("take")).toBeNull();
    expect(session.claim("reference")).toBeNull();
    expect(session.live).toBe("mic");

    // Nothing outranks the microphone, including the microphone: session.ts:14
    // states `claim("mic")` always succeeds, and narrowing that guard to
    // `liveKind === "mic"` is a one-word change no other test here sees. The
    // hook ignores this token (`startRecording`, use-audio-session.ts:226) and
    // starts the recorder regardless, but `claimFloor` returns early on a null
    // token and so skips clearing `playing`, `reference` and `playbackError`
    // (use-audio-session.ts:100-108) — capture would begin under a stale
    // playback UI.
    expect(session.claim("mic")).not.toBeNull();
    expect(session.live).toBe("mic");

    session.stopAll();
    expect(session.claim("take")).not.toBeNull();
  });

  it("refuses a playback handle that settles after the microphone took the floor", () => {
    // The window this closes: tap play, then start recording before the clip
    // has finished loading. The take must not begin under a live recording,
    // and the mic must not end up holding a playback handle — `stopAll` would
    // then stop a source that recording already superseded, and the arbiter's
    // "never stops the microphone itself" rule would have a handle to break.
    const session = createAudioSession();
    const late = session.claim("take") as number;
    session.claim("mic");

    const h = handle();
    expect(session.settle(late, h)).toBe(false);
    expect(h.stops).toBe(1);
    expect(session.live).toBe("mic");

    // Nothing was adopted, so releasing the mic's claim stops nothing at all.
    expect(() => session.stopAll()).not.toThrow();
    expect(h.stops).toBe(1);
    expect(session.live).toBeNull();
  });

  it("makes the take and the reference mutually exclusive", () => {
    const session = createAudioSession();
    const take = handle();
    session.settle(session.claim("take") as number, take);

    const reference = handle();
    session.settle(session.claim("reference") as number, reference);
    expect(take.stops).toBe(1);
    expect(session.live).toBe("reference");

    const second = handle();
    session.settle(session.claim("take") as number, second);
    expect(reference.stops).toBe(1);
    expect(session.live).toBe("take");
  });

  it("frees the floor when a source releases its own token", () => {
    // What playback's onEnded does: the clip finished on its own, so nothing
    // needs stopping, but the floor has to go back.
    const session = createAudioSession();
    const h = handle();
    const token = session.claim("take") as number;
    session.settle(token, h);

    session.release(token);
    expect(h.stops).toBe(0);
    expect(session.live).toBeNull();
    expect(session.isCurrent(token)).toBe(false);
  });

  it("ignores a release from a token that no longer holds the floor", () => {
    const session = createAudioSession();
    const stale = session.claim("take") as number;
    const current = handle();
    const token = session.claim("reference") as number;
    session.settle(token, current);

    session.release(stale);
    expect(session.live).toBe("reference");
    expect(session.isCurrent(token)).toBe(true);
    expect(current.stops).toBe(0);
  });

  it("stops nothing twice", () => {
    const session = createAudioSession();
    const h = handle();
    const token = session.claim("take") as number;

    expect(session.settle(token, h)).toBe(true);
    expect(session.settle(token, h)).toBe(true);
    session.stopAll();
    session.stopAll();
    session.release(token);

    expect(h.stops).toBe(1);
    expect(session.live).toBeNull();
  });
});
