// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

/**
 * The recorder screen hands its view's book name and chapter number to the
 * ≡ menu's O4 sheet head (#949 G3). `tests/recorder-menu-head-o4.test.ts`
 * covers the head given those props; this file covers the one link it cannot
 * see, the `recorder.tsx` call site, by opening the menu on the real sheet.
 *
 * The harness is `tests/recorder-menu-header.test.ts`'s — paint and audio
 * acquisition mocked, the recorder, its menu and the strings real — plus
 * `useDesign()` mocked so each case picks its look.
 */
const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const view = {
  bookName: "Ruth",
  chapterNumber: 4,
  chapterName: null,
  ordinal: 7,
  segmentLabel: null,
  finished: true,
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

const erase = {
  erase: vi.fn(async () => "ok" as const),
  erasing: false,
  isErasing: () => false,
};

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

async function openMenu(look: Design): Promise<Element> {
  design.current = look;
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
        erase,
        onExit: vi.fn(),
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  const opener = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.recorderMenuOpen
  );
  expect(opener, "the ≡ opener").toBeDefined();
  await act(async () => opener!.click());
  const panel = document.querySelector(".menu-panel");
  expect(panel, "the ≡ drawer").not.toBeNull();
  return panel!;
}

describe("the recorder screen's ≡ menu head (G3)", () => {
  it("crumbs the view's book, chapter and segment, the segment tinted done (o4)", async () => {
    const panel = await openMenu("o4");
    expect(
      [...panel.querySelectorAll(".o4-sheet-head .o4-crumb")].map((c) => [
        c.textContent,
        c.getAttribute("data-state"),
      ])
    ).toEqual([
      ["Ruth", null],
      ["4", null],
      ["7", "finished"],
    ]);
  });

  it("draws no head in the current look", async () => {
    const panel = await openMenu("current");
    expect(panel.querySelector(".o4-sheet-head")).toBeNull();
  });
});
