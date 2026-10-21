// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

import { restingErase } from "./support";

/**
 * The ⋮ menu's Stop tile on the real recorder screen (#369, the DRI's
 * 2026-10-19 pick). `tests/recorder-menu-o4.test.ts` covers the tile given its
 * props; this file covers the one link it cannot see, the `recorder.tsx` call
 * site: mid-take, a tap on the tile closes the menu and ends the take through
 * the same handler the transport's own Stop runs, so `stopRecording` is
 * called once, exactly as a tap on the transport Stop calls it.
 *
 * The harness is `tests/recorder-menu-head-wiring.test.ts`'s — paint and
 * audio acquisition mocked, the recorder, its menu and the strings real. The
 * stop never settles here, so what follows a commit is out of this file's
 * view; the commit path itself is unchanged by #369.
 */

const view = {
  bookName: "Ruth",
  bookCoverHex: "#11796d",
  chapterNumber: 4,
  chapterName: null,
  ordinal: 7,
  segmentLabel: null,
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
    setFinished: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

const erase = restingErase();

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

async function mount(recorderState: UseAudioSession["recorderState"]) {
  const ref = createRef<RecorderHandle>();
  // A stop that never settles: the call is what this file asserts.
  const stopRecording = vi.fn(() => new Promise<never>(() => {}));
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
    takeCap: { nearLimit: false, remainingMs: 20 * 60_000, reached: false },
    playTake: vi.fn(),
    playBuffer: vi.fn(),
    stopBuffer: vi.fn(),
    readPlaybackPosition: () => null,
    startRecording: vi.fn(),
    stopRecording: stopRecording as unknown as UseAudioSession["stopRecording"],
    retryDecode: vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
    chapterPlay: {
      chapterId: null,
      status: "idle" as const,
      pausedFraction: null,
    },
    playChapter: () => {},
    pauseChapter: () => {},
    stopChapter: () => {},
    readChapterProgress: () => null,
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
        erase,
        onExit: vi.fn(),
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  return { audio, stopRecording };
}

const byLabel = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );

async function openMenu(): Promise<Element> {
  const opener = byLabel(document, strings.recorderMenuOpen);
  expect(opener, "the ⋮ opener").toBeDefined();
  await act(async () => opener!.click());
  const panel = document.querySelector(".menu-panel");
  expect(panel, "the ⋮ drawer").not.toBeNull();
  return panel!;
}

describe("the recorder's ⋮ menu Stop tile (#369)", () => {
  it("mid-take, closes the menu and stops the take once, through the transport's own path", async () => {
    const { stopRecording } = await mount("recording");
    const panel = await openMenu();
    const tile = byLabel(panel, strings.stop);
    expect(tile, "the menu's Stop tile").toBeDefined();
    // The first tile in the drawer (the DRI's "first row").
    expect(panel.querySelector("button.o4-tile")).toBe(tile);
    await act(async () => tile!.click());
    expect(document.querySelector(".menu-panel")).toBeNull();
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it("calls stopRecording exactly as often as the transport Stop does", async () => {
    const { stopRecording } = await mount("recording");
    const transport = byLabel(
      document.querySelector(".recorder-sheet")!,
      strings.stop
    );
    expect(transport, "the transport Stop").toBeDefined();
    await act(async () => transport!.click());
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it("at idle, the menu has no Stop tile", async () => {
    const { stopRecording } = await mount("idle");
    const panel = await openMenu();
    expect(byLabel(panel, strings.stop)).toBeUndefined();
    expect(stopRecording).not.toHaveBeenCalled();
  });
});
