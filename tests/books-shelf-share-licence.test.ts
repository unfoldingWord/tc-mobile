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
  setBookLicence: vi.fn(),
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
vi.mock("@/lib/storage/licence", () => ({
  setBookLicence: mocks.setBookLicence,
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
  mocks.setBookLicence.mockReset();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function shelfShare(licence: BookCard["licence"], pick?: string) {
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
  if (pick) {
    // A book with no licence asks first and prepares nothing from the tap
    // (#1455); the pick is stored, and only then does the share run.
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.setBookLicence.mockImplementation(
      async (_id: string, chosen: string) => ({ id: mark, licence: chosen })
    );
    const row = document.querySelector<HTMLElement>(
      `[role="radio"][data-licence="${pick}"]`
    )!;
    await act(async () => row.click());
    await tap(strings.licenceAskContinue);
    expect(mocks.setBookLicence).toHaveBeenCalledWith(mark, pick);
  }
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

  it("asks a book with no licence first, writes the pick, then tags the files with it (#1455)", async () => {
    expect(await shelfShare(null, "CC-BY-4.0")).toEqual({
      zip: "Mark (CC BY 4.0).zip",
      chapter: "Mark - 04 Chapter 4 (CC BY 4.0).mp3",
    });
  });

  it("shares and writes nothing when the ask is cancelled (#1455)", async () => {
    await expect(
      shelfShare(null, undefined).catch(() => "no-prepare")
    ).resolves.toBe("no-prepare");
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    const cancel = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === strings.licenceAskCancel
    )!;
    await act(async () => cancel.click());
    expect(mocks.setBookLicence).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("never asks a book that already has a licence, a template book included (D5)", async () => {
    await shelfShare("all-rights-reserved");
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(mocks.setBookLicence).not.toHaveBeenCalled();
  });

  it("keeps the ask up while the write is in flight, then shares with the pick", async () => {
    let release: (book: unknown) => void = () => {};
    mocks.setBookLicence.mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );
    mocks.books = [
      { bookId: mark, name: "Mark", number: 1, licence: null, chapters: [] },
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
    const byLabel = (label: string) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label
      )!;
    const click = async (el: HTMLElement) =>
      act(async () => {
        el.focus();
        el.click();
      });
    await click(byLabel(strings.bookMenuOpen("Mark")));
    await click(byLabel(strings.shareBook));
    await click(byLabel(strings.licenceAskContinue));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);

    // Cancel, a second pick and the sheet's own Close are all inert mid-write.
    const cancel = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === strings.licenceAskCancel
    )!;
    await click(cancel);
    await click(
      document.querySelector<HTMLElement>(
        '[role="radio"][data-licence="CC0-1.0"]'
      )!
    );
    await click(byLabel(strings.menuClose));
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();

    await act(async () => release({ id: mark, licence: "CC-BY-SA-4.0" }));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);
    expect(mocks.setBookLicence).toHaveBeenCalledWith(mark, "CC-BY-SA-4.0");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0]![1]).toBe("Mark (CC BY-SA 4.0).zip");
  });

  it("keeps the book-menu layer busy while the write is in flight, so Back cannot drop it", async () => {
    let release: (book: unknown) => void = () => {};
    mocks.setBookLicence.mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );
    mocks.books = [
      { bookId: mark, name: "Mark", number: 1, licence: null, chapters: [] },
    ];
    const layers: Layer[] = [];
    await act(async () => {
      root.render(
        createElement(BooksScreen, {
          audio: idleChapterAudio(),
          onOpenChapter: vi.fn(),
          pushLayer: (layer: Layer) => layers.push(layer),
          popLayer: vi.fn<(id: string) => void>(),
        })
      );
    });
    const byLabel = (label: string) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label
      )!;
    const click = async (el: HTMLElement) =>
      act(async () => {
        el.focus();
        el.click();
      });
    await click(byLabel(strings.bookMenuOpen("Mark")));
    await click(byLabel(strings.shareBook));
    const menu = () => layers.filter((l) => l.id === "books:book-menu").at(-1)!;
    // Asking, not yet saving: Back may close the sheet.
    expect(menu().busy()).toBe(false);
    await click(byLabel(strings.licenceAskContinue));

    // Saving: the adapter reads busy() and, when true, neither dismisses nor
    // unregisters the layer, however many Backs arrive.
    for (let back = 0; back < 3; back++) expect(menu().busy()).toBe(true);
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();

    // Settled: busy lifts, and a normal dismissal closes the sheet.
    await act(async () => release({ id: mark, licence: "CC-BY-SA-4.0" }));
    expect(menu().busy()).toBe(false);
    await act(async () => menu().dismiss());
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
