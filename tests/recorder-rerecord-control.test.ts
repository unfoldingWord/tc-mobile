import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { Icon } from "@/components/icon";
import { Recorder } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";
import { one, render } from "./render";

/**
 * The record bar's "erase and record again" control (#592), as the JSX emits
 * it: one static render per state through `tests/render.ts`.
 *
 * The props-to-attributes half only — which states show it live, which grey it
 * and how, and that it takes a slot without moving the edit toggle off the
 * right-hand end. What it does when tapped is `tests/recorder-rerecord.test.ts`,
 * a mount; a static render has no events.
 */
const boundary = vi.hoisted(() => ({ view: null as unknown }));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: () => {},
    reload: async () => boundary.view,
    setFinished: async () => {},
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

function view(hasClip: boolean) {
  const samples = hasClip ? new Int16Array(100).fill(3) : null;
  return {
    bookName: "Book",
    chapterNumber: 1,
    ordinal: 1,
    segmentLabel: null,
    finished: false,
    hasClip,
    peaks: null,
    lengthSamples: samples?.length ?? 0,
    samples,
  };
}

function renderBar(
  recorderState: UseAudioSession["recorderState"],
  hasClip: boolean
): Element {
  boundary.view = view(hasClip);
  const noop = () => {};
  const audio: UseAudioSession = {
    playingId: null,
    playingBuffer: false,
    playbackElapsedMs: 0,
    playbackRanOut: false,
    recorderState,
    elapsedMs: 0,
    supported: true,
    error: null,
    recorderError: null,
    meterFailed: false,
    playTake: noop,
    playBuffer: noop,
    stopBuffer: noop,
    readPlaybackPosition: () => null,
    startRecording: noop,
    stopRecording: async () => ({ samples: null, blob: null, error: null }),
    retryDecode: async () => ({ samples: null, error: null }),
    leave: noop,
    primeAudioContext: noop,
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
  } as unknown as UseAudioSession;
  return render(
    createElement(Recorder, {
      segmentId: "segment" as SegmentId,
      audio,
      saveRecording: async () => true,
      saveEditedSegment: async () => true,
      clipboard: null,
      onClipboardChange: noop,
      databaseUnreachable: false,
      onExit: noop,
      onRequestBack: noop,
    })
  );
}

const SELECTOR = `.recorder-toolbar.pair button[aria-label^="${strings.rerecord}"]`;

describe("the record bar's re-record control", () => {
  it("is live over a stored take, as a plain action named for what it does", () => {
    const control = one(renderBar("idle", true), SELECTOR);
    expect(control.getAttribute("aria-label")).toBe(strings.rerecord);
    expect(control.hasAttribute("disabled")).toBe(false);
    expect(control.hasAttribute("aria-disabled")).toBe(false);
    // An action, not a toggle: an absent aria-pressed and a false one say
    // different things (`Control`'s `pressed` docblock).
    expect(control.hasAttribute("aria-pressed")).toBe(false);
    // The bin — the one glyph ADR 0010's ten already test for "throw away",
    // and the one the confirm it opens wears — drawn exactly as `Icon` draws it.
    const bin = one(render(createElement(Icon, { name: "trash" })), "svg");
    expect(one(control, "svg").outerHTML).toBe(bin.outerHTML);
  });

  it("sits left of Record and leaves the edit toggle at the right-hand end", () => {
    const bar = one(renderBar("idle", true), ".recorder-toolbar.pair");
    const labels = [...bar.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label")
    );
    expect(labels).toEqual([
      strings.rerecord,
      strings.record,
      strings.playRecording,
      strings.enterEdit,
    ]);
  });

  it("is greyed with its reason, and no warning badge, when nothing is stored", () => {
    const bar = renderBar("idle", false);
    const control = one(bar, SELECTOR);
    expect(control.getAttribute("aria-label")).toBe(
      `${strings.rerecord}. ${strings.nothingStored}`
    );
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.hasAttribute("disabled")).toBe(false);
    expect(
      bar.querySelectorAll(".recorder-toolbar .control-hint")
    ).toHaveLength(0);
  });

  it("is aria-disabled with its own reason while recording — erasing under a live take is refused (#878)", () => {
    // Was natively `disabled` with no reason until #878: the bin had the
    // IDENTICAL accessibility gap #869 round 1 (Frank P2) found and fixed for
    // the toolbar Edit control alone. `recorder.tsx` now passes
    // `strings.stopToErase` through `barHint`'s `uncommittedTakeLabel`
    // parameter while `recording` is true, naming the bar's own Stop control
    // — the menu's "Close menu, then Close recorder" words still describe a
    // menu this bar is not in, so the bar keeps its own wording rather than
    // reusing them.
    const control = one(renderBar("recording", true), SELECTOR);
    expect(control.hasAttribute("disabled")).toBe(false);
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.getAttribute("aria-label")).toBe(
      `${strings.rerecord}. ${strings.stopToErase}`
    );
  });

  it("is greyed with its reason while the microphone is still starting", () => {
    const control = one(renderBar("requesting", true), SELECTOR);
    expect(control.getAttribute("aria-label")).toBe(
      `${strings.rerecord}. ${strings.micStarting}`
    );
    expect(control.getAttribute("aria-disabled")).toBe("true");
  });

  it("is off while a take is being committed", () => {
    const control = one(renderBar("processing", true), SELECTOR);
    expect(control.hasAttribute("disabled")).toBe(true);
  });
});
