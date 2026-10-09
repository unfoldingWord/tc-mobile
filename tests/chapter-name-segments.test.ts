// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId } from "@/types/domain";

import { restingErase } from "./support";

/**
 * #1219 and #1218 on the Segments screen, the chapter's own screen:
 *
 * - the chapter rename sheet opens with the chapter's CURRENT name in its
 *   field — the typed name, or the default "Chapter N" when it has none;
 * - confirming that default untouched stores no label (the same "Confirm alone
 *   is the one-tap" contract the New Chapter prompt holds, #609), so the
 *   default stays derived from the number and follows a reorder (#953);
 * - Share Chapter names its MP3 from the chapter's name, as Share Book does.
 *
 * Shape copied from `tests/segments-rename-busy-notice.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  chapterName: null as string | null,
  renameChapter: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    chapterNumber: 3,
    chapterName: mocks.chapterName,
    rows: [],
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: mocks.renameChapter,
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
const erase = restingErase();

beforeEach(() => {
  mocks.chapterName = null;
  mocks.renameChapter.mockReset();
  mocks.renameChapter.mockResolvedValue(true);
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
        erase,
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

function field(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${strings.chapterNameField}"]`
  );
  expect(input).not.toBeNull();
  return input!;
}

async function type(value: string) {
  await act(async () => {
    const input = field();
    // React tracks the value setter on the instance; go through the prototype
    // so the change is seen as a user edit.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openRename() {
  await mount();
  await click(strings.chapterMenuOpen);
  await click(strings.renameChapter);
}

describe("the chapter rename sheet (#1219)", () => {
  it("opens with the default name when the chapter has none", async () => {
    await openRename();
    expect(field().value).toBe(strings.chapterName(3));
  });

  it("opens with the typed name when the chapter has one", async () => {
    mocks.chapterName = "The sower";
    await openRename();
    expect(field().value).toBe("The sower");
  });

  it("stores no label when the default is confirmed untouched", async () => {
    await openRename();
    await click(strings.saveName);
    expect(mocks.renameChapter).toHaveBeenCalledTimes(1);
    expect(mocks.renameChapter).toHaveBeenCalledWith("");
  });

  it("arrives with the default selected, and a typed name does not (#1233 item 25)", async () => {
    await openRename();
    expect([field().selectionStart, field().selectionEnd]).toEqual([
      0,
      strings.chapterName(3).length,
    ]);
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    layers.clear();
    mocks.chapterName = "The sower";
    await openRename();
    expect(field().selectionStart).toBe(field().selectionEnd);
  });

  it("stores a label when the default is edited into a real name (#1233 item 24)", async () => {
    await openRename();
    await type("The sower");
    await click(strings.saveName);
    expect(mocks.renameChapter).toHaveBeenCalledWith("The sower");
  });

  it("treats the default with a stray trailing space as the default (#1233 item 24)", async () => {
    await openRename();
    await type(`${strings.chapterName(3)} `);
    await click(strings.saveName);
    expect(mocks.renameChapter).toHaveBeenCalledWith("");
  });

  it("passes a typed name through unchanged", async () => {
    mocks.chapterName = "The sower";
    await openRename();
    await click(strings.saveName);
    expect(mocks.renameChapter).toHaveBeenCalledWith("The sower");
  });
});

describe("Share Chapter's MP3 name (#1218)", () => {
  it("uses the chapter's own name", async () => {
    mocks.chapterName = "The sower";
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    expect(mocks.prepare).toHaveBeenCalledWith(
      "chapter",
      strings.shareFilename("Mark", 3, "The sower")
    );
    expect(strings.shareFilename("Mark", 3, "The sower")).toBe(
      "Mark - The sower.mp3"
    );
  });
});
