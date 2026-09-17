import { describe, expect, it } from "vitest";

import { playbackPosition } from "@/lib/audio/playback-position";

/**
 * The audio boundary's one honest answer about where playback is (George R4
 * P1, the class the DRI sent round 5 to close).
 *
 * `playBuffer` flips its sounding flag optimistically, so the control responds
 * to the tap rather than to the graph, and the real handle settles only after a
 * context resume, a synchronous whole-clip AudioBuffer fill and a yielded task
 * — a window that grows with the clip and that `audio-io.ts` yields in order to
 * MAKE tap-reachable. For that window the boundary used to answer a bare `0`,
 * and two consumers read it as two different claims: the overlay as "draw the
 * line at the start" (true) and the recorder's freeze as "playback reached
 * sample 0" (an assumption), which it then wrote into `panState` — the record
 * insertion offset. The default Play from the F7 rest became a punch-in at the
 * first sample.
 *
 * The hook cannot be unit-tested here (no renderer, no AudioContext in Node),
 * so the DECISION lives in `lib/` where it can be, and the hook is left with
 * two ref reads.
 */
describe("playbackPosition", () => {
  it("reports a real handle's position as measured", () => {
    expect(playbackPosition(1234, true)).toEqual({ ms: 1234, measured: true });
  });

  it("reports the pre-start window as the start, but NOT measured", () => {
    // Both halves matter. `ms: 0` is what a drawer needs — the play has not
    // moved off its start, and the line must not vanish for that window. The
    // `measured: false` is what stops a rememberer from writing it down.
    expect(playbackPosition(null, true)).toEqual({ ms: 0, measured: false });
  });

  it("answers null when nothing is sounding — the hide sentinel", () => {
    // Distinct from position 0 (#102, George R2): the handle is cleared a React
    // commit before the overlay's `active` prop goes false, so a 0 here would
    // snap the line to the left edge for a frame on every stop.
    expect(playbackPosition(null, false)).toBeNull();
  });

  it("trusts a handle even at exactly zero", () => {
    // A handle that has genuinely reported 0 — a play sampled in its first
    // frame — IS measured. The gate is "did the graph answer", not "is the
    // number nonzero": treating 0 as unmeasured would leave a real stop at the
    // start of a range unable to freeze.
    expect(playbackPosition(0, true)).toEqual({ ms: 0, measured: true });
  });
});
