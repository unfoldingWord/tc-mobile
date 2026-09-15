import { describe, expect, it } from "vitest";

import { auditionPlan } from "@/lib/audio/audition";
import { clampRange } from "@/lib/audio/edit";

/**
 * What edit-mode Play sounds (#284).
 *
 * The first external tester tried to play a highlighted part of a segment
 * before deleting it, found no way to, and fell back to memorising the shape of
 * the waveform — which is what a non-reader would have to do too. The decision
 * this file pins down is the "what to play" half of the fix, kept pure so it is
 * provable without a phone, a microphone or a speaker: the recorder owns only
 * HOW to sound the range it is handed.
 *
 * The contract, in one line each:
 *
 * - a picked span sounds exactly the samples the scissors would remove — the
 *   same `clampRange` normalisation `useSegmentEditor.cut` runs, so "what I
 *   heard" and "what I cut" cannot drift apart;
 * - nothing picked sounds the working buffer from the centerline to the end;
 * - a centerline resting at the end (the append-ready rest the sheet opens on,
 *   F7) would sound nothing at all, so it sounds the whole segment instead;
 * - anything with no audio in it — an empty buffer, a collapsed span — is
 *   `null`, which is the recorder's cue to disable the control rather than
 *   claim the audio floor for silence.
 */

const SELECTION = { start: 100, end: 400 };

describe("auditionPlan", () => {
  it("sounds a picked span, and only that span", () => {
    expect(auditionPlan(1000, SELECTION, 500)).toEqual({
      range: { start: 100, end: 400 },
      source: "selection",
    });
  });

  it("sounds exactly what a cut of the same span would remove", () => {
    // The property that matters in the field: the audition is the cut's
    // preview, so both must normalise identically. `cut` clamps with
    // `clampRange`; a plan that rounded, padded or fenced differently would let
    // a translator approve audio the scissors then do not take.
    const picked = { start: -40, end: 940.5 };
    const plan = auditionPlan(900, picked, 0);
    expect(plan?.range).toEqual(clampRange(picked, 900));
  });

  it("clamps a span that runs past both ends of the buffer", () => {
    expect(auditionPlan(1000, { start: -200, end: 5000 }, 0)?.range).toEqual({
      start: 0,
      end: 1000,
    });
  });

  it("normalises a span dragged backwards past its other edge", () => {
    // The editor deliberately does NOT reorder while a handle is under a
    // finger; the span reaching here can be reversed.
    expect(auditionPlan(1000, { start: 700, end: 300 }, 0)?.range).toEqual({
      start: 300,
      end: 700,
    });
  });

  it("refuses a zero-length span", () => {
    // Nothing is highlighted, so there is nothing to audition — the control
    // goes inert, exactly as Cut does on the same span.
    expect(auditionPlan(1000, { start: 250, end: 250 }, 500)).toBeNull();
  });

  it("refuses a span with a non-finite edge", () => {
    // `NaN === NaN` is false, so an equality guard would let this through as a
    // live plan whose `subarray(NaN, NaN)` sounds nothing — an enabled Play that
    // visibly does nothing, which is the shape of control this issue exists to
    // remove (Frank R1 F1).
    expect(auditionPlan(1000, { start: Number.NaN, end: 400 }, 0)).toBeNull();
    expect(auditionPlan(1000, { start: 100, end: Number.NaN }, 0)).toBeNull();
  });

  it("refuses a span shorter than the one sample that would sound", () => {
    // Sample indices are floats here (a handle drag, or a keyboard nudge of
    // `visibleSamples / 400` on a short clip), and both `subarray` and `slice`
    // TRUNCATE. A span inside a single sample removes nothing and sounds
    // nothing, so it must not leave a live control (George R1 P3-1).
    expect(auditionPlan(1000, { start: 10.2, end: 10.9 }, 0)).toBeNull();
    // ...while a span that straddles a sample boundary does sound that sample.
    expect(auditionPlan(1000, { start: 10.2, end: 11.1 }, 0)?.range).toEqual({
      start: 10.2,
      end: 11.1,
    });
  });

  it("refuses a span that collapses once clamped", () => {
    // Both edges beyond the end (a span left over from a longer buffer) clamp
    // onto the same sample. Nothing to hear.
    expect(auditionPlan(1000, { start: 4000, end: 9000 }, 500)).toBeNull();
  });

  it("sounds from the centerline to the end when nothing is picked", () => {
    expect(auditionPlan(1000, null, 250)).toEqual({
      range: { start: 250, end: 1000 },
      source: "line",
    });
  });

  it("sounds the whole segment when the centerline rests at the end", () => {
    // The sheet opens append-ready with the line at the end of the audio (F7).
    // Playing "from the line" there is silence, which reads as a dead control —
    // the whole point of #284 was a Play a translator could trust.
    expect(auditionPlan(1000, null, 1000)).toEqual({
      range: { start: 0, end: 1000 },
      source: "whole",
    });
  });

  it("calls a centerline at the very start the whole segment, not a line", () => {
    // Same range, and the label the recorder speaks must match what is heard.
    expect(auditionPlan(1000, null, 0)).toEqual({
      range: { start: 0, end: 1000 },
      source: "whole",
    });
  });

  it("clamps a centerline that sits past the end of the buffer", () => {
    expect(auditionPlan(1000, null, 4000)).toEqual({
      range: { start: 0, end: 1000 },
      source: "whole",
    });
  });

  it("treats a non-finite centerline as the start of the buffer", () => {
    // `viewportWindow` clamps the centerline, but `NaN` survives a clamp; a
    // plan built from it would hand `subarray` a NaN and sound nothing.
    expect(auditionPlan(1000, null, Number.NaN)).toEqual({
      range: { start: 0, end: 1000 },
      source: "whole",
    });
  });

  it("refuses an empty buffer, picked span or not", () => {
    expect(auditionPlan(0, null, 0)).toBeNull();
    expect(auditionPlan(0, { start: 0, end: 0 }, 0)).toBeNull();
  });
});
