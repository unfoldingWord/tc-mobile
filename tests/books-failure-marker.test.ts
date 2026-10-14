// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * The Books ≡ marker keys on the rows that light it, and the menu's problem
 * report keys on every row (#1005; DRI on #1076, verbatim: "Log it, don't
 * light ≡ (Recommended)").
 *
 * So a log holding only a take-cap row leaves ≡ plain, and the report that
 * carries that row off the phone is still in the menu. The two counts are
 * mocked here; `tests/failure-marker.test.ts` covers how the sink produces
 * them. One render per case, then a click to open the menu: no layout, no
 * cascade, no device.
 */

const counts = vi.hoisted(() => ({ total: 0, marked: 0 }));

vi.mock("@/hooks/failure-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/failure-log")>()),
  useFailureCount: () => counts.total,
  useMarkedFailureCount: () => counts.marked,
}));

const mocks = vi.hoisted(() => ({ books: vi.fn() }));
vi.mock("@/hooks/use-books", () => ({ useBooks: mocks.books }));
vi.mock("@/hooks/use-book-share", () => ({
  useBookShare: () => ({
    status: "idle",
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    partialSegments: 0,
    partialChapters: 0,
    progress: { phase: "hidden" },
    prepare: vi.fn(),
    send: vi.fn(),
    reset: () => {},
    dismissProgress: () => {},
    ownsScreen: () => false,
  }),
}));
vi.mock("@/hooks/use-storage-persistence", () => ({
  useStoragePersistence: () => null,
}));

const book: BookCard = {
  bookId: "book" as BookId,
  name: "Genesis",
  number: 1,
  chapters: [],
};

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.books.mockReturnValue({
    books: [book],
    newBookNumber: 2,
    loading: false,
    loaded: true,
    error: null,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: vi.fn(),
    deleting: false,
    isDeleting: () => false,
    deleteFailed: false,
  });
  root = createRoot(document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountBooks() {
  await act(async () =>
    root.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

/** The header's ≡, found by the `control-hinted` wrapper it always sits in. */
function menuButton(): HTMLButtonElement {
  const wrappers = [...document.querySelectorAll("header .control-hinted")];
  const buttons = wrappers
    .map((w) => w.querySelector("button"))
    .filter((b): b is HTMLButtonElement =>
      Boolean(b?.getAttribute("aria-label")?.startsWith(strings.menuOpen))
    );
  expect(buttons).toHaveLength(1);
  return buttons[0]!;
}

function alertMark(button: HTMLButtonElement): Element | null {
  return button.parentElement!.querySelector(":scope > .control-hint");
}

async function openMenu() {
  await act(async () => menuButton().click());
}

function reportControl(): Element | undefined {
  return [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.shareFailureLog
  );
}

describe("the Books ≡ failure marker", () => {
  it("a take-cap row alone leaves ≡ unmarked, and the report is still in the menu", async () => {
    counts.total = 1;
    counts.marked = 0;
    await mountBooks();

    const button = menuButton();
    expect(button.getAttribute("aria-label")).toBe(strings.menuOpen);
    expect(alertMark(button)).toBeNull();

    await openMenu();
    expect(reportControl(), "the problem report's Send").toBeDefined();
  });

  it("a take-cap row plus a real failure marks ≡ with the real failure's count", async () => {
    counts.total = 2;
    counts.marked = 1;
    await mountBooks();

    const button = menuButton();
    expect(button.getAttribute("aria-label")).toBe(
      strings.menuOpenWithFailures(1)
    );
    expect(alertMark(button)).not.toBeNull();
  });

  it("an empty log shows neither the mark nor the report", async () => {
    counts.total = 0;
    counts.marked = 0;
    await mountBooks();

    const button = menuButton();
    expect(alertMark(button)).toBeNull();
    await openMenu();
    expect(reportControl()).toBeUndefined();
  });
});
