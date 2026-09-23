// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import {
  useEraseSegment,
  type UseEraseSegment,
} from "@/hooks/use-erase-segment";
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
vi.mock("@/lib/storage/books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/books")>()),
  clearSegmentTake: storage.clear,
}));
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: 4,
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
// The one shared instance the Host mounts, so a test can act as the OTHER
// screen holding its guard (#160, L-12).
let shared: UseEraseSegment;
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
    audioNeedsGesture: () => false,
    startRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    stopRecording: vi.fn(),
    retryDecode: vi.fn(),
    previewCapture: vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
  };
  // `erase` is a prop now (#160, L-12), so this mounts a host that calls the
  // REAL `useEraseSegment`. A hand-built stub would not do: what this test is
  // about is the synchronous in-flight guard, which is the hook's own.
  function Host() {
    const erase = useEraseSegment();
    shared = erase;
    return createElement(Recorder, {
      ref,
      segmentId: "segment" as SegmentId,
      audio,
      erase,
      saveRecording,
      saveEditedSegment,
      clipboard: null,
      onClipboardChange: vi.fn(),
      databaseUnreachable: false,
      onExit,
      onRequestBack: () => {
        void ref.current?.requestClose();
      },
    });
  }
  await act(async () => root.render(createElement(Host)));
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
  expect(s.onExit).toHaveBeenCalledExactlyOnceWith(true);
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
it("keeps its own erase-failed Notice when a retry is refused as busy", async () => {
  // George, #660: the flag was cleared before `erase()` answered, so a retry
  // refused because the OTHER caller holds the one shared guard blanked the
  // failure this sheet had really seen, though no erase of its own ran.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  storage.clear.mockRejectedValueOnce(new Error("no space"));
  await setup();
  await act(async () => button(strings.eraseConfirm).click());
  const notice = () =>
    [...document.querySelectorAll(".notice")].some(
      (el) => el.textContent === strings.eraseFailed
    );
  expect(notice()).toBe(true);

  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.eraseSegment).click());
  let release!: () => void;
  storage.clear.mockImplementationOnce(
    () => new Promise<void>((resolve) => (release = resolve))
  );
  let held!: Promise<string>;
  await act(async () => {
    // The other caller takes the guard, and this sheet's retry lands in the
    // same turn — before a render can pass `erasing` down to the confirm,
    // which is the only window in which the hook itself answers "busy".
    held = shared.erase("other" as SegmentId);
    button(strings.eraseConfirm).click();
  });
  // The retry never reached the store: one failure, one held erase.
  expect(storage.clear).toHaveBeenCalledTimes(2);
  expect(storage.clear).toHaveBeenLastCalledWith("other");
  expect(notice()).toBe(true);

  await act(async () => {
    release();
    await held;
  });
  consoleError.mockRestore();
});
