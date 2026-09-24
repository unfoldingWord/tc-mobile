import { describe, expect, it } from "vitest";

import { classifyStopDecode } from "@/lib/audio/stop-decode";

/**
 * The #106/#165 data-loss contract, extracted from the browser-bound `stop()` so
 * these tests can exercise the decision without mounting the recorder hook.
 *
 * The load-bearing row is the SUPERSEDED THROW: a decode that rejected keeps the
 * container bytes even when the stop was superseded, because a `leave()`/pagehide
 * bumping the generation mid-decode is the very #106 interruption most likely to
 * fail it. Re-gate `keepBlob` on `current` and that row dies — which is exactly
 * the regression that would silently re-drop the interruption case.
 */
describe("classifyStopDecode", () => {
  it("keeps the bytes on a decode throw — EVEN WHEN SUPERSEDED (#106/#165)", () => {
    // The mutation that must fail: this is the only-copy case, and dropping it on
    // a superseded stop is the loss #165 exists to prevent.
    expect(classifyStopDecode({ decoded: false }, false)).toEqual({
      emitSamples: false,
      error: null, // superseded — a newer owner speaks for the screen
      keepBlob: true,
    });
  });

  it("keeps the bytes on a decode throw on a current stop, with a message", () => {
    expect(classifyStopDecode({ decoded: false }, true)).toEqual({
      emitSamples: false,
      error: "undecodable",
      keepBlob: true,
    });
  });

  it("keeps NOTHING on a decode to silence — a retry of the same bytes can't help", () => {
    expect(classifyStopDecode({ decoded: true, sampleCount: 0 }, true)).toEqual(
      {
        emitSamples: false,
        error: "silence",
        keepBlob: false,
      }
    );
    // Superseded silence is silent about it too.
    expect(
      classifyStopDecode({ decoded: true, sampleCount: 0 }, false)
    ).toEqual({ emitSamples: false, error: null, keepBlob: false });
  });

  it("emits usable samples — even when superseded — and keeps no blob", () => {
    expect(
      classifyStopDecode({ decoded: true, sampleCount: 42 }, true)
    ).toEqual({ emitSamples: true, error: null, keepBlob: false });
    // Confirmed samples are returned to the caller regardless of supersession.
    expect(
      classifyStopDecode({ decoded: true, sampleCount: 42 }, false)
    ).toEqual({ emitSamples: true, error: null, keepBlob: false });
  });
});
