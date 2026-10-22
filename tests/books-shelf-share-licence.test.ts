// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import type { Layer } from "@/lib/nav/layer-stack";
import { strings } from "@/lib/strings";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

import { idleChapterAudio } from "./chapter-audio";

/**
 * #1579 item 3: the Books shelf's book menu names Share Book's zip and the
 * chapter files inside it with the book's licence (#1566), the same as Share
 * Chapter and Share your work do, so one book is not called two things.
 * Mounted through the whole `BooksScreen` with the book-share hook mocked, so
 * the test taps the real Share tile and reads the names the screen builds.
 */

const mocks = vi.hoisted(() => ({
  books: [] as BookCard[],
  prepare: vi.fn<
    (
      bookId: string,
      zipFilename: string,
      nameChapter: (
        chapterNumber: number,
        chapterName: string | null,
        highestNumber: number
      ) => string
    ) => Promise<null>
  >(() => Promise.resolve(null)),
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
    prepare: mocks.prepare,
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
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const mark = "book-0000-4000-8000-000000000001" as BookId;
let root: Root;

beforeEach(() => {
  mocks.prepare.mockClear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function shelfShare(licence: BookCard["licence"]) {
  mocks.books = [
    { bookId: mark, name: "Mark", number: 1, licence, chapters: [] },
  ];
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
  const tap = async (label: string) => {
    const el = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label
    )!;
    expect(el, label).toBeDefined();
    await act(async () => {
      el.focus();
      el.click();
    });
  };
  await tap(strings.bookMenuOpen("Mark"));
  await tap(strings.shareBook);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  const [, zip, nameChapter] = mocks.prepare.mock.calls[0]!;
  return { zip, chapter: nameChapter(4, null, 4) };
}

describe("the shelf's Share Book names its files with the licence (#1579)", () => {
  it("tags the zip and each chapter file for a Creative Commons book", async () => {
    expect(await shelfShare("CC-BY-SA-4.0")).toEqual({
      zip: "Mark (CC BY-SA 4.0).zip",
      chapter: "Mark - 04 Chapter 4 (CC BY-SA 4.0).mp3",
    });
  });

  it("tags nothing for a book with no licence", async () => {
    expect(await shelfShare(null)).toEqual({
      zip: "Mark.zip",
      chapter: "Mark - 04 Chapter 4.mp3",
    });
  });
});
