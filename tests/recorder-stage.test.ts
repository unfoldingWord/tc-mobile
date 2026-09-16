import { describe, expect, it } from "vitest";

import { liveScopeShown, type StageState } from "@/components/recorder-stage";

/**
 * Base state: idle, empty segment, tap healthy, no preview. Every case overrides
 * only the fields it is about, so a reader sees exactly what drives the branch.
 */
function stage(overrides: Partial<StageState> = {}): StageState {
  return {
    recording: false,
    paused: false,
    processing: false,
    isClosing: false,
    hasAudio: false,
    meterFailed: false,
    previewShown: false,
    ...overrides,
  };
}

/** The four take-in-flight states, each of which should drive the live scope. */
const IN_FLIGHT: Array<Partial<StageState>> = [
  { recording: true },
  { paused: true },
  { processing: true },
  { isClosing: true },
];

describe("liveScopeShown — the live scope drives the whole take-in-flight window", () => {
  it.each(IN_FLIGHT)("shows the live scope while %o", (s) => {
    expect(liveScopeShown(stage(s))).toBe(true);
  });

  it("shows nothing at idle, with or without existing audio", () => {
    expect(liveScopeShown(stage())).toBe(false);
    expect(liveScopeShown(stage({ hasAudio: true }))).toBe(false);
  });
});

describe("liveScopeShown — an append renders exactly like a first take (#283)", () => {
  // The regression guard for #283. The first take path already worked; the bug
  // was that an append (existing audio) was routed to Waveform and never grew.
  // Prior audio must NEVER change the decision — reintroduce any `hasAudio` gate
  // and one of these dies.
  it.each(IN_FLIGHT)("ignores hasAudio in the %o state", (s) => {
    expect(liveScopeShown(stage({ ...s, hasAudio: true }))).toBe(
      liveScopeShown(stage({ ...s, hasAudio: false }))
    );
  });

  it("grows live while recording a second take (the #283 symptom)", () => {
    expect(liveScopeShown(stage({ recording: true, hasAudio: true }))).toBe(
      true
    );
  });

  it("freezes (not blank / not the old clip) when a second take pauses or closes", () => {
    // George R1 P2: gating the frozen arm on hasAudio swapped LiveScope→Waveform
    // here and flashed blank then the pre-take clip. The live scope must stay.
    expect(liveScopeShown(stage({ paused: true, hasAudio: true }))).toBe(true);
    expect(liveScopeShown(stage({ processing: true, hasAudio: true }))).toBe(
      true
    );
    expect(liveScopeShown(stage({ isClosing: true, hasAudio: true }))).toBe(
      true
    );
  });
});

describe("liveScopeShown — the stage-owning states win", () => {
  it("never shows the live scope when the tap failed", () => {
    for (const s of IN_FLIGHT) {
      expect(liveScopeShown(stage({ ...s, meterFailed: true }))).toBe(false);
    }
  });

  it("never shows it when a preview is up, with or without existing audio", () => {
    // George round 2 (the re-run after `a96a81e`): an append's own preview must
    // ALSO win the stage, not just a first take's. `#101` Play-while-paused
    // `mergeTake`s and sounds the merged buffer regardless of `hasAudio`, so
    // leaving the live scope up here would play audio the stage does not draw,
    // with no playhead over it. Reintroduce a `!hasAudio` condition on this
    // guard (the round-1, `a96a81e` mistake) and the `hasAudio: true` half of
    // this table dies.
    for (const s of IN_FLIGHT) {
      expect(
        liveScopeShown(stage({ ...s, previewShown: true, hasAudio: false }))
      ).toBe(false);
      expect(
        liveScopeShown(stage({ ...s, previewShown: true, hasAudio: true }))
      ).toBe(false);
    }
  });
});
