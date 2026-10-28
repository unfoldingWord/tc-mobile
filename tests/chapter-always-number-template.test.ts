// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { ALWAYS_CHAPTER_NUMBER_KEY } from "@/lib/settings";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId } from "@/types/domain";

import { restingErase } from "./support";

/**
 * "Always show chapter numbers" (S12, #1575) on an unnamed TEMPLATE chapter
 * (#1747, from #1744's review): the setting moves what the screen shows, and
 * only that.
 *
 * - The chapter crumb reads the slot (3 here), not the template's number (7):
 *   with the setting on, every label is the sequential number.
 * - A shared file's label still reads "Chapter 7", and the rename field still
 *   opens on it: those read `headingNumber(..., false)`, so the setting does
 *   not rename a file or seed a name.
 *
 * Unlike `tests/chapter-name-segments.test.ts`, this file does NOT mock
 * `@/hooks/use-settings`: the crumb goes through the real `useChapterHeading`,
 * so the two paths are both the code under test and cannot drift apart
 * unseen. The setting is seeded through `localStorage` before the first
 * render, which is where the real hook reads it once per module. That is why
 * every case in this file runs with the setting on; the off case is
 * `chapter-name-segments.test.ts`'s.
 */

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    chapterNumber: 3,
    chapterTemplateNumber: 7,
    chapterName: null,
    rows: [],
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    ownsScreen: () => false,
    reset: () => {},
    prepare: mocks.prepare,
  }),
}));

let root: Root;
const layers = new Map<string, Layer>();
const audio = {
  error: null,
  playingId: null,
  playbackElapsedMs: 0,
  leave: () => {},
} as unknown as UseAudioSession;

beforeEach(() => {
  window.localStorage.setItem(ALWAYS_CHAPTER_NUMBER_KEY, "1");
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue(null);
  layers.clear();
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
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
        erase: restingErase(),
      })
    )
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `expected exactly one button labelled "${label}"`).toHaveLength(
    1
  );
  return found[0]!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

describe("Always show chapter numbers on an unnamed template chapter (#1747)", () => {
  it("the chapter crumb reads the slot, not the template's number", async () => {
    await mount();
    const crumb = document.querySelector('[aria-current="page"]');
    expect(crumb?.textContent).toBe(strings.chapterName(3));
  });

  it("the shared file's label still reads the template's number", async () => {
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const nameFile = mocks.prepare.mock.calls[0]![1];
    // The number first is the slot (Q2 (a)); the label is the title the
    // setting does not touch.
    expect(nameFile(3, 4)).toBe("Mark - 03 Chapter 7.mp3");
  });

  it("the rename field still opens on the template's number", async () => {
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.renameChapter);
    const input = document.querySelector<HTMLInputElement>(
      `input[aria-label="${strings.chapterNameField}"]`
    );
    expect(input?.value).toBe(strings.chapterName(7));
  });
});
