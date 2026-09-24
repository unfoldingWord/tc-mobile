// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { licenseTexts } from "@/components/licenses";
import { strings } from "@/components/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * #36 / Codex review at `723f4e24e`: opening About used to hide the global menu
 * with a bare `setMenuOpen(false)`, leaving the `books:global-menu` Back layer
 * registered while About — which had no layer of its own — showed on top. A
 * system Back then dismissed the hidden menu (a no-op) instead of the visible
 * panel, and a following Back at the Books floor could leave the app with About
 * still up. The fix gives About's two levels their own layers — the list is
 * `books:about`, an open licence text is `books:about-text` on top of it — and
 * routes `openAbout` through `closeGlobalMenu` so the menu's layer is dropped as
 * About's is pushed.
 *
 * This drives the same first defect this file guards by simulating a system
 * Back the way `hooks/use-nav-stack.ts` does: dismiss the top layer, then remove
 * it. The `#517` delete-guard test is the harness shape (react-dom + `act()` in
 * jsdom, `pushLayer`/`popLayer` captured into a Map).
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const shelf = (): BookCard[] => [
  {
    bookId,
    name: "Mark",
    chapters: [
      {
        chapterId: "chapter-0000-4000-8000-000000000001" as ChapterId,
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 0,
      },
    ],
  },
];

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf(),
    newBookPlaceholder: "Book 001",
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
vi.mock("@/hooks/failure-log", () => ({ useFailureCount: () => 0 }));
// `BuildStamp` reads the build-time `__APP_VERSION__`/`__BUILD_SHA__` defines,
// which are absent in the test env — mocked to nothing, as the App render test
// does (`tests/app-save-failed-ordinal.test.ts`). This suite is about the Back
// layer stack, not the footer.
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
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // `SourceOfferLink` in the open About list reads the `__BUILD_SHA__` build
  // define; provide it so the panel renders (the build injects the real value).
  vi.stubGlobal("__BUILD_SHA__", "testsha0");
  // A licence text fetches its body on mount; hold it pending so the text view
  // stays mounted (the loading Notice) with no post-`act()` state update.
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
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
        onOpenChapter: vi.fn(),
        pushLayer,
        popLayer,
      })
    );
  });
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

/** The open dialog's accessible name — `strings.aboutTitle` on the list, the
 * licence text's own label while one is open, or `null` when no dialog is up. */
function dialogTitle(): string | null {
  return (
    document.querySelector('[role="dialog"]')?.getAttribute("aria-label") ??
    null
  );
}

/** Simulate a system Back, the way `use-nav-stack.ts` routes one to a layer:
 * dismiss the named top layer, then remove it from the stack. */
async function systemBack(id: string) {
  const layer = layers.get(id);
  expect(layer, `expected layer "${id}" on the stack`).toBeDefined();
  await act(async () => {
    layer!.dismiss();
    popLayer(id);
  });
}

it("registers About's layers, drops the menu's, and system Back pops text → list → shelf", async () => {
  await mount();
  await click(strings.menuOpen);
  expect(layers.has("books:global-menu")).toBe(true);

  await click(strings.aboutOpen);
  // The stale-layer bug: opening About unregisters the menu's layer and pushes
  // About's own, rather than leaving a hidden menu layer to swallow a Back.
  expect(layers.has("books:global-menu")).toBe(false);
  expect(layers.has("books:about")).toBe(true);
  expect(dialogTitle()).toBe(strings.aboutTitle);

  // Opening a licence text stacks a second layer above the list.
  await click(strings.aboutReadText(licenseTexts[0]!.label));
  expect(layers.has("books:about-text")).toBe(true);
  expect(dialogTitle()).toBe(licenseTexts[0]!.label);

  // Back on the text pops to the list; the drawer stays open (matches Escape).
  await systemBack("books:about-text");
  expect(layers.has("books:about-text")).toBe(false);
  expect(layers.has("books:about")).toBe(true);
  expect(dialogTitle()).toBe(strings.aboutTitle);

  // Back on the list closes the whole drawer.
  await systemBack("books:about");
  expect(layers.has("books:about")).toBe(false);
  expect(dialogTitle()).toBeNull();
});

it("the header control matches system Back: text → list, then list → close, unregistering each layer", async () => {
  await mount();
  await click(strings.menuOpen);
  await click(strings.aboutOpen);
  await click(strings.aboutReadText(licenseTexts[0]!.label));
  expect(layers.has("books:about-text")).toBe(true);

  // While a text is open the header control is "Back to the list".
  await click(strings.aboutBack);
  expect(layers.has("books:about-text")).toBe(false);
  expect(layers.has("books:about")).toBe(true);
  expect(dialogTitle()).toBe(strings.aboutTitle);

  // On the list the header control is "Close menu"; it closes the drawer.
  await click(strings.menuClose);
  expect(layers.has("books:about")).toBe(false);
  expect(dialogTitle()).toBeNull();
});
