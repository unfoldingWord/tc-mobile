// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { idleChapterAudio } from "./chapter-audio";
import { ALWAYS_CHAPTER_NUMBER_KEY } from "@/lib/settings";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * The Settings screen (#1575), opened by the gear in the Books header: it
 * opens, holds the theme row and the chapter-number row, closes through its
 * Back and through system Back, and the theme left the ≡ menu for it.
 * The cascade and the persistence across a reload are
 * `e2e/settings-screen.spec.ts`'s; this is one client render with the storage mocked
 * out of the picture by jsdom's own `localStorage`.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const shelf = (): BookCard[] => [
  {
    bookId,
    name: "Mark",
    number: 1,
    chapters: [
      {
        chapterId: "chapter-0000-4000-8000-000000000001" as ChapterId,
        number: 3,
        name: "Mark 6",
        finishedCount: 0,
        totalCount: 0,
        recordedCount: 0,
      },
    ],
  },
];

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf(),
    newBookNumber: 1,
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: vi.fn(),
    deleting: false,
    isDeleting: () => false,
  }),
}));
vi.mock("@/hooks/use-book-share", () => ({
  useBookShare: () => ({
    status: "idle",
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    partialSegments: 0,
    progress: { phase: "hidden" },
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/components/build-stamp", () => ({ BuildStamp: () => null }));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

let root: Root;
const layers = new Map<string, Layer>();
const pushLayer = (layer: Layer) => layers.set(layer.id, layer);
const popLayer = (id: string) => {
  layers.delete(id);
};

beforeEach(() => {
  layers.clear();
  window.localStorage.clear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio(),
        onOpenChapter: vi.fn(),
        pushLayer,
        popLayer,
      })
    );
  });
}

function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
}
function button(label: string): HTMLButtonElement {
  const found = buttons(label);
  expect(found, `expected exactly one button labelled "${label}"`).toHaveLength(
    1
  );
  return found[0]!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
const dialogTitle = () =>
  document.querySelector('[role="dialog"]')?.getAttribute("aria-label") ?? null;
/** The chapter row's visible title, the text the setting changes. */
const chapterTitle = () =>
  document.querySelector(".books-chapter-title")?.textContent ?? null;

it("the gear opens Settings, and Back to Books closes it", async () => {
  await mount();
  expect(dialogTitle()).toBeNull();
  await click(strings.settingsOpen);
  expect(dialogTitle()).toBe(strings.settingsTitle);
  expect(layers.has("books:settings")).toBe(true);

  await click(strings.backToBooks);
  expect(dialogTitle()).toBeNull();
  expect(layers.has("books:settings")).toBe(false);
});

it("system Back dismisses Settings", async () => {
  await mount();
  await click(strings.settingsOpen);
  const layer = layers.get("books:settings");
  expect(layer).toBeDefined();
  await act(async () => {
    layer!.dismiss();
    popLayer("books:settings");
  });
  expect(dialogTitle()).toBeNull();
});

it("the theme control moved: Settings holds it and the ≡ menu does not", async () => {
  await mount();
  await click(strings.menuOpen);
  expect(buttons(strings.useLightTheme)).toHaveLength(0);
  expect(buttons(strings.useDarkTheme)).toHaveLength(0);
  await click(strings.menuClose);

  await click(strings.settingsOpen);
  // Dark is the default, so the row names its destination, light.
  expect(buttons(strings.useLightTheme)).toHaveLength(1);
  await click(strings.useLightTheme);
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(buttons(strings.useDarkTheme)).toHaveLength(1);
});

it("the chapter-number row shows its state, persists, and changes the shelf's label", async () => {
  await mount();
  await click(strings.bookRow("Mark", 1, false));
  // Off by default: the chapter's name when it has one.
  expect(chapterTitle()).toBe("Mark 6");

  await click(strings.settingsOpen);
  const row = button(strings.settingsChapterNumbers);
  expect(row.getAttribute("aria-pressed")).toBe("false");

  await click(strings.settingsChapterNumbers);
  expect(
    button(strings.settingsChapterNumbers).getAttribute("aria-pressed")
  ).toBe("true");
  expect(window.localStorage.getItem(ALWAYS_CHAPTER_NUMBER_KEY)).toBe("1");
  expect(chapterTitle()).toBe(strings.chapterName(3));

  await click(strings.settingsChapterNumbers);
  expect(window.localStorage.getItem(ALWAYS_CHAPTER_NUMBER_KEY)).toBe("0");
  expect(chapterTitle()).toBe("Mark 6");
});
