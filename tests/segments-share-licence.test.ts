// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId } from "@/types/domain";
import type { LicenceId } from "@/types/template";

import { restingErase } from "./support";

/**
 * #1579 item 2: Share Chapter names its file with the book's licence (#1566).
 * Mounted through the whole `SegmentsScreen` with the chapter hook and the
 * share hook mocked, so the test taps the real Share tile and reads the name
 * the screen's own callback builds. Dropping the licence from that call fails
 * here, which no other test noticed.
 */

const mocks = vi.hoisted(() => ({
  licence: null as LicenceId | null,
  prepare: vi.fn<
    (chapterId: string, nameFile: (highest: number) => string) => Promise<null>
  >(() => Promise.resolve(null)),
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    bookCoverHex: null,
    bookLicence: mocks.licence,
    chapterNumber: 4,
    chapterName: null,
    rows: [],
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(async () => true),
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    missing: 0,
    sendUnconfirmed: false,
    ownsScreen: () => false,
    reset: () => {},
    prepare: mocks.prepare,
  }),
}));

let root: Root;
const audio = {
  error: null,
  playingId: null,
  playbackElapsedMs: 0,
  leave: vi.fn(),
} as unknown as UseAudioSession;

beforeEach(() => {
  mocks.prepare.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  mocks.licence = null;
  vi.unstubAllGlobals();
});

async function sharedName(): Promise<string> {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase: restingErase(),
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: vi.fn<(layer: Layer) => void>(),
        popLayer: vi.fn<(id: string) => void>(),
      })
    )
  );
  const tap = async (label: string) => {
    const el = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label
    )!;
    expect(el, label).toBeDefined();
    await act(async () => {
      el.focus();
      el.click();
    });
  };
  await tap(strings.chapterMenuOpen);
  await tap(strings.shareChapter);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  return mocks.prepare.mock.calls[0]![1](4);
}

describe("Share Chapter's file name carries the book's licence (#1579)", () => {
  it("adds the tag for a Creative Commons book", async () => {
    mocks.licence = "CC-BY-SA-4.0";
    expect(await sharedName()).toBe("Mark - 04 Chapter 4 (CC BY-SA 4.0).mp3");
  });

  it("adds none for a book with no licence", async () => {
    expect(await sharedName()).toBe("Mark - 04 Chapter 4.mp3");
  });
});
