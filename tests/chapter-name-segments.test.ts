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
  templateNumber: null as number | null,
  alwaysNumber: false,
  renameChapter: vi.fn(),
  prepare: vi.fn(),
}));
// The S12 preference (#1575), driven per test. The real hook caches the stored
// value at module scope, so it is replaced by the same composition over the
// real `lib` table rather than seeded through `localStorage`.
vi.mock("@/hooks/use-settings", async () => {
  const { chapterNameShown } = await import("@/lib/settings");
  const { strings: table } = await import("@/lib/strings");
  return {
    useChapterHeading: (
      name: string | null,
      slot: number,
      templateNumber: number | null = null
    ) =>
      table.chapterHeading(
        chapterNameShown(name, mocks.alwaysNumber),
        // The rule `headingNumber` holds (#1272, Q1 (b)), spelt out so this
        // mock does not lean on the module under test.
        mocks.alwaysNumber ? slot : (templateNumber ?? slot)
      ),
  };
});
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    chapterNumber: 3,
    chapterTemplateNumber: mocks.templateNumber,
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
  mocks.templateNumber = null;
  mocks.alwaysNumber = false;
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

  it("opens an unnamed template chapter on its template's number, not its slot (#1272, Q1 (b))", async () => {
    mocks.templateNumber = 7;
    await openRename();
    expect(field().value).toBe(strings.chapterName(7));
    // Confirmed untouched, that default is still "no label".
    await click(strings.saveName);
    expect(mocks.renameChapter).toHaveBeenCalledWith("");
  });

  it("with Always show chapter numbers on, opens on the stored name and keeps it (#1623)", async () => {
    mocks.chapterName = "The sower";
    mocks.alwaysNumber = true;
    await openRename();
    expect(field().value).toBe("The sower");
    await click(strings.saveName);
    expect(mocks.renameChapter).toHaveBeenCalledTimes(1);
    expect(mocks.renameChapter).toHaveBeenCalledWith("The sower");
  });
});

describe("Share Chapter's MP3 name (#1218)", () => {
  it("uses the chapter's own name", async () => {
    mocks.chapterName = "The sower";
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const [chapter, nameFile] = mocks.prepare.mock.calls[0]!;
    expect(chapter).toBe("chapter");
    // The hook supplies the chapter's slot and the book's chapter count
    // (#1233, #1272): the name takes the slot, never the view's stored
    // number (3 here), so a moved chapter's file sorts in the book's order.
    expect(nameFile(2, 4)).toBe(
      strings.shareFilename("Mark", 2, "The sower", 4)
    );
    expect(nameFile(3, 150)).toBe(
      strings.shareFilename("Mark", 3, "The sower", 150)
    );
  });

  it("labels an unnamed chapter's file the way its title reads: by slot, or a template's number (#1272, Q1 (b))", async () => {
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    const nameFile = mocks.prepare.mock.calls[0]![1];
    expect(nameFile(3, 4)).toBe("Mark - 03 Chapter 3.mp3");

    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    layers.clear();
    mocks.prepare.mockClear();
    mocks.templateNumber = 7;
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    const templated = mocks.prepare.mock.calls[0]![1];
    // The number first is the slot (Q2 (a)); the label is the title.
    expect(templated(3, 4)).toBe("Mark - 03 Chapter 7.mp3");
  });

  it("labels an unnamed chapter by the slot the hook hands over, not the slot this view loaded with (#1272)", async () => {
    // The view loaded at slot 3; by the time the file is named another copy of
    // the app has moved the chapter to slot 2, which is what the hook reads.
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    const nameFile = mocks.prepare.mock.calls[0]![1];
    expect(nameFile(2, 4)).toBe("Mark - 02 Chapter 2.mp3");

    // A template chapter's title keeps the template's number wherever it is.
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    layers.clear();
    mocks.prepare.mockClear();
    mocks.templateNumber = 7;
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.shareChapter);
    const templated = mocks.prepare.mock.calls[0]![1];
    expect(templated(2, 4)).toBe("Mark - 02 Chapter 7.mp3");
  });
});
