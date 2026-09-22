import { describe, expect, it } from "vitest";

import { computePeaks } from "@/lib/audio/peaks";
import {
  buildPreview,
  previewOnStage,
  stateAfterAbort,
  type PreviewState,
  type TakeInFlight,
} from "@/lib/takes/paused-preview";

/**
 * The paused-take preview's rules (#101), reachable from Node for the first
 * time (#160, L-2).
 *
 * All of this lived inside `recorder.tsx` — the splice and the peaks pass ran
 * from a Play handler, and the transitions were observable only by rendering
 * the sheet. What is covered here is what that hid: WHERE the paused capture
 * lands, what an empty result draws, which abort keeps a failure, and the set
 * of phases that keep a prepared preview on the stage.
 *
 * What is still NOT covered, and cannot be here: the epoch that drops a stale
 * decode, the in-flight guard, and the effect that fires on leaving `paused`.
 * Those are the component's refs and effects and remain review + on-device
 * surface.
 */

const buf = (...v: number[]) => Int16Array.of(...v);

describe("buildPreview", () => {
  it("splices the paused capture in where the save will put it", () => {
    // The whole point of the preview: it sounds the take WHERE Back saves it,
    // not appended at the end. An insert at 2 of a segment being edited.
    const prepared = buildPreview(buf(1, 2, 9, 9), buf(5, 6), 2, 4);
    expect(Array.from(prepared.buffer)).toEqual([1, 2, 5, 6, 9, 9]);
  });

  it("appends when the insert point is the end", () => {
    const prepared = buildPreview(buf(1, 2), buf(3), 2, 4);
    expect(Array.from(prepared.buffer)).toEqual([1, 2, 3]);
  });

  it("gives back the working buffer untouched when nothing was captured", () => {
    // `mergeTake`'s edit-only case: no allocation, and the preview is just the
    // edited buffer. A pause with a zero-length capture must not fabricate one.
    const working = buf(1, 2, 3);
    const prepared = buildPreview(working, new Int16Array(0), 1, 4);
    expect(prepared.buffer).toBe(working);
  });

  it("draws peaks over the MERGED buffer, not over the working one", () => {
    // The distinction that makes the preview a preview: the waveform must show
    // the take that is about to be saved, including the part just captured.
    const prepared = buildPreview(buf(0, 0), buf(32767, -32768), 2, 8);
    expect(prepared.peaks).toEqual(computePeaks(buf(0, 0, 32767, -32768), 8));
  });

  it("has NO peaks when the merged result is empty", () => {
    // Not an empty `Peaks`. A zero-length buffer has no shape to draw, and
    // `computePeaks` answers with one bucket of silence — a flat line that
    // reads as recorded audio rather than as nothing.
    const prepared = buildPreview(new Int16Array(0), new Int16Array(0), 0, 8);
    expect(prepared.buffer.length).toBe(0);
    expect(prepared.peaks).toBeNull();
  });

  it("honours the bucket count it is given", () => {
    expect(buildPreview(buf(1, 2, 3, 4), buf(5), 4, 3).peaks?.min).toHaveLength(
      3
    );
  });
});

describe("stateAfterAbort", () => {
  it("drops a decode that is no longer wanted", () => {
    expect(stateAfterAbort("decoding")).toBe("none");
  });

  it("KEEPS a failure across the abort", () => {
    // The one that is not symmetric, and the reason this is a function rather
    // than `setPreviewState("none")`. "failed" is a fact about this device's
    // last attempt, not about the request — iOS writes the moov atom only on
    // stop, so a paused container may simply not be decodable here. Clearing
    // it would re-enable a Play that is about to fail again, silently.
    expect(stateAfterAbort("failed")).toBe("failed");
  });

  it("leaves an idle state alone", () => {
    expect(stateAfterAbort("none")).toBe("none");
  });

  it("answers for every state", () => {
    // A floor: if `PreviewState` grows a member, this list stops matching it
    // and the new state's behaviour has to be decided rather than defaulted.
    const all: PreviewState[] = ["none", "decoding", "failed"];
    expect(all.map(stateAfterAbort)).toEqual(["none", "none", "failed"]);
  });
});

describe("previewOnStage", () => {
  const phase = (over: Partial<TakeInFlight> = {}): TakeInFlight => ({
    paused: false,
    busy: false,
    isClosing: false,
    ...over,
  });

  it("is false at idle, so a stale preview is inert", () => {
    // A failed close can leave a prepared object behind. Drawing it over a
    // stored take would show audio that was never saved.
    expect(previewOnStage(phase())).toBe(false);
  });

  it("holds the preview while the take is paused", () => {
    expect(previewOnStage(phase({ paused: true }))).toBe(true);
  });

  it("holds it through a COMMIT, which is George R3 #1", () => {
    // Dropping it here remounts the LiveScope blank for the whole commit, and
    // a blank stage reads as the take having been discarded.
    expect(previewOnStage(phase({ busy: true }))).toBe(true);
  });

  it("holds it through the CLOSE path for the same reason", () => {
    expect(previewOnStage(phase({ isClosing: true }))).toBe(true);
  });

  it("pins the term set, so a dropped term dies here", () => {
    // What this is worth, stated plainly: the operator is a disjunction and
    // nobody needed a test for that. What it pins is the SET — that these
    // three phases, and no fewer, keep the preview on the stage. The same
    // thing `segments-inert.ts` does, for the same reason.
    const terms: (keyof TakeInFlight)[] = ["paused", "busy", "isClosing"];
    expect(terms.map((t) => previewOnStage(phase({ [t]: true })))).toEqual([
      true,
      true,
      true,
    ]);
    expect(terms).toHaveLength(3);
  });
});
