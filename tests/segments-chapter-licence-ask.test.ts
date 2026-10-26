// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { LicenceId } from "@/types/template";

import { restingErase } from "./support";

/**
 * #1455: Share Chapter on a book with no licence chosen asks first, with the
 * same ask Share Book uses (the DRI, 2026-10-26: "Ask at Share Chapter too"),
 * then goes on with the share. Mounted through the whole `SegmentsScreen`
 * with the chapter view and the share flow mocked, and the licence write
 * mocked at the storage boundary, so the real `useLicenceAsk` and the real
 * `LicenceAsk` run and the test taps the real controls.
 */

const book = "book-0000-4000-8000-000000000001" as BookId;

const mocks = vi.hoisted(() => ({
  licence: null as LicenceId | null,
  setBookLicence: vi.fn(),
  getBook: vi.fn(),
  getChapter: vi.fn(),
  prepare: vi.fn<
    (chapterId: string, nameFile: (highest: number) => string) => Promise<null>
  >(() => Promise.resolve(null)),
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    bookCoverHex: null,
    // Never refreshed by the test: a committed pick must not depend on the
    // chapter view reading it back.
    bookLicence: mocks.licence,
    chapterNumber: 4,
    chapterName: null,
    rows: [],
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(async () => true),
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    missing: 0,
    sendUnconfirmed: false,
    ownsScreen: () => false,
    reset: () => {},
    prepare: mocks.prepare,
  }),
}));
vi.mock("@/lib/storage/licence", () => ({
  setBookLicence: mocks.setBookLicence,
}));
vi.mock("@/lib/storage/books", () => ({
  getBook: mocks.getBook,
  getChapter: mocks.getChapter,
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

let root: Root;
let layers: Layer[];
const audio = {
  error: null,
  playingId: null,
  playbackElapsedMs: 0,
  leave: vi.fn(),
} as unknown as UseAudioSession;

beforeEach(() => {
  mocks.prepare.mockClear();
  mocks.setBookLicence.mockReset();
  mocks.getBook.mockReset();
  mocks.getChapter.mockReset();
  mocks.getChapter.mockResolvedValue({ id: "chapter", bookId: book });
  layers = [];
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  mocks.licence = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase: restingErase(),
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: (layer: Layer) => layers.push(layer),
        popLayer: vi.fn<(id: string) => void>(),
      })
    )
  );
}
const byLabel = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
const click = async (el: HTMLElement | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.focus();
    el!.click();
  });
};
const row = (id: LicenceId) =>
  document.querySelector<HTMLButtonElement>(
    `[role="radio"][data-licence="${id}"]`
  );
const asking = () => document.querySelector('[role="radiogroup"]') !== null;
const menuLayer = () =>
  layers.filter((l) => l.id === "segments:chapter-menu").at(-1)!;
const sharedName = (call: number) => mocks.prepare.mock.calls[call]![1](4);
const storesWhatIsPicked = () =>
  mocks.setBookLicence.mockImplementation(
    async (id: BookId, chosen: LicenceId) => ({ id, licence: chosen })
  );

async function openShare() {
  await click(byLabel(strings.chapterMenuOpen));
  await click(byLabel(strings.shareChapter));
}

describe("Share Chapter asks the licence first when the book has none (#1455)", () => {
  it("asks, stores the pick once, then shares with the tag", async () => {
    storesWhatIsPicked();
    await mount();
    await openShare();
    expect(asking()).toBe(true);
    expect(mocks.prepare).not.toHaveBeenCalled();
    // CC BY-SA 4.0 is pre-selected (R20), as on Share Book.
    expect(row("CC-BY-SA-4.0")?.getAttribute("aria-checked")).toBe("true");

    await click(row("CC-BY-4.0"));
    await click(byLabel(strings.licenceAskContinue));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);
    expect(mocks.setBookLicence).toHaveBeenCalledWith(book, "CC-BY-4.0");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(sharedName(0)).toBe("Mark - 04 Chapter 4 (CC BY 4.0).mp3");
    expect(asking()).toBe(false);
  });

  it("does not ask again on a second share, though the view still reads null", async () => {
    storesWhatIsPicked();
    await mount();
    await openShare();
    await click(row("CC0-1.0"));
    await click(byLabel(strings.licenceAskContinue));
    await click(byLabel(strings.shareChapter));
    expect(asking()).toBe(false);
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(sharedName(1)).toBe("Mark - 04 Chapter 4 (CC0 1.0).mp3");
  });

  it("writes nothing and shares nothing on Cancel", async () => {
    await mount();
    await openShare();
    await click(document.querySelector<HTMLElement>(".licence-ask-quiet"));
    expect(asking()).toBe(false);
    expect(mocks.setBookLicence).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(byLabel(strings.shareChapter)).toBeTruthy();
  });

  it("does nothing while the book's id is still being read, rather than share unasked", async () => {
    mocks.getChapter.mockReturnValue(new Promise(() => {}));
    await mount();
    await openShare();
    expect(asking()).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  // A template book is written CC BY-SA 4.0 when it is made (D5), so it is
  // this case; `tests/licence-ask-render.test.ts` reads one back.
  it("never asks for a book that already has a licence", async () => {
    mocks.licence = "CC-BY-SA-4.0";
    await mount();
    await openShare();
    expect(asking()).toBe(false);
    expect(mocks.setBookLicence).not.toHaveBeenCalled();
    expect(sharedName(0)).toBe("Mark - 04 Chapter 4 (CC BY-SA 4.0).mp3");
  });

  it("shares untagged when the writer refuses a template book that reads null", async () => {
    mocks.setBookLicence.mockRejectedValue(
      Object.assign(new Error("locked"), { name: "TemplateLicenceLockedError" })
    );
    mocks.getBook.mockResolvedValue({ id: book, licence: null });
    await mount();
    await openShare();
    await click(byLabel(strings.licenceAskContinue));
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(sharedName(0)).toBe("Mark - 04 Chapter 4.mp3");
  });

  it("keeps the ask open on a failed write, shares nothing, and can still cancel", async () => {
    mocks.setBookLicence.mockRejectedValue(new Error("disk"));
    await mount();
    await openShare();
    await click(byLabel(strings.licenceAskContinue));
    expect(asking()).toBe(true);
    expect(mocks.prepare).not.toHaveBeenCalled();
    const cancel =
      document.querySelector<HTMLButtonElement>(".licence-ask-quiet");
    expect(cancel?.disabled).toBe(false);
    expect(menuLayer().busy()).toBe(false);
    await click(cancel);
    expect(asking()).toBe(false);
  });

  it("locks the ask and the menu while the write is in flight, then shares the original pick", async () => {
    let release: (stored: unknown) => void = () => {};
    mocks.setBookLicence.mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );
    await mount();
    await openShare();
    // Asking, not yet saving: Back may close the menu.
    expect(menuLayer().busy()).toBe(false);
    await click(row("CC-BY-4.0"));
    await click(byLabel(strings.licenceAskContinue));

    // Saving: rows and Cancel are disabled, Back sees busy, and neither the
    // menu's Close nor a Back dismissal takes the menu down.
    expect(row("CC0-1.0")?.disabled).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(".licence-ask-quiet")?.disabled
    ).toBe(true);
    for (let back = 0; back < 3; back++) expect(menuLayer().busy()).toBe(true);
    await act(async () => menuLayer().dismiss());
    await click(byLabel(strings.menuClose));
    expect(asking()).toBe(true);
    // A second Continue writes nothing more.
    await click(byLabel(strings.licenceAskContinue));
    expect(mocks.setBookLicence).toHaveBeenCalledTimes(1);

    await act(async () => release({ id: book, licence: "CC-BY-4.0" }));
    expect(menuLayer().busy()).toBe(false);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(sharedName(0)).toBe("Mark - 04 Chapter 4 (CC BY 4.0).mp3");
  });
});
