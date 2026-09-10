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

describe("liveScopeShown — a first take (empty segment)", () => {
  it("shows the live scope while recording", () => {
    expect(liveScopeShown(stage({ recording: true }))).toBe(true);
  });

  it("keeps it (frozen) while paused, processing, or closing with no preview", () => {
    expect(liveScopeShown(stage({ paused: true }))).toBe(true);
    expect(liveScopeShown(stage({ processing: true }))).toBe(true);
    expect(liveScopeShown(stage({ isClosing: true }))).toBe(true);
  });

  it("yields to the prepared preview once one is up", () => {
    expect(liveScopeShown(stage({ paused: true, previewShown: true }))).toBe(
      false
    );
    expect(liveScopeShown(stage({ isClosing: true, previewShown: true }))).toBe(
      false
    );
  });
});

describe("liveScopeShown — a second take / append (#283)", () => {
  it("shows the live scope while recording an append (the #283 fix)", () => {
    // The regression guard for #283. The previous inline condition ANDed
    // `!hasAudio`, so an append (`hasAudio: true`) recording returned false —
    // the VU moved but no waveform grew until the segment was left and
    // re-entered. Reintroduce `!s.hasAudio` on the `recording` arm and this die.
    expect(liveScopeShown(stage({ recording: true, hasAudio: true }))).toBe(
      true
    );
  });

  it("stays on Waveform in the frozen states so the existing clip shows", () => {
    // An append that is paused / processing / closing keeps the existing clip
    // (and the #110 insert centerline) visible via Waveform — unchanged.
    expect(liveScopeShown(stage({ paused: true, hasAudio: true }))).toBe(false);
    expect(liveScopeShown(stage({ processing: true, hasAudio: true }))).toBe(
      false
    );
    expect(liveScopeShown(stage({ isClosing: true, hasAudio: true }))).toBe(
      false
    );
  });
});

describe("liveScopeShown — the stage-owning states win", () => {
  it("never shows the live scope when the tap failed", () => {
    expect(liveScopeShown(stage({ recording: true, meterFailed: true }))).toBe(
      false
    );
    expect(liveScopeShown(stage({ paused: true, meterFailed: true }))).toBe(
      false
    );
  });

  it("never shows it when a preview is up", () => {
    expect(liveScopeShown(stage({ recording: true, previewShown: true }))).toBe(
      false
    );
  });

  it("shows nothing at idle, with or without existing audio", () => {
    expect(liveScopeShown(stage())).toBe(false);
    expect(liveScopeShown(stage({ hasAudio: true }))).toBe(false);
  });
});
