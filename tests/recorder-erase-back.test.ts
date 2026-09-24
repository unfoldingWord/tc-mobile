// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/components/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

const policy = vi.hoisted(() => ({ blocks: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/lib/nav/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nav/navigation")>();
  policy.blocks.mockImplementation(actual.overlayBlocksClose);
  policy.dismiss.mockImplementation(actual.overlayDismissal);
  return {
    ...actual,
    overlayBlocksClose: policy.blocks,
    overlayDismissal: policy.dismiss,
  };
});
const storage = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: storage.clear,
}));
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  samples: new Int16Array([1, 2, 3, 4]),
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
// Paint/audio acquisition are outside this same-turn event regression. The
// real Recorder, erase hook, confirm, editor and close policies stay mounted.
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
  storage.clear.mockReset();
  policy.blocks.mockClear();
  policy.dismiss.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
async function setup() {
  const ref = createRef<RecorderHandle>();
  const onExit = vi.fn();
  const saveRecording = vi.fn();
  const saveEditedSegment = vi.fn();
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
        saveRecording,
        saveEditedSegment,
        clipboard: null,
        onClipboardChange: vi.fn(),
        databaseUnreachable: false,
        onExit,
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.eraseSegment).click());
  return { ref, onExit, saveRecording, saveEditedSegment };
}
it("keeps the confirm when Back arrives in the same turn as erase, before a render", async () => {
  let complete!: () => void;
  storage.clear.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  const s = await setup();
  await act(async () => {
    button(strings.eraseConfirm).click();
    // Deliberately no await/render between the erase event and imperative Back.
    const closing = s.ref.current!.requestClose();
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(await closing).toBe(false);
    // Both policy decisions must receive the live snapshot. Keeping only the
    // dismissal live hides a stale close gate while confirmOpen happens to hold.
    expect(policy.blocks).toHaveBeenLastCalledWith(false, true, true);
    expect(policy.dismiss).toHaveBeenLastCalledWith(false, true, true);
  });
  expect(
    document.querySelector(`[aria-label="${strings.eraseConfirmTitle}"]`)
  ).not.toBeNull();
  expect(s.onExit).not.toHaveBeenCalled();
  expect(s.saveRecording).not.toHaveBeenCalled();
  expect(s.saveEditedSegment).not.toHaveBeenCalled();
  await act(async () => complete());
  // The erase's own completion is what takes the confirm down — and since
  // #592 it leaves the sheet open over the emptied segment rather than
  // exiting (`tests/recorder-rerecord.test.ts` owns that post-condition).
  expect(
    document.querySelector(`[aria-label="${strings.eraseConfirmTitle}"]`)
  ).toBeNull();
  expect(s.onExit).not.toHaveBeenCalled();
  expect(s.saveRecording).not.toHaveBeenCalled();
  expect(s.saveEditedSegment).not.toHaveBeenCalled();
});
it("dismisses a waiting confirm, then permits ordinary idle Back", async () => {
  const s = await setup();
  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(false);
  });
  expect(
    document.querySelector(`[aria-label="${strings.eraseConfirmTitle}"]`)
  ).toBeNull();
  expect(storage.clear).not.toHaveBeenCalled();
  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(true);
  });
  expect(s.onExit).toHaveBeenCalledOnce();
});
