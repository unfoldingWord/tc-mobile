// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { Icon, type IconName } from "@/components/icon";
import { SegmentRow } from "@/components/segment-row";
import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/components/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { BookId, ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { BookCard, SegmentRow as Row } from "@/types/view";

/**
 * #589: one glyph, one meaning. ≡ opens the global menu and nothing else (#608
 * made it that menu's mark); every menu that belongs to ONE thing — a book, a
 * chapter, a segment — opens from ⋮. A translator who may not read tells the
 * menus apart by shape alone, so which glyph each opener wears is the label.
 *
 * Each opener is found by its accessible name and its drawn glyph compared with
 * the real `Icon` of that name, so a redraw of either icon cannot orphan a
 * hand-copied path. The screens mount with their data hooks mocked out: only
 * the header and row controls are under test, not what fills them.
 *
 * Not covered here: the recorder's ≡ (`recorder.tsx`), which this change leaves
 * as it is.
 */

const mocks = vi.hoisted(() => ({ books: vi.fn(), chapter: vi.fn() }));

vi.mock("@/hooks/use-books", () => ({ useBooks: mocks.books }));
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
    reset: () => {},
    dismissProgress: () => {},
    ownsScreen: () => false,
  }),
}));
vi.mock("@/hooks/use-storage-persistence", () => ({
  useStoragePersistence: () => null,
}));
vi.mock("@/hooks/failure-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/failure-log")>()),
  useFailureCount: () => 0,
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: mocks.chapter,
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    ownsScreen: () => false,
    reset: () => {},
  }),
}));
vi.mock("@/hooks/use-erase-segment", () => ({
  useEraseSegment: () => ({
    error: null,
    erasing: false,
    isErasing: () => false,
  }),
}));

const book: BookCard = {
  bookId: "book" as BookId,
  name: "Genesis",
  chapters: [],
};
const recorded: Row = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  hasClip: true,
  finished: false,
  clipId: "clip" as ClipId,
  peaks: null,
  durationMs: 1000,
};

let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.books.mockReturnValue({
    books: [book],
    newBookPlaceholder: "Book 002",
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
  mocks.chapter.mockReturnValue({
    bookName: "Genesis",
    chapterNumber: 1,
    chapterName: null,
    rows: [],
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: vi.fn(),
  });
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
}

/** The markup inside the `<svg>` an `Icon` of this name draws. */
function glyph(name: IconName): string {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Icon, { name }));
  return host.querySelector("svg")!.innerHTML;
}

/** The glyph drawn inside the one button with this accessible name. */
function openerGlyph(label: string): string {
  const buttons = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(buttons).toHaveLength(1);
  const svg = buttons[0]!.querySelector("svg");
  expect(svg).not.toBeNull();
  return svg!.innerHTML;
}

function expectKebab(label: string) {
  const drawn = openerGlyph(label);
  expect(drawn).toBe(glyph("more"));
  expect(drawn).not.toBe(glyph("menu"));
}

describe("which glyph opens which menu (#589)", () => {
  it("keeps ≡ on the Books header's global menu, and gives each book row ⋮", async () => {
    await mount(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    );

    const global = openerGlyph(strings.menuOpen);
    expect(global).toBe(glyph("menu"));
    expect(global).not.toBe(glyph("more"));

    expectKebab(strings.bookMenuOpen(book.name));
  });

  it("gives the Segments header's chapter menu ⋮", async () => {
    await mount(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio: {
          error: null,
          playingId: null,
          playbackElapsedMs: 0,
        } as UseAudioSession,
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    );

    expectKebab(strings.chapterMenuOpen);
  });

  it("gives a recorded segment row's menu ⋮", async () => {
    await mount(
      createElement(SegmentRow, {
        row: recorded,
        playing: false,
        playbackElapsedMs: 0,
        onPlay: vi.fn(),
        onOpenRecorder: vi.fn(),
        onSetFinished: vi.fn(),
        onErase: vi.fn(),
        onMenuOpen: vi.fn(),
        onMenuClose: vi.fn(),
      })
    );

    expectKebab(strings.segmentMenu(recorded.ordinal));
  });
});
