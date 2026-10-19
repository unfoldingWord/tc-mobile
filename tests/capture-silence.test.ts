import { describe, expect, it } from "vitest";

import {
  CAPTURE_SILENCE_MS,
  createSilenceWindow,
  isDigitalSilence,
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

describe("createSilenceWindow", () => {
  it("the window is five seconds", () => {
    expect(CAPTURE_SILENCE_MS).toBe(5000);
  });

  it("fires once at five seconds of zeros on an advancing clock, not one millisecond before", () => {
    const window = createSilenceWindow();
    expect(window.note(true, 0, 1)).toBe(false);
    expect(window.note(true, 4999, 5.999)).toBe(false);
    expect(window.note(true, 5000, 6)).toBe(true);
    // Latched: the caller seals once.
    expect(window.note(true, 9000, 10)).toBe(false);
    expect(window.note(true, 60_000, 61)).toBe(false);
  });

  it("any non-silent sample restarts the run", () => {
    const window = createSilenceWindow();
    window.note(true, 0, 1);
    window.note(true, 4000, 5);
    window.note(false, 4500, 5.5);
    // The new run starts at the first silent sample after the reset.
    expect(window.note(true, 5000, 6)).toBe(false);
    expect(window.note(true, 9999, 10.9)).toBe(false);
    expect(window.note(true, 10_000, 11)).toBe(true);
  });

  it("a clock that has not moved across the run never fires (#1251 is that case, not this)", () => {
    const window = createSilenceWindow();
    window.note(true, 0, 3);
    expect(window.note(true, 5000, 3)).toBe(false);
    expect(window.note(true, 20_000, 3)).toBe(false);
  });

  it("reset() restarts the run, the way a context leaving running does", () => {
    const window = createSilenceWindow();
    window.note(true, 0, 1);
    window.note(true, 4000, 5);
    window.reset();
    expect(window.note(true, 5000, 6)).toBe(false);
    expect(window.note(true, 10_000, 11)).toBe(true);
  });

  it("speech never fires, however long it runs", () => {
    const window = createSilenceWindow();
    for (let t = 0; t <= 60_000; t += 100) {
      expect(window.note(false, t, t / 1000)).toBe(false);
    }
  });
});
