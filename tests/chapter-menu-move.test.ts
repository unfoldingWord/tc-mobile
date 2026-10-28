// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

import { idleChapterAudio } from "./chapter-audio";

/**
 * Move up / Move down for a CHAPTER (#1730, the DRI's "Books chapter row ⋮
 * menu" pick): the tap path to reorder a chapter, beside press-and-hold, in
 * the same shape the book and segment menus have (#1344,
 * `tests/menu-move-up-down.test.ts`).
 *
 * The real `BooksScreen` is mounted in jsdom with `useBooks` replaced at its
 * boundary. The mock keeps the shelf in React state and applies a move the
 * way the real hook's optimistic patch does (`patchMovedChapter`, imported
 * from the real module): the row goes to its new place and every row is
 * re-slotted. So after a move the moved row's ⋮ carries its NEW number, and a
 * focus assertion can tell the moved row from the row that took its old
 * number.
 *
 * What this checks: each chapter row has a ⋮ beside (never inside) its open
 * button; its menu draws the shared Move pair; the first row's Move up and
 * the last row's Move down are greyed with their reason and refuse the tap; a
 * move calls the drag's store op (`moveChapter`) with the neighbour's index
 * and says the drag's line (`chapterReorderMoved`); a write that does not
 * land says the chapter stayed; and the menu closes with focus on the moved
 * row's ⋮ at its new place.
 *
 * What this cannot show: layout, the cascade, and a real screen reader on a
 * phone. Nothing here was run on a device.
 */

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  moveChapter: null as unknown as (
    id: ChapterId,
    toIndex: number
  ) => Promise<boolean>,
}));
vi.mock("@/hooks/use-books", async () => {
  const { useState } = await import("react");
  const real =
    await vi.importActual<typeof import("@/hooks/use-books")>(
      "@/hooks/use-books"
    );
  return {
    useBooks: () => {
      const [books, setBooks] = useState(state.books);
      return {
        books,
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
        moveBook: vi.fn(() => Promise.resolve(true)),
        // Optimistic, as the real hook is: the shelf is patched in the same
        // turn, and put back when the write does not land.
        moveChapter: async (id: ChapterId, toIndex: number) => {
          const before = books;
          setBooks((current) => real.patchMovedChapter(current, id, toIndex));
          const landed = await state.moveChapter(id, toIndex);
          if (!landed) setBooks(before);
          return landed;
        },
        deleting: false,
        isDeleting: () => false,
      };
    },
  };
});
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
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const mark = "book-0000-4000-8000-000000000001" as BookId;

function chapter(i: number, extra: Partial<ChapterRow> = {}): ChapterRow {
  return {
    chapterId: `ch${i}` as ChapterId,
    number: i + 1,
    templateNumber: null,
    name: null,
    finishedCount: 0,
    totalCount: 2,
    recordedCount: 1,
    ...extra,
  };
}
const shelf = (): BookCard[] => [
  {
    bookId: mark,
    name: "Mark",
    number: 1,
    coverColourKey: "teal",
    // Named, so a row can be told apart after a move re-slots every badge.
    chapters: [
      chapter(0, { name: "Passage A" }),
      chapter(1, { name: "Passage B" }),
      chapter(2, { name: "Mark 3" }),
    ],
  },
];

let root: Root;
let moveChapter: ReturnType<
  typeof vi.fn<(id: ChapterId, toIndex: number) => Promise<boolean>>
>;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  state.books = shelf();
  moveChapter = vi.fn<(id: ChapterId, toIndex: number) => Promise<boolean>>(
    () => Promise.resolve(true)
  );
  state.moveChapter = moveChapter;
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}
async function mountOpenBook() {
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
  await act(async () => button(strings.bookRow("Mark", 3, false)).click());
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
const dialog = () =>
  document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${strings.chapterMenuTitle}"]`
  );
const liveText = () =>
  document.querySelector('[data-reorder-status][role="status"]')?.textContent ??
  null;
const hinted = (label: string, reason: string) => `${label}. ${reason}`;
const escape = () =>
  act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
  );
/** The `<li>` of the chapter named `name`, wherever it now sits. */
const rowOf = (name: string) =>
  button(strings.openChapter(name)).closest<HTMLLIElement>(
    ".books-chapters > li"
  );

describe("a chapter row's ⋮ on the Books screen (#1730)", () => {
  it("draws one ⋮ per chapter, named by its slot, beside the row's open button rather than inside it", async () => {
    await mountOpenBook();
    for (const n of [1, 2, 3]) {
      const more = button(strings.chapterRowMenu(n));
      expect(more.closest(".books-chapter")).toBeNull();
      expect(more.closest(".books-chapters > li")).not.toBeNull();
    }
  });
});

describe("the chapter menu's Move up / Move down (#1730)", () => {
  it("draws Move up then Move down as tiles in their own grid, captioned with their names", async () => {
    await mountOpenBook();
    await openFrom(strings.chapterRowMenu(2));
    const sheet = dialog();
    expect(sheet).not.toBeNull();
    const tiles = [
      ...sheet!.querySelectorAll<HTMLButtonElement>(".o4-tiles button"),
    ];
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      strings.moveUp,
      strings.moveDown,
    ]);
    expect(tiles[0]!.closest(".o4-tiles")).toBe(tiles[1]!.closest(".o4-tiles"));
    for (const tile of tiles) {
      expect(tile.querySelector(".control-caption")?.textContent).toBe(
        tile.getAttribute("aria-label")
      );
      expect(tile.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("greys Move up on the first chapter and Move down on the last, each with its reason, and refuses the tap", async () => {
    await mountOpenBook();
    await openFrom(strings.chapterRowMenu(1));
    const first = button(hinted(strings.moveUp, strings.alreadyFirst));
    expect(first.getAttribute("aria-disabled")).toBe("true");
    expect(button(strings.moveDown).getAttribute("aria-disabled")).toBeNull();
    await act(async () => first.click());
    expect(moveChapter).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();

    await escape();
    expect(dialog()).toBeNull();
    await openFrom(strings.chapterRowMenu(3));
    const last = button(hinted(strings.moveDown, strings.alreadyLast));
    expect(last.getAttribute("aria-disabled")).toBe("true");
    expect(button(strings.moveUp).getAttribute("aria-disabled")).toBeNull();
    await act(async () => last.click());
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("Move up writes the chapter one place higher, says the drag's line, closes, and keeps focus on the moved row's ⋮", async () => {
    await mountOpenBook();
    await openFrom(strings.chapterRowMenu(2));
    await click(strings.moveUp);
    expect(moveChapter).toHaveBeenCalledTimes(1);
    expect(moveChapter).toHaveBeenCalledWith("ch1", 0);
    expect(liveText()).toBe(strings.chapterReorderMoved(2, 1));
    expect(dialog()).toBeNull();
    // The patch re-slotted the rows, so the moved chapter's ⋮ now reads 1 and
    // the chapter that took its place reads 2: focus follows the row.
    const more = button(strings.chapterRowMenu(1));
    expect(document.activeElement).toBe(more);
    expect(rowOf("Passage B")!.contains(more)).toBe(true);
  });

  it("Move down writes the chapter one place lower and says its new number", async () => {
    await mountOpenBook();
    await openFrom(strings.chapterRowMenu(1));
    await click(strings.moveDown);
    expect(moveChapter).toHaveBeenCalledWith("ch0", 1);
    expect(liveText()).toBe(strings.chapterReorderMoved(1, 2));
    const more = button(strings.chapterRowMenu(2));
    expect(document.activeElement).toBe(more);
    expect(rowOf("Passage A")!.contains(more)).toBe(true);
  });

  it("says the chapter stayed when the write does not land", async () => {
    moveChapter.mockImplementation(() => Promise.resolve(false));
    await mountOpenBook();
    await openFrom(strings.chapterRowMenu(2));
    await click(strings.moveDown);
    expect(moveChapter).toHaveBeenCalledWith("ch1", 2);
    expect(liveText()).toBe(strings.chapterReorderStayed(2));
  });

  it("a plain close writes nothing and returns focus to the ⋮ that opened it", async () => {
    await mountOpenBook();
    await openFrom(strings.chapterRowMenu(2));
    await escape();
    expect(dialog()).toBeNull();
    expect(moveChapter).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button(strings.chapterRowMenu(2)));
  });
});
