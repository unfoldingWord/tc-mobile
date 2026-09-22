// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/components/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

const mocks = vi.hoisted(() => ({ chapter: vi.fn() }));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: mocks.chapter,
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
// A PROP now, not a module the screen reaches for (#160, L-12): App holds the
// one instance. Mocking the module here would no longer intercept anything.
const erase = {
  erase: vi.fn(async () => "ok" as const),
  erasing: false,
  isErasing: () => false,
};

let root: Root;
let clipboard: string | null;
const layers = new Map<string, Layer>();
const onBack = vi.fn(() => {
  clipboard = null;
});
const pushLayer = (layer: Layer) => layers.set(layer.id, layer);
const popLayer = vi.fn((id: string) => {
  layers.delete(id);
});
const addSegment = vi.fn();
const row: SegmentRow = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  hasClip: false,
  finished: false,
  clipId: null,
  peaks: null,
  durationMs: null,
};
const audio = {
  error: null,
  playingId: null,
  playbackElapsedMs: 0,
} as UseAudioSession;
const gone = "This chapter is no longer available. Go back to Books.";

beforeEach(() => {
  vi.clearAllMocks();
  layers.clear();
  clipboard = "copied audio";
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function render(staleTarget: boolean, rows: SegmentRow[] = []) {
  mocks.chapter.mockReturnValue({
    bookName: "Book",
    chapterNumber: 1,
    chapterName: null,
    rows,
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget,
    addSegment,
    reload: vi.fn(),
    renameChapter: vi.fn(),
  });
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase,
        onBack,
        onOpenRecorder: vi.fn(),
        pushLayer,
        popLayer,
      })
    )
  );
}
function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === label
  );
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  await act(async () => button(label)!.click());
}

it("keeps the rename menu layer until Close and leaves clipboard clearing to explicit Back", async () => {
  await render(false);
  await click(strings.chapterMenuOpen);
  await click(strings.renameChapter);
  expect(document.querySelector("input")).not.toBeNull();
  expect(layers.has("segments:chapter-menu")).toBe(true);
  await render(true);
  expect(onBack).not.toHaveBeenCalled();
  expect(clipboard).toBe("copied audio");
  const menu = document.querySelector('[role="dialog"]');
  expect(menu?.textContent).toContain(gone);
  expect(menu?.querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(button(strings.menuClose));
  expect(menu?.querySelectorAll("button").length).toBe(1);
  expect(layers.has("segments:chapter-menu")).toBe(true);
  expect(popLayer).not.toHaveBeenCalled();
  await click(strings.menuClose);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(layers.size).toBe(0);
  expect(document.querySelector("header")?.hasAttribute("inert")).toBe(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(gone);
  expect(clipboard).toBe("copied audio");
  await click(strings.backToBooks);
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(clipboard).toBeNull();
});

it.each([{ rows: [] }, { rows: [row] }])(
  "renders a stale initial chapter without enabled writes for rows %j",
  async ({ rows }) => {
    await render(true, rows);
    expect(onBack).not.toHaveBeenCalled();
    expect(clipboard).toBe("copied audio");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      gone
    );
    expect(document.querySelectorAll("li").length).toBe(0);
    expect(document.body.textContent).not.toContain(strings.segmentsEmptyTeach);
    expect(button(strings.addSegment)?.disabled).toBe(true);
    expect(button(strings.chapterMenuOpen)?.disabled).toBe(true);
    await click(strings.addSegment);
    await click(strings.chapterMenuOpen);
    expect(addSegment).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(strings.backToBooks);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(clipboard).toBeNull();
  }
);
