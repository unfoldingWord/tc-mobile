// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/components/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

/**
 * The toolbar edit toggle (#557) and the span it opens (#554).
 *
 * `seedSelection`'s geometry is pinned as arithmetic in
 * `tests/audio-viewport.test.ts`. What that cannot see is whether the recorder
 * hands the frame that seed: the sheet used to build its own centred span
 * inline, and a fix that left the inline arithmetic in place beside a new
 * library function would pass every case over there while the app kept
 * opening centred. So this mounts the real `Recorder` — segment hook mocked at
 * its boundary, as `tests/recorder-edit-hint.test.ts` does — fires the
 * toggle's click handler, and reads the handles the overlay renders.
 *
 * A mount rather than `tests/render.ts`'s one static render, because edit
 * mode is component state that only a click reaches: a static render can only
 * ever show the record bar. What this cannot see: a `.click()` here calls the
 * handler whatever the cascade, an `inert` ancestor or real pointer handling
 * would do, and there is no layout. Whether a real tap in the shipped build
 * reaches the control, opens the forward seed and keeps the toggle's box in
 * place is `e2e/recorder-selection.spec.ts`'s question; how it feels on a
 * phone is a device question.
 */

const LENGTH = 1000;
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  samples: new Int16Array(LENGTH),
};
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn().mockResolvedValue(view),
    setFinished: vi.fn(),
  }),
}));
// Canvas painting and microphone acquisition are outside the toolbar contract.
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  const ref = createRef<RecorderHandle>();
  const audio: UseAudioSession = {
    playingId: null,
    playingBuffer: false,
    playbackElapsedMs: 0,
    playbackRanOut: false,
    recorderState: "idle",
    elapsedMs: 0,
    supported: true,
    error: null,
    recorderError: null,
    meterFailed: false,
    playTake: vi.fn(),
    playBuffer: vi.fn(),
    stopBuffer: vi.fn(),
    readPlaybackPosition: () => null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    retryDecode: vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
  };
  await act(async () =>
    root.render(
      createElement(Recorder, {
        ref,
        segmentId: "segment" as SegmentId,
        audio,
        saveRecording: vi.fn(),
        saveEditedSegment: vi.fn(),
        clipboard: null,
        onClipboardChange: vi.fn(),
        databaseUnreachable: false,
        onExit: vi.fn(),
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
}

/** The one toolbar, and the toggle in it, found by the name a reader hears. */
function toolbar(): HTMLElement {
  const bars = container.querySelectorAll<HTMLElement>(".recorder-toolbar");
  expect(bars).toHaveLength(1);
  return bars[0]!;
}
function toggle(): HTMLButtonElement {
  const found = toolbar().querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${strings.enterEdit}"]`
  );
  expect(found).toHaveLength(1);
  return found[0]!;
}
function handle(label: string): number | null {
  const el = container.querySelector(`[aria-label="${label}"]`);
  return el === null ? null : Number(el.getAttribute("aria-valuenow"));
}

describe("the edit toggle (#557) opens the forward seed (#554)", () => {
  it("a click on the record-bar toggle opens a frame whose left edge is AT the playhead, slid back off the end at the rest", async () => {
    await mount();
    // No frame in record mode.
    expect(handle(strings.selectionStartHandle)).toBeNull();

    await act(async () => toggle().click());

    // A fresh sheet rests at the end of the audio (the F7 append rest), whole
    // zoom, so `seedSelection(1000, 1000, 1000)` is `{750, 1000}`. The centred
    // seed it replaces delivered `{850, 1000}` here once `openSelection`
    // clamped its overrun.
    expect(handle(strings.selectionStartHandle)).toBe(750);
    expect(handle(strings.selectionEndHandle)).toBe(1000);
    // #418 from the first edit frame: a loaded span hides the centerline.
    expect(
      container.querySelector('[data-testid="centerline-overlay"]')
    ).toBeNull();
  });

  it("reseeds forward after a cut, measured against the shorter buffer", async () => {
    await mount();
    await act(async () => toggle().click());
    const cut = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${strings.cut}"]`
    );
    expect(cut).not.toBeNull();
    await act(async () => cut!.click());

    // `{750, 1000}` is gone, so 750 samples remain and the pan rests at their
    // end: `seedSelection(750, 750, 750)` is `{562.5, 750}`, which the handle
    // reports rounded. The centred seed gave `{637.5, 750}`.
    expect(handle(strings.selectionEndHandle)).toBe(750);
    expect(handle(strings.selectionStartHandle)).toBe(563);
  });

  it("is the same named control, last in both bars, and reads pressed only in edit mode", async () => {
    await mount();
    const bar = toolbar();
    expect(bar.classList.contains("edit")).toBe(false);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(bar.lastElementChild?.contains(toggle())).toBe(true);

    await act(async () => toggle().click());
    const editBar = toolbar();
    expect(editBar.classList.contains("edit")).toBe(true);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(editBar.lastElementChild?.contains(toggle())).toBe(true);

    // The pressed toggle is the way back out, closing the frame on the way.
    await act(async () => toggle().click());
    expect(toolbar().classList.contains("edit")).toBe(false);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(handle(strings.selectionStartHandle)).toBeNull();
  });
});
