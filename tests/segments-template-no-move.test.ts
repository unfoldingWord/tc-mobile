// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { restingErase } from "./support";

/**
 * #1969 (DRI pick, 2026-11-13): a segment of a book made from a template has
 * no Move, neither the menu's Move up / Move down tiles nor the press-and-hold
 * drag, because its order is the template's. A hand-made book keeps both. The
 * real `SegmentsScreen` and `SegmentRow` are mounted with the chapter hook
 * replaced at its boundary; the one input that differs is `bookFromTemplate`.
 * Layout is faked and no device is involved.
 */

const mocks = vi.hoisted(() => ({
  fromTemplate: false,
  moveSegment: vi.fn(),
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Book",
    bookFromTemplate: mocks.fromTemplate,
    chapterNumber: 1,
    chapterName: null,
    rows: [0, 1, 2].map((i): Row => ({
      segmentId: `s${i}` as SegmentId,
      ordinal: i + 1,
      label: null,
      hasClip: true,
      finished: false,
      clipId: `c${i}` as ClipId,
      peaks: null,
      durationMs: 1000,
    })),
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(),
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    moveSegment: mocks.moveSegment,
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    ownsScreen: () => false,
    reset: () => {},
  }),
}));

const audio = {
  error: null,
  playingId: null,
  playingBuffer: false,
  playbackElapsedMs: 0,
  playbackRanOut: false,
  playTake: vi.fn(),
  leave: vi.fn(),
  stopBuffer: vi.fn(),
} as unknown as UseAudioSession;

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountAndOpenMenu() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase: restingErase(),
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
  const menu = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.segmentMenu(2)
  )!;
  await act(async () => menu.click());
}

const text = () => document.body.textContent ?? "";

describe("segment Move in a template book (#1969)", () => {
  it("shows no Move tiles and no hold handle when the book came from a template", async () => {
    mocks.fromTemplate = true;
    await mountAndOpenMenu();
    expect(text()).not.toContain(strings.moveUp);
    expect(text()).not.toContain(strings.moveDown);
    expect(document.querySelector("[data-reorder-handle]")).toBeNull();
  });

  it("keeps both in a hand-made book", async () => {
    mocks.fromTemplate = false;
    await mountAndOpenMenu();
    expect(text()).toContain(strings.moveUp);
    expect(text()).toContain(strings.moveDown);
    expect(document.querySelector("[data-reorder-handle]")).not.toBeNull();
  });
});

describe("segment Delete in a template book (#1979)", () => {
  it("shows no Delete tile when the book came from a template", async () => {
    mocks.fromTemplate = true;
    await mountAndOpenMenu();
    expect(text()).not.toContain(strings.tileDelete);
  });

  it("keeps Delete in a hand-made book", async () => {
    mocks.fromTemplate = false;
    await mountAndOpenMenu();
    expect(text()).toContain(strings.tileDelete);
  });
});
