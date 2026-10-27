// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { BookId, ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { BookCard, SegmentRow } from "@/types/view";

import { idleChapterAudio } from "./chapter-audio";
import { restingErase } from "./support";

/**
 * Move up / Move down in the book and segment row menus (#1344, the DRI's
 * "Yes, menu Move up/down" pick): the tap path to reorder a row, for
 * screen-reader and motor users, beside press-and-hold.
 *
 * Both screens are mounted whole in jsdom with their data hooks mocked, and
 * each menu is opened from its ⋮ the way a translator opens it. What this
 * checks: the two tiles are there; the first row's Move up and the last
 * row's Move down are greyed with their reason and refuse the tap; a move
 * calls the same store op the drag's drop calls (`moveBook`, `moveSegment`)
 * with the neighbour's index, and says the drop's own line in the screen's
 * reorder status; a write that does not land says the row stayed; and the
 * menu closes with focus back on the row's ⋮.
 *
 * What this cannot show: layout, the cascade, and a real screen reader on a
 * phone. Nothing here was run on a device.
 */

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  rows: [] as SegmentRow[],
  moveBook: null as unknown as (
    id: string,
    toIndex: number
  ) => Promise<boolean>,
  moveSegment: null as unknown as (
    id: string,
    toIndex: number
  ) => Promise<boolean>,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: state.books,
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
    moveChapter: vi.fn(() => Promise.resolve(true)),
    moveBook: (id: string, toIndex: number) => state.moveBook(id, toIndex),
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
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    bookCoverHex: "#11796d",
    chapterNumber: 1,
    chapterName: null,
    rows: state.rows,
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
    moveSegment: (id: string, toIndex: number) =>
      state.moveSegment(id, toIndex),
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
const ruth = "book-0000-4000-8000-000000000002" as BookId;
const luke = "book-0000-4000-8000-000000000003" as BookId;
const shelf = (): BookCard[] => [
  { bookId: mark, name: "Mark", number: 1, coverColourKey: null, chapters: [] },
  { bookId: ruth, name: "Ruth", number: 2, coverColourKey: null, chapters: [] },
  { bookId: luke, name: "Luke", number: 3, coverColourKey: null, chapters: [] },
];

function makeRow(i: number): SegmentRow {
  return {
    segmentId: `s${i}` as SegmentId,
    ordinal: i + 1,
    label: null,
    hasClip: i !== 1,
    finished: false,
    clipId: i !== 1 ? (`c${i}` as ClipId) : null,
    peaks: null,
    durationMs: i !== 1 ? 1000 : null,
  };
}

let root: Root;
let moveBook: ReturnType<
  typeof vi.fn<(id: string, toIndex: number) => Promise<boolean>>
>;
let moveSegment: ReturnType<
  typeof vi.fn<(id: string, toIndex: number) => Promise<boolean>>
>;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  state.books = shelf();
  state.rows = [makeRow(0), makeRow(1), makeRow(2)];
  moveBook = vi.fn<(id: string, toIndex: number) => Promise<boolean>>(() =>
    Promise.resolve(true)
  );
  state.moveBook = moveBook;
  moveSegment = vi.fn<(id: string, toIndex: number) => Promise<boolean>>(() =>
    Promise.resolve(true)
  );
  state.moveSegment = moveSegment;
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
        audio: idleChapterAudio(),
        onOpenChapter: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

async function mountSegments() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio: {
          error: null,
          playingId: null,
          playbackElapsedMs: 0,
          playbackRanOut: false,
          playTake: vi.fn(),
          leave: vi.fn(),
          stopBuffer: vi.fn(),
        } as unknown as UseAudioSession,
        erase: restingErase(),
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}
/** Focus the opener first, as a tap would, so focus return has a target. */
async function openFrom(label: string) {
  const opener = button(label);
  opener.focus();
  await act(async () => opener.click());
}
async function click(label: string) {
  await act(async () => button(label).click());
}
const dialog = (name: string) =>
  document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${name}"]`);
const liveText = () =>
  document.querySelector('[data-reorder-status][role="status"]')?.textContent ??
  null;
const hinted = (label: string, reason: string) => `${label}. ${reason}`;

/** The menu's Move tiles, by name, in document order. */
function moveTiles(sheet: HTMLElement): HTMLButtonElement[] {
  return [
    ...sheet.querySelectorAll<HTMLButtonElement>(".o4-tiles button"),
  ].filter((b) => {
    const name = b.getAttribute("aria-label") ?? "";
    return name.startsWith(strings.moveUp) || name.startsWith(strings.moveDown);
  });
}

describe("the book menu's Move up / Move down (#1344)", () => {
  it("draws Move up then Move down as tiles in their own grid, captioned with their names", async () => {
    await mountBooks();
    await openFrom(strings.bookMenuOpen("Ruth"));
    const sheet = dialog(strings.bookMenuTitle)!;
    const tiles = moveTiles(sheet);
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      strings.moveUp,
      strings.moveDown,
    ]);
    // A row of their own, after the action row, so the four action tiles
    // keep their compact fit at 360 px.
    const grid = tiles[0]!.closest(".o4-tiles");
    expect(grid).toBe(tiles[1]!.closest(".o4-tiles"));
    expect(grid!.querySelectorAll("button")).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.classList).toContain("o4-tile");
      expect(tile.querySelector(".control-caption")?.textContent).toBe(
        tile.getAttribute("aria-label")
      );
      expect(tile.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("greys Move up on the first book and Move down on the last, each with its reason, and refuses the tap", async () => {
    await mountBooks();
    await openFrom(strings.bookMenuOpen("Mark"));
    const first = button(hinted(strings.moveUp, strings.alreadyFirst));
    expect(first.getAttribute("aria-disabled")).toBe("true");
    expect(button(strings.moveDown).getAttribute("aria-disabled")).toBeNull();
    await act(async () => first.click());
    expect(moveBook).not.toHaveBeenCalled();
    expect(dialog(strings.bookMenuTitle)).not.toBeNull();

    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    await openFrom(strings.bookMenuOpen("Luke"));
    const last = button(hinted(strings.moveDown, strings.alreadyLast));
    expect(last.getAttribute("aria-disabled")).toBe("true");
    expect(button(strings.moveUp).getAttribute("aria-disabled")).toBeNull();
    await act(async () => last.click());
    expect(moveBook).not.toHaveBeenCalled();
  });

  it("Move up writes the book one place higher, says the drop's line, closes, and returns focus to its ⋮", async () => {
    await mountBooks();
    await openFrom(strings.bookMenuOpen("Ruth"));
    await click(strings.moveUp);
    expect(moveBook).toHaveBeenCalledTimes(1);
    expect(moveBook).toHaveBeenCalledWith(ruth, 0);
    expect(liveText()).toBe(strings.bookReorderMoved("Ruth", 1));
    expect(dialog(strings.bookMenuTitle)).toBeNull();
    expect(document.activeElement).toBe(button(strings.bookMenuOpen("Ruth")));
  });

  it("Move down writes the book one place lower and says where it landed", async () => {
    await mountBooks();
    await openFrom(strings.bookMenuOpen("Mark"));
    await click(strings.moveDown);
    expect(moveBook).toHaveBeenCalledWith(mark, 1);
    expect(liveText()).toBe(strings.bookReorderMoved("Mark", 2));
  });

  it("says the book stayed when the write does not land", async () => {
    moveBook.mockImplementation(() => Promise.resolve(false));
    await mountBooks();
    await openFrom(strings.bookMenuOpen("Ruth"));
    await click(strings.moveDown);
    expect(moveBook).toHaveBeenCalledWith(ruth, 2);
    expect(liveText()).toBe(strings.bookReorderStayed("Ruth"));
  });
});

describe("the segment menu's Move up / Move down (#1344)", () => {
  it("draws Move up then Move down in their own grid on a recorded and an empty segment", async () => {
    await mountSegments();
    for (const n of [1, 2]) {
      await openFrom(strings.segmentMenu(n));
      const sheet = dialog(strings.recorderMenuTitle)!;
      const tiles = moveTiles(sheet);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]!.getAttribute("aria-label")).toMatch(
        new RegExp(`^${strings.moveUp}`)
      );
      expect(tiles[1]!.getAttribute("aria-label")).toMatch(
        new RegExp(`^${strings.moveDown}`)
      );
      const grid = tiles[0]!.closest(".o4-tiles");
      expect(grid).toBe(tiles[1]!.closest(".o4-tiles"));
      expect(grid!.querySelectorAll("button")).toHaveLength(2);
      for (const tile of tiles) {
        expect(tile.querySelector(".control-caption")?.textContent).toBe(
          tile.getAttribute("aria-label")!.split(". ")[0]
        );
      }
      await act(async () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        )
      );
    }
  });

  it("greys Move up on the first segment and Move down on the last, each with its reason, and refuses the tap", async () => {
    await mountSegments();
    await openFrom(strings.segmentMenu(1));
    const first = button(hinted(strings.moveUp, strings.alreadyFirst));
    expect(first.getAttribute("aria-disabled")).toBe("true");
    expect(button(strings.moveDown).getAttribute("aria-disabled")).toBeNull();
    await act(async () => first.click());
    expect(moveSegment).not.toHaveBeenCalled();
    expect(dialog(strings.recorderMenuTitle)).not.toBeNull();

    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    await openFrom(strings.segmentMenu(3));
    const last = button(hinted(strings.moveDown, strings.alreadyLast));
    expect(last.getAttribute("aria-disabled")).toBe("true");
    expect(button(strings.moveUp).getAttribute("aria-disabled")).toBeNull();
    await act(async () => last.click());
    expect(moveSegment).not.toHaveBeenCalled();
  });

  it("Move up writes the segment one place higher, says the drop's line, closes, and returns focus to its ⋮", async () => {
    await mountSegments();
    await openFrom(strings.segmentMenu(2));
    await click(strings.moveUp);
    expect(moveSegment).toHaveBeenCalledTimes(1);
    expect(moveSegment).toHaveBeenCalledWith("s1", 0);
    expect(liveText()).toBe(strings.reorderMoved(2, 1));
    expect(dialog(strings.recorderMenuTitle)).toBeNull();
    expect(document.activeElement).toBe(button(strings.segmentMenu(2)));
  });

  it("Move down writes the segment one place lower and says its new number", async () => {
    await mountSegments();
    await openFrom(strings.segmentMenu(1));
    await click(strings.moveDown);
    expect(moveSegment).toHaveBeenCalledWith("s0", 1);
    expect(liveText()).toBe(strings.reorderMoved(1, 2));
  });

  it("says the segment stayed when the write does not land", async () => {
    moveSegment.mockImplementation(() => Promise.resolve(false));
    await mountSegments();
    await openFrom(strings.segmentMenu(2));
    await click(strings.moveDown);
    expect(moveSegment).toHaveBeenCalledWith("s1", 2);
    expect(liveText()).toBe(strings.reorderStayed(2));
  });
});
