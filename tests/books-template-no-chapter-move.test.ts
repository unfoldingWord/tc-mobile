// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { idleChapterAudio } from "./chapter-audio";
import { strings } from "@/lib/strings";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * #1985 (DRI pick on the v1.3.0 red team, "Fix in this cut"): a chapter of a
 * book made from a template has no Move, neither the press-and-hold drag nor
 * the row's ⋮ (whose sheet holds only the Move pair), because the chapter
 * order is the template's. A hand-made book keeps both. The real
 * `BooksScreen` is mounted with `useBooks` replaced at its boundary; the one
 * input that differs is the card's `fromTemplate`. Layout is faked and no
 * device is involved.
 */

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  moveChapter: null as unknown as (
    id: ChapterId,
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
    moveChapter: (id: ChapterId, toIndex: number) =>
      state.moveChapter(id, toIndex),
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
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const bookId = "book-0000-4000-8000-000000000001" as BookId;

const chapter = (i: number): ChapterRow => ({
  chapterId: `ch${i}` as ChapterId,
  number: i + 1,
  templateNumber: null,
  name: null,
  finishedCount: 0,
  totalCount: 2,
  recordedCount: 1,
});
const shelf = (fromTemplate: boolean): BookCard[] => [
  {
    bookId,
    name: "Mark",
    number: 1,
    coverColourKey: "teal",
    fromTemplate,
    chapters: [chapter(0), chapter(1), chapter(2)],
  },
];

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 360,
    width: 360,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

let root: Root;
let moveChapter: ReturnType<
  typeof vi.fn<(id: ChapterId, toIndex: number) => Promise<boolean>>
>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const list = this.parentElement;
      if (this.tagName === "LI" && list?.classList.contains("books-chapters")) {
        return rect([...list.children].indexOf(this) * 100, 68);
      }
      return rect(0, 700);
    }
  );
  moveChapter = vi.fn<(id: ChapterId, toIndex: number) => Promise<boolean>>(
    () => Promise.resolve(true)
  );
  state.moveChapter = moveChapter;
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(fromTemplate: boolean) {
  state.books = shelf(fromTemplate);
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
  const toggle = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.bookRow("Mark", 3, false)
  )!;
  await act(async () => toggle.click());
}

const rows = () => [
  ...document.querySelectorAll<HTMLLIElement>("#chapters-" + bookId + " > li"),
];
const rowMenus = () =>
  [...document.querySelectorAll("button")].filter((b) =>
    [1, 2, 3].some(
      (n) => b.getAttribute("aria-label") === strings.chapterRowMenu(n)
    )
  );

function pointer(el: Element, type: string, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: y,
    })
  );
}

describe("chapter Move in a template book (#1985)", () => {
  it("has no hold handle, no ⋮ and no lift when the book came from a template", async () => {
    await mount(true);
    expect(rows()).toHaveLength(3);
    expect(
      document.querySelector("#chapters-" + bookId + " [data-reorder-handle]")
    ).toBeNull();
    expect(rowMenus()).toHaveLength(0);
    const button = rows()[0]!.querySelector("button")!;
    await act(async () => pointer(button, "pointerdown", 34));
    await act(async () => vi.advanceTimersByTime(450));
    await act(async () => pointer(button, "pointermove", 249));
    await act(async () => pointer(button, "pointerup", 249));
    expect(document.querySelector(".books-lifted")).toBeNull();
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("keeps the hold, the drop and the ⋮ in a hand-made book", async () => {
    await mount(false);
    expect(rowMenus()).toHaveLength(3);
    const button = rows()[0]!.querySelector("button")!;
    expect(button.hasAttribute("data-reorder-handle")).toBe(true);
    await act(async () => pointer(button, "pointerdown", 34));
    await act(async () => vi.advanceTimersByTime(450));
    await act(async () => pointer(button, "pointermove", 249));
    await act(async () => pointer(button, "pointerup", 249));
    expect(moveChapter).toHaveBeenCalledWith("ch0", 2);
  });
});
