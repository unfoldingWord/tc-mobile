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
 * #1455 "change it later": the book menu's Licence tile reopens the licence
 * ask with the stored licence selected, stores a new pick without sharing, and
 * is absent for a book made from a template (D5 `lock-template`). Mounted
 * through the whole `BooksScreen`, with the book read, the writer and the
 * share hook mocked, so the test taps the real tile.
 */

const mocks = vi.hoisted(() => ({
  books: [] as BookCard[],
  kind: "blank" as "blank" | "template",
  status: "idle" as "idle" | "preparing" | "ready",
  getBook: vi.fn(),
  setBookLicence: vi.fn(),
  reload: vi.fn(),
  prepare: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: mocks.books,
    newBookNumber: 1,
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: mocks.reload,
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
    status: mocks.status,
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
vi.mock("@/lib/storage/books", () => ({
  getBook: mocks.getBook,
  nextChapterNumber: () => 1,
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
  mocks.kind = "blank";
  mocks.status = "idle";
  mocks.prepare.mockClear();
  mocks.setBookLicence.mockReset();
  mocks.reload.mockReset();
  mocks.getBook.mockReset();
  mocks.getBook.mockImplementation(async () => ({
    id: mark,
    provenance: { kind: mocks.kind === "template" ? "template" : "blank" },
  }));
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const byLabel = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
const byText = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const row = (id: string) =>
  document.querySelector<HTMLElement>(`[role="radio"][data-licence="${id}"]`);
const click = async (el: HTMLElement | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.focus();
    el!.click();
  });
};
const checked = () =>
  document
    .querySelector('[role="radio"][aria-checked="true"]')
    ?.getAttribute("data-licence");

function screen() {
  return createElement(BooksScreen, {
    audio: idleChapterAudio(),
    onOpenChapter: vi.fn(),
    pushLayer: vi.fn<(layer: Layer) => void>(),
    popLayer: vi.fn<(id: string) => void>(),
  });
}

async function openMenu(licence: BookCard["licence"]) {
  mocks.books = [
    { bookId: mark, name: "Mark", number: 1, licence, chapters: [] },
  ];
  await act(async () => {
    root.render(screen());
  });
  await click(byLabel(strings.bookMenuOpen("Mark")));
}

describe("the book menu's Licence tile (#1455)", () => {
  it("opens the ask with the stored licence selected, and a pick writes once without sharing", async () => {
    mocks.setBookLicence.mockImplementation(
      async (_id: string, chosen: string) => ({ id: mark, licence: chosen })
    );
    await openMenu("CC0-1.0");
    await click(byLabel(strings.licenceTileLabel));
    expect(checked()).toBe("CC0-1.0");
    expect(document.body.textContent).toContain(strings.licenceAskSaveLead);
    // Save, not Share.
    expect(byLabel(strings.licenceAskContinue)).toBeUndefined();
    await click(row("CC-BY-4.0"));
    await click(byLabel(strings.licenceAskSave));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);
    expect(mocks.setBookLicence).toHaveBeenCalledWith(mark, "CC-BY-4.0");
    expect(mocks.prepare).not.toHaveBeenCalled();
    // Back on the tiles, with the tile still there.
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(byLabel(strings.licenceTileLabel)).toBeDefined();
  });

  it("shows the newly stored licence when reopened, even if the shelf card is stale", async () => {
    mocks.setBookLicence.mockImplementation(
      async (_id: string, chosen: string) => ({ id: mark, licence: chosen })
    );
    await openMenu("CC-BY-SA-4.0");
    await click(byLabel(strings.licenceTileLabel));
    await click(row("CC0-1.0"));
    await click(byLabel(strings.licenceAskSave));
    await click(byLabel(strings.licenceTileLabel));
    expect(checked()).toBe("CC0-1.0");
  });

  it("writes nothing and shares nothing when Cancel is tapped", async () => {
    await openMenu("CC-BY-4.0");
    await click(byLabel(strings.licenceTileLabel));
    await click(byText(strings.licenceAskCancel));
    expect(mocks.setBookLicence).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("locks the ask while the write is in flight, then settles without sharing", async () => {
    let release: (book: unknown) => void = () => {};
    mocks.setBookLicence.mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );
    await openMenu("CC-BY-4.0");
    await click(byLabel(strings.licenceTileLabel));
    await click(byLabel(strings.licenceAskSave));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);
    expect(
      (byText(strings.licenceAskCancel) as HTMLButtonElement).disabled
    ).toBe(true);
    await click(byLabel(strings.menuClose));
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    await act(async () => release({ id: mark, licence: "CC-BY-4.0" }));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("keeps Share's own ask a Share ask after a cancelled change", async () => {
    await openMenu(null);
    await click(byLabel(strings.licenceTileLabel));
    await click(byText(strings.licenceAskCancel));
    await click(byLabel(strings.shareBook));
    expect(byLabel(strings.licenceAskContinue)).toBeDefined();
    expect(byLabel(strings.licenceAskSave)).toBeUndefined();
  });

  it("has no Licence tile on a book made from a template (D5)", async () => {
    mocks.kind = "template";
    await openMenu("CC-BY-SA-4.0");
    expect(byLabel(strings.shareBook)).toBeDefined();
    expect(byLabel(strings.licenceTileLabel)).toBeUndefined();
    expect(mocks.setBookLicence).not.toHaveBeenCalled();
  });

  it("offers no tile while a share file is armed, so Share now cannot send an old licence", async () => {
    mocks.status = "ready";
    await openMenu("CC-BY-4.0");
    expect(mocks.getBook).toHaveBeenCalled();
    expect(byLabel(strings.licenceTileLabel)).toBeUndefined();
  });

  it("offers no tile while the book's provenance is unknown", async () => {
    mocks.getBook.mockImplementation(() => new Promise(() => {}));
    await openMenu("CC-BY-4.0");
    expect(byLabel(strings.licenceTileLabel)).toBeUndefined();
  });

  it("gives the Templates tile its own caption key (#1655)", async () => {
    await act(async () => {
      root.render(screen());
    });
    await click(byLabel(strings.menuOpen));
    const tile = byLabel(strings.templatesOpen);
    expect(tile).toBeDefined();
    expect(tile!.textContent).toContain(strings.tileTemplates);
  });
});
