// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

/**
 * The erase surface `App` now owns and passes down (#160, L-12). Resting: this
 * suite never erases, and a stub that answers "no erase in flight" is what the
 * screen's Back and confirm gates read. Written here rather than mocked at the
 * module, because the screen takes it as a PROP now — a module mock would
 * intercept nothing.
 */
const erase = {
  erase: vi.fn(async () => "ok" as const),
  erasing: false,
  isErasing: () => false,
};

const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: false,
  samples: new Int16Array(),
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
async function setup(recorderState: UseAudioSession["recorderState"]) {
  const ref = createRef<RecorderHandle>();
  const onExit = vi.fn();
  const saveRecording = vi.fn();
  const saveEditedSegment = vi.fn();
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
        saveRecording,
        saveEditedSegment,
        clipboard: null,
        onClipboardChange: vi.fn(),
        databaseUnreachable: false,
        erase,
        onExit,
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  return { ref, onExit, saveRecording, saveEditedSegment };
}
for (const [state, reason] of [
  ["idle", strings.nothingRecorded],
  ["requesting", strings.micStarting],
] as const) {
  it(`keeps the blocked Edit reason accessible without a warning badge when ${state}`, async () => {
    await setup(state);
    const edit = container.querySelector<HTMLButtonElement>(
      '.recorder-toolbar button[aria-label^="Edit recording"]'
    );
    expect(edit).not.toBeNull();
    expect(edit!.getAttribute("aria-label")).toBe(
      `${strings.enterEdit}. ${reason}`
    );
    expect(edit!.disabled).toBe(false);
    expect(edit!.getAttribute("aria-disabled")).toBe("true");
    expect(
      container.querySelectorAll(".recorder-toolbar .control-hint")
    ).toHaveLength(0);
    await act(async () => edit!.click());
    expect(container.querySelector(".recorder-toolbar.pair")).not.toBeNull();
  });
}
