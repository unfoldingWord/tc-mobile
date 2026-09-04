import { describe, expect, it, vi } from "vitest";

import {
  EncoderStalledError,
  encodeDeadlineMs,
  withDeadline,
} from "@/hooks/mp3-codec";

/**
 * The encode deadline (#166).
 *
 * A worker that neither answers nor errors — killed under memory pressure, a
 * chunk that never loads — used to hold the single encoder lane forever, so
 * every later Share and the Finished sweep wedged with no signal. `withDeadline`
 * is the seam that bounds every encode: pure promise/timer plumbing with no
 * Worker or DOM, so it is unit-testable here. In production `encodeWithDeadline`
 * gives it the worker round-trip and `recoverEncoderWorker` (terminate + re-warm,
 * the same recovery the abort path runs) as its `onDeadline`; the concrete
 * terminate is browser-verified, the timing logic is proved here.
 */
describe("encode deadline (#166)", () => {
  it("trips the deadline and runs recovery when the encode never settles", async () => {
    const recover = vi.fn();
    const never = new Promise<Uint8Array<ArrayBuffer>>(() => {});
    const bounded = withDeadline(never, 20, recover);
    await expect(bounded).rejects.toBeInstanceOf(EncoderStalledError);
    // The recovery path (in production: terminate the wedged worker + re-warm)
    // fires exactly once on a breach — this is what releases the lane.
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("resolves a normal encode in time and never recovers", async () => {
    const recover = vi.fn();
    const out = new Uint8Array([1, 2, 3]);
    await expect(withDeadline(Promise.resolve(out), 50, recover)).resolves.toBe(
      out
    );
    // Wait past the deadline: the timer must have been cleared on success.
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(recover).not.toHaveBeenCalled();
  });

  it("propagates a worker's own rejection without recovering", async () => {
    const recover = vi.fn();
    const boom = new Error("the encoder threw");
    await expect(withDeadline(Promise.reject(boom), 50, recover)).rejects.toBe(
      boom
    );
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(recover).not.toHaveBeenCalled();
  });

  it("floors a tiny clip's deadline and grows it with the audio's length", () => {
    const tiny = encodeDeadlineMs(1);
    const oneMinute = encodeDeadlineMs(44_100 * 60);
    const tenMinutes = encodeDeadlineMs(44_100 * 600);
    // A near-empty clip still gets the floor, never a near-zero deadline that a
    // cold worker start would trip.
    expect(tiny).toBeGreaterThanOrEqual(1_000);
    // Proportional: more audio, more time, so a long chapter is not killed for
    // being long while a wedged worker still is.
    expect(oneMinute).toBeGreaterThan(tiny);
    expect(tenMinutes).toBeGreaterThan(oneMinute);
  });
});
