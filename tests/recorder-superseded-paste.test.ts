// @vitest-environment jsdom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";
import { strings } from "@/lib/strings";

/**
 * A paste empties the clipboard (#489), so once it lands the phrase lives only
 * in the sheet's `working` buffer. A superseded capture's exit withholds every
 * pending write (#527), `working` included. Frank and George R3 on #965: paste
 * a phrase cut from another segment, record, have the Stop superseded, tap
 * Back, and the phrase was nowhere.
 *
 * Unlike `recorder-superseded-writes.test.ts`, the editor here is the REAL
 * `useSegmentEditor`, and the clipboard is real state one level up, as
 * `App.tsx` holds it. The paste is driven through the sheet's own controls.
 * Only the segment load, the audio session and the canvases are stubbed.
 */
const original = new Int16Array([1, 2, 3, 4]);
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  samples: original,
};
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn().mockResolvedValue(view),
    setFinished: vi.fn().mockResolvedValue(undefined),
  }),
}));
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

it("a superseded exit after a landed paste puts the phrase back on the clipboard", async () => {
  const phrase = new Int16Array([7, 8, 9]);
  const ref = createRef<RecorderHandle>();
  const saveEditedSegment = vi.fn().mockResolvedValue(true);
  const saveRecording = vi.fn().mockResolvedValue(true);
  const onExit = vi.fn();
  const clipboard: { current: Int16Array | null } = { current: phrase };
  const audio: { -readonly [K in keyof UseAudioSession]: UseAudioSession[K] } =
    {
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
      // Superseded: no samples, no bytes, no error (`classifyCapture`).
      stopRecording: vi.fn(async () => {
        audio.recorderState = "idle";
        return { samples: null, blob: null, error: null };
      }),
      retryDecode: vi.fn(),
      leave: vi.fn(),
      primeAudioContext: vi.fn(),
      readLevel: () => 0,
      readMeterAvailable: () => true,
      readScope: () => null,
      peekScope: () => null,
    };

  // The clipboard one level up, as App holds it; `clipboard.current` is what
  // App's state would read after each render.
  function Host() {
    const [clip, setClip] = useState<Int16Array | null>(phrase);
    clipboard.current = clip;
    return createElement(Recorder, {
      ref,
      segmentId: "segment" as SegmentId,
      audio,
      erase: {
        erase: vi.fn(async () => "ok" as const),
        erasing: false,
        isErasing: () => false,
      },
      saveRecording,
      saveEditedSegment,
      clipboard: clip,
      onClipboardChange: setClip,
      databaseUnreachable: false,
      onExit,
      onRequestBack: () => {
        void ref.current?.requestClose();
      },
    });
  }
  const render = async () => act(async () => root.render(createElement(Host)));
  const click = async (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label
      );
      expect(button, label).toBeDefined();
      button!.click();
    });

  await render();
  await click(strings.enterEdit);
  await click(strings.paste);
  // The paste landed: the phrase is in the take and off the clipboard.
  expect(clipboard.current).toBeNull();
  await click(strings.doneEditing);

  await click(strings.record);
  expect(audio.startRecording).toHaveBeenCalledOnce();
  audio.recorderState = "recording";
  await render();
  await click(strings.stop);
  expect(audio.stopRecording).toHaveBeenCalledOnce();
  await render();
  await act(async () => {
    await ref.current!.requestClose();
  });

  // The superseded exit still writes nothing (#527)...
  expect(onExit).toHaveBeenCalledOnce();
  expect(saveRecording).not.toHaveBeenCalled();
  expect(saveEditedSegment).not.toHaveBeenCalled();
  // ...and the phrase it dropped from `working` is back where it came from.
  expect(clipboard.current).toBe(phrase);
});
