// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { idleChapterAudio } from "./chapter-audio";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * Export project outside the installed app (#1457, R3): the Scripture Bundle
 * export works in the installed app only, and the web build points to the app.
 * The whole Books screen is mounted in jsdom with the data hooks mocked, as
 * `books-menus-tiles.test.ts` does. In a browser, tapping Export starts no
 * export and says where it works, in the sheet; in the installed shell the
 * same tap still starts it.
 *
 * What this cannot show: layout, or a phone. Nothing here ran on a device.
 */

const mark = "book-0000-4000-8000-000000000001" as BookId;
const env = vi.hoisted(() => ({
  native: false,
  languageCode: "en" as string | undefined,
  stopChapter: null as unknown as Mock<() => void>,
  prepareProject: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("@/hooks/share-target", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/share-target")>()),
  isNativeShell: () => env.native,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: [
      {
        bookId: mark,
        name: "Mark",
        number: 1,
        coverColourKey: "teal",
        chapters: [],
        languageCode: env.languageCode,
      },
    ] as BookCard[],
    newBookNumber: 1,
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: () => {},
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: () => Promise.resolve("ok"),
    deleting: false,
    isDeleting: () => false,
  }),
}));
vi.mock("@/hooks/use-book-share", () => ({
  useBookShare: () => ({
    status: "idle",
    kind: null,
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    partialSegments: 0,
    progress: { phase: "hidden" },
    prepare: vi.fn(),
    prepareProject: env.prepareProject,
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/lib/storage/books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/books")>()),
  getBook: () => Promise.resolve(null),
}));
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

let root: Root;
const layers = new Map<string, Layer>();

beforeEach(() => {
  env.native = false;
  env.languageCode = "en";
  env.stopChapter = vi.fn<() => void>();
  env.prepareProject = vi.fn(() => Promise.resolve("dismissed"));
  layers.clear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function mountAndOpenMenu() {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio({ stopChapter: env.stopChapter }),
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    );
  });
  await click(strings.bookMenuOpen("Mark"));
}
const sheet = () =>
  document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${strings.bookMenuTitle}"]`
  );

describe("Export project in a browser (R3)", () => {
  it("stops no chapter and opens no language ask, even for a book with no language", async () => {
    env.languageCode = undefined;
    await mountAndOpenMenu();
    await click(strings.exportProject);
    expect(env.stopChapter).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(strings.languageAskTitle);
    expect(env.prepareProject).not.toHaveBeenCalled();
  });

  it("starts no export and points to the installed app, in the sheet", async () => {
    await mountAndOpenMenu();
    expect(sheet()?.textContent).not.toContain(strings.exportProjectWebPointer);
    await click(strings.exportProject);
    expect(env.prepareProject).not.toHaveBeenCalled();
    expect(sheet()?.textContent).toContain(strings.exportProjectWebPointer);
  });

  it("keeps the Export tile on the sheet, so the person can find it", async () => {
    await mountAndOpenMenu();
    expect(button(strings.exportProject)).toBeTruthy();
  });

  it("forgets the pointer when the sheet closes", async () => {
    await mountAndOpenMenu();
    await click(strings.exportProject);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(sheet()).toBeNull();
    await click(strings.bookMenuOpen("Mark"));
    expect(sheet()?.textContent).not.toContain(strings.exportProjectWebPointer);
  });
});

describe("the real native-shell probe", () => {
  it("is false under Vitest, so a browser build takes the pointer path", async () => {
    const real = await vi.importActual<typeof import("@/hooks/share-target")>(
      "@/hooks/share-target"
    );
    expect(real.isNativeShell()).toBe(false);
  });
});

describe("Export project in the installed app", () => {
  it("still starts the export and shows no pointer", async () => {
    env.native = true;
    await mountAndOpenMenu();
    await click(strings.exportProject);
    expect(env.prepareProject).toHaveBeenCalledTimes(1);
    expect(sheet()?.textContent ?? "").not.toContain(
      strings.exportProjectWebPointer
    );
  });
});
