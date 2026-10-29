// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { lightsFailureMarker } from "@/lib/failure-marker";
import type { Layer } from "@/lib/nav/layer-stack";
import { strings } from "@/lib/strings";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

import { idleChapterAudio } from "./chapter-audio";

/**
 * #1747 (from #1670, #1707): the book menu reads the open book's provenance to
 * decide whether to offer the Licence tile. A failed read used to end at
 * `console.error` only, so it was never written down. It now reaches the
 * failure funnel as one `"book-provenance-read"` row, with the console line
 * kept beside it, and that row does not light the Books ≡ marker: the safe
 * side of the failure is a hidden tile, and nothing is lost.
 *
 * Mounted through the whole `BooksScreen`, with the book read rejecting and
 * `reportFailure` replaced by a spy, so the test opens the real menu.
 */

const mocks = vi.hoisted(() => ({
  books: [] as BookCard[],
  getBook: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/hooks/report-failure", () => ({
  reportFailure: mocks.report,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: mocks.books,
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
    prepare: vi.fn(() => Promise.resolve(null)),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/lib/storage/books", () => ({
  getBook: mocks.getBook,
  nextChapterNumber: () => 1,
}));
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const mark = "book-0000-4000-8000-000000000001" as BookId;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.report.mockReset();
  mocks.getBook.mockReset();
  mocks.books = [
    { bookId: mark, name: "Mark", number: 1, licence: null, chapters: [] },
  ];
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const byLabel = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );

async function openMenu() {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio(),
        onOpenChapter: vi.fn(),
        pushLayer: vi.fn<(layer: Layer) => void>(),
        popLayer: vi.fn<(id: string) => void>(),
      })
    );
  });
  const open = byLabel(strings.bookMenuOpen("Mark"));
  expect(open).toBeTruthy();
  await act(async () => {
    open!.click();
  });
}

describe("a failed provenance read in the book menu (#1747)", () => {
  it("writes one book-provenance-read row with the cause, keeps the console line, and hides the tile", async () => {
    const cause = new Error("read failed");
    mocks.getBook.mockRejectedValue(cause);
    await openMenu();
    expect(mocks.getBook).toHaveBeenCalledWith(mark);
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledWith(cause, "book-provenance-read");
    expect(consoleError).toHaveBeenCalledWith(
      "Reading a book's provenance failed",
      cause
    );
    expect(byLabel(strings.licenceTileLabel)).toBeUndefined();
  });

  it("writes no row when the read succeeds", async () => {
    mocks.getBook.mockResolvedValue({
      id: mark,
      provenance: { kind: "blank" },
    });
    await openMenu();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(byLabel(strings.licenceTileLabel)).toBeDefined();
  });

  it("is logged but does not light the Books ≡ marker", () => {
    expect(lightsFailureMarker("book-provenance-read")).toBe(false);
  });
});
