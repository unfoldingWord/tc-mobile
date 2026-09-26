// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import type { CoverColourKey } from "@/lib/cover-colour";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * The Books screen's two menus on the O4 tile grid (#949): the book menu
 * (state 04) with #937 D7's Cover colour tile, and the app ≡ menu (the
 * workbench's G1). The whole screen is mounted with react-dom + `act()` in
 * jsdom, with the data hooks mocked the way
 * `tests/books-delete-in-sheet-o4.test.ts` mocks them.
 *
 * The cover write is #964's hook, mocked here: this file checks the screen
 * calls it with the book and the chosen key, and what the sheet does with
 * each outcome. That the write persists is #964's own storage tests.
 *
 * What this cannot show: the cascade, layout, or real `inert` hit-testing.
 * Nothing here was run on a phone.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  reload: null as unknown as () => void,
  failures: 0,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: state.books,
    newBookPlaceholder: "Book 001",
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: () => state.reload(),
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
type CoverResult =
  { ok: true; book: unknown } | "busy" | { failed: "saveFailed" | "noRoom" };
const cover = vi.hoisted(() => ({
  calls: [] as [BookId, CoverColourKey | null][],
  result: null as unknown as () => Promise<CoverResult>,
}));
vi.mock("@/hooks/use-book-cover-colour", () => ({
  useBookCoverColour: () => ({
    setCoverColour: (id: BookId, key: CoverColourKey | null) => {
      cover.calls.push([id, key]);
      return cover.result();
    },
    settingCoverColour: false,
  }),
}));
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => state.failures,
}));
// The panel's own share and clear are `tests/failure-log*.test.ts`'s. Here it
// stands in as its first control, so the test can see where it sits.
vi.mock("@/components/failure-log-panel", async () => {
  const { createElement: h } = await import("react");
  const { strings: s } = await import("@/lib/strings");
  return {
    FailureLogPanel: () =>
      h("button", { type: "button", "aria-label": s.shareFailureLog }),
  };
});
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const mark = "book-0000-4000-8000-000000000001" as BookId;
const ruth = "book-0000-4000-8000-000000000002" as BookId;
const shelf = (): BookCard[] => [
  { bookId: mark, name: "Mark", coverColourKey: "teal", chapters: [] },
  { bookId: ruth, name: "Ruth", coverColourKey: null, chapters: [] },
];

let root: Root;
const layers = new Map<string, Layer>();
let reloads = 0;

beforeEach(() => {
  layers.clear();
  state.books = shelf();
  state.failures = 0;
  reloads = 0;
  state.reload = () => {
    reloads += 1;
  };
  cover.calls = [];
  cover.result = () => Promise.resolve({ ok: true, book: {} });
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  design.current = "o4";
});

async function mount(look: Design = "o4") {
  design.current = look;
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
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
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
/** Focus the opener first, as a tap would, so focus return has a target. */
async function openFrom(label: string) {
  const opener = button(label);
  opener.focus();
  await act(async () => opener.click());
}
async function key(k: string) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true })
    );
  });
}
function dialog(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${name}"]`
  );
}
const bookSheet = () => dialog(strings.bookMenuTitle);
const appMenu = () => dialog(strings.menuTitle);
function tilesIn(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>(".o4-tiles button")];
}
function swatch(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".cover-swatch"),
  ].filter((s) => s.title === name);
  expect(found, `one swatch named ${name}`).toHaveLength(1);
  return found[0]!;
}

describe("O4: the book menu on the tile grid (04)", () => {
  it("draws Share and Cover colour, then Delete past a gap; Rename is the head's pencil", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    const sheet = bookSheet();
    expect(sheet).not.toBeNull();
    const grid = sheet!.querySelector(".o4-tiles");
    expect(grid, "the sheet holds one tile grid").not.toBeNull();
    const labels = tilesIn(sheet!).map((t) => t.getAttribute("aria-label"));
    expect(labels).toEqual([
      strings.shareBook,
      strings.coverColourLabel,
      strings.deleteBook,
    ]);
    // Delete sits past the spacer, at the far end, as the workbench draws it.
    const kids = [...grid!.children];
    const gapAt = kids.findIndex((k) => k.classList.contains("o4-tiles-gap"));
    const deleteAt = kids.findIndex((k) =>
      k.contains(button(strings.deleteBook))
    );
    expect(gapAt).toBeGreaterThan(-1);
    expect(deleteAt).toBe(gapAt + 1);
    expect(button(strings.deleteBook).classList).toContain("o4-tile--erase");
    // Rename is the head's pencil, beside the book's small cover and name.
    const pen = button(strings.renameBook);
    expect(pen.classList).toContain("o4-head-pen");
    expect(pen.closest(".o4-tiles")).toBeNull();
    const bar = pen.closest(".o4-sheet-bar");
    expect(bar?.querySelector(".books-sheet-name")?.textContent).toBe("Mark");
  });

  it("gives every tile a spoken name that contains its caption", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    const tiles = tilesIn(bookSheet()!);
    expect(tiles.length).toBe(3);
    for (const tile of tiles) {
      const caption = tile.querySelector(".control-caption")?.textContent;
      expect(caption, tile.getAttribute("aria-label") ?? "").toBeTruthy();
      expect(tile.getAttribute("aria-label")!.toLowerCase()).toContain(
        caption!.toLowerCase()
      );
    }
  });

  it("lands first focus on Rename, as the current look does, and returns focus to the ⋮ on Escape", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    expect(document.activeElement).toBe(button(strings.renameBook));
    await key("Escape");
    expect(bookSheet()).toBeNull();
    expect(document.activeElement).toBe(button(strings.bookMenuOpen("Mark")));
  });

  it("keeps #1030's in-sheet ask: Delete swaps to Keep and Delete, and Keep comes back to the Delete tile", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    await click(strings.deleteBook);
    expect(document.activeElement).toBe(button(strings.keepBook));
    expect(bookSheet()!.querySelector(".o4-tiles")).toBeNull();
    await click(strings.keepBook);
    expect(document.activeElement).toBe(button(strings.deleteBook));
    expect(button(strings.deleteBook).classList).toContain("o4-tile");
  });
});

describe("O4: the Cover colour tile opens #964's picker (#937 D7)", () => {
  it("swaps the tiles for the picker, focused on the book's own colour", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    await click(strings.coverColourLabel);
    const sheet = bookSheet()!;
    expect(sheet.querySelector(".cover-swatch-row")).not.toBeNull();
    expect(buttons(strings.shareBook)).toHaveLength(0);
    expect(buttons(strings.deleteBook)).toHaveLength(0);
    expect(buttons(strings.renameBook)).toHaveLength(0);
    const teal = swatch(strings.coverColourTeal);
    expect(teal.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(teal);
    // One layer still: the picker is a mode of the same sheet, like rename.
    expect([...layers.keys()]).toEqual(["books:book-menu"]);
  });

  it("writes the chosen colour through #964's hook, reloads the shelf, and returns to the tiles on the Cover colour tile", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    await click(strings.coverColourLabel);
    await act(async () => swatch(strings.coverColourForest).click());
    expect(cover.calls).toEqual([[mark, "forest"]]);
    expect(reloads).toBe(1);
    expect(document.querySelector(".cover-swatch-row")).toBeNull();
    expect(document.activeElement).toBe(button(strings.coverColourLabel));
  });

  it("stays on the picker and says so when the write fails", async () => {
    cover.result = () => Promise.resolve({ failed: "saveFailed" });
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    await click(strings.coverColourLabel);
    await act(async () => swatch(strings.coverColourForest).click());
    expect(cover.calls).toEqual([[mark, "forest"]]);
    expect(reloads).toBe(0);
    const sheet = bookSheet()!;
    expect(sheet.querySelector(".cover-swatch-row")).not.toBeNull();
    expect(sheet.textContent).toContain(strings.saveFailed);
  });

  it("closing the sheet from the picker ends it: the next open shows the tiles", async () => {
    await mount();
    await openFrom(strings.bookMenuOpen("Mark"));
    await click(strings.coverColourLabel);
    await key("Escape");
    expect(bookSheet()).toBeNull();
    expect(document.activeElement).toBe(button(strings.bookMenuOpen("Mark")));
    await openFrom(strings.bookMenuOpen("Mark"));
    expect(document.querySelector(".cover-swatch-row")).toBeNull();
    expect(button(strings.coverColourLabel)).toBeTruthy();
  });
});

describe("O4: the app ≡ menu on tiles (the workbench's G1)", () => {
  it("puts the theme tile at the far end of a tile grid, its name holding its caption", async () => {
    await mount();
    await openFrom(strings.menuOpen);
    const menu = appMenu();
    expect(menu).not.toBeNull();
    const grid = menu!.querySelector(".o4-tiles");
    expect(grid).not.toBeNull();
    const kids = [...grid!.children];
    expect(kids[0]!.classList).toContain("o4-tiles-gap");
    const tiles = tilesIn(menu!);
    expect(tiles).toHaveLength(1);
    const theme = tiles[0]!;
    expect(theme.classList).toContain("o4-tile--plain");
    const caption = theme.querySelector(".control-caption")!.textContent!;
    expect(theme.getAttribute("aria-label")!.toLowerCase()).toContain(
      caption.toLowerCase()
    );
    // The theme tile is the first thing focus lands on, as the toggle is now.
    expect(document.activeElement).toBe(theme);
    await key("Escape");
    expect(document.activeElement).toBe(button(strings.menuOpen));
  });

  it("keeps the problem report first when the log holds something", async () => {
    state.failures = 2;
    await mount();
    await openFrom(strings.menuOpenWithFailures(2));
    const menu = appMenu()!;
    const report = button(strings.shareFailureLog);
    const theme = tilesIn(menu).at(-1)!;
    expect(
      report.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(document.activeElement).toBe(report);
  });
});

describe("switch off: both menus are the current rows", () => {
  it("draws no tiles and no Cover colour control in the book menu", async () => {
    await mount("current");
    await openFrom(strings.bookMenuOpen("Mark"));
    expect(bookSheet()!.querySelector(".o4-tiles")).toBeNull();
    expect(buttons(strings.coverColourLabel)).toHaveLength(0);
    expect(button(strings.renameBook).classList).not.toContain("o4-head-pen");
  });

  it("draws no tiles in the app menu", async () => {
    await mount("current");
    await openFrom(strings.menuOpen);
    expect(appMenu()!.querySelector(".o4-tiles")).toBeNull();
  });
});
