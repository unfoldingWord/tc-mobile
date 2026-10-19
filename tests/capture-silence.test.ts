import { describe, expect, it } from "vitest";

import {
  CAPTURE_SILENCE_MAX_GAP_MS,
  CAPTURE_SILENCE_MS,
  createSilenceWindow,
  isDigitalSilence,
  type SilenceWindow,
} from "@/lib/audio/capture-silence";

/**
 * The pure half of R13 on #1294: a capture that an alarm stopped without any
 * event reads as exact digital zeros on a running, advancing clock. The
 * window says so once, after five seconds of wall time. The value is written
 * as a literal here on purpose, so moving the constant is a visible change to
 * this file as well.
 */
describe("isDigitalSilence", () => {
  it("is true only when every sample is exactly zero", () => {
    expect(isDigitalSilence(new Float32Array(8))).toBe(true);
    const quiet = new Float32Array(8);
    quiet[5] = 1e-7;
    expect(isDigitalSilence(quiet)).toBe(false);
    expect(isDigitalSilence(new Float32Array([0, -0, 0]))).toBe(true);
  });

  it("an empty frame is not evidence of anything", () => {
    expect(isDigitalSilence(new Float32Array(0))).toBe(false);
  });

  it("NaN is not silence", () => {
    expect(isDigitalSilence(new Float32Array([0, Number.NaN]))).toBe(false);
  });
});

/**
 * Note silent samples every 100 ms from `from` to `to` inclusive, the clock
 * read through `clockAt`; the result of the last note.
 */
function pull(
  window: SilenceWindow,
  from: number,
  to: number,
  clockAt: (t: number) => number = (t) => t / 1000
): boolean {
  let last = false;
  for (let t = from; t <= to; t += 100) {
    last = window.note(true, t, clockAt(t));
  }
  return last;
}

describe("createSilenceWindow", () => {
  it("the window is five seconds, its gap bound one second", () => {
    expect(CAPTURE_SILENCE_MS).toBe(5000);
    expect(CAPTURE_SILENCE_MAX_GAP_MS).toBe(1000);
  });

  it("fires once at five seconds of zeros on an advancing clock, not one millisecond before", () => {
    const window = createSilenceWindow();
    expect(pull(window, 0, 4900)).toBe(false);
    expect(window.note(true, 4999, 4.999)).toBe(false);
    expect(window.note(true, 5000, 5)).toBe(true);
    // Latched: the caller seals once.
    expect(pull(window, 5100, 9000)).toBe(false);
  });

  it("any non-silent sample restarts the run", () => {
    const window = createSilenceWindow();
    pull(window, 0, 4000);
    window.note(false, 4100, 4.1);
    // The new run starts at the first silent sample after the reset.
    expect(pull(window, 4200, 9100)).toBe(false);
    expect(window.note(true, 9200, 9.2)).toBe(true);
  });

  it("a clock that has not moved across the run never fires (#1251 is that case, not this)", () => {
    const window = createSilenceWindow();
    expect(pull(window, 0, 20_000, () => 3)).toBe(false);
  });

  it("a clock that moves once and then stands still never fires; a run restarts when it moves again", () => {
    // Frank round 1: an endpoint compare let (0,1) (100,1.1) … (5000,1.1) fire.
    const window = createSilenceWindow();
    window.note(true, 0, 1);
    expect(pull(window, 100, 8000, () => 1.1)).toBe(false);
    // Each stall restarted the run, last at 7800; from 8100 the clock moves
    // again, so that run fires five seconds after it began, not before.
    expect(pull(window, 8100, 12_700)).toBe(false);
    expect(window.note(true, 12_800, 12.8)).toBe(true);
  });

  it("a gap with no pull in it ends the run; a late silent sample only starts the next", () => {
    // George round 1: two silent notes five seconds apart must not fire.
    const window = createSilenceWindow();
    window.note(true, 0, 0);
    expect(window.note(true, 5000, 5)).toBe(false);
    expect(pull(window, 5100, 9900)).toBe(false);
    expect(window.note(true, 10_000, 10)).toBe(true);
  });

  it("a gap in the middle of a run restarts it", () => {
    const window = createSilenceWindow();
    pull(window, 0, 3000);
    // 1.1 s with no pull, then a run that must last five seconds again.
    expect(pull(window, 4100, 9000)).toBe(false);
    expect(window.note(true, 9100, 9.1)).toBe(true);
  });

  it("reset() restarts the run, the way a context leaving running does", () => {
    const window = createSilenceWindow();
    pull(window, 0, 4000);
    window.reset();
    expect(pull(window, 4100, 9000)).toBe(false);
    expect(window.note(true, 9100, 9.1)).toBe(true);
  });

  it("speech never fires, however long it runs", () => {
    const window = createSilenceWindow();
    for (let t = 0; t <= 60_000; t += 100) {
      expect(window.note(false, t, t / 1000)).toBe(false);
    }
  });
});
