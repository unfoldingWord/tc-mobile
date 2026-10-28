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
 * Hold-to-reveal on the Books screen (S14, #1284), wired: the real
 * `BooksScreen` with `useBooks` replaced at its boundary (the
 * `books-reorder-o4` pattern). These cases are about the one rule that keeps
 * the reveal from fighting the reorder hold (#953, #338): a press on a name is
 * claimed only when that name is cut off, so a name that fits still lifts its
 * row or its book exactly as before.
 *
 * Layout is faked: jsdom has none, so its `scrollWidth` and `clientWidth` are
 * both 0, which reads as "fits". `cutOff` gives one name a wider content box
 * than its own box, which is what the ellipsis means. What this cannot see:
 * real touch, where the bubble lands on a phone, and the cascade.
 */

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  moveBook: null as unknown as (id: BookId, to: number) => Promise<boolean>,
  moveChapter: null as unknown as (
    id: ChapterId,
    to: number
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
    moveChapter: (id: ChapterId, to: number) => state.moveChapter(id, to),
    moveBook: (id: BookId, to: number) => state.moveBook(id, to),
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

const LONG_BOOK = "Kitabu cha Habari Njema kama ilivyoandikwa na Marko";
const LONG_CHAPTER =
  "The healing of the man with the withered hand on the Sabbath";

const mark = "book-0000-4000-8000-000000000001" as BookId;
const ruth = "book-0000-4000-8000-000000000002" as BookId;

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
    name: LONG_BOOK,
    number: 1,
    coverColourKey: "teal",
    chapters: [chapter(0), chapter(1), chapter(2, { name: LONG_CHAPTER })],
  },
  { bookId: ruth, name: "Ruth", number: 1, coverColourKey: null, chapters: [] },
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
let onOpenChapter: ReturnType<typeof vi.fn<(id: ChapterId) => void>>;
let moveBook: ReturnType<typeof vi.fn>;
let moveChapter: ReturnType<typeof vi.fn>;

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
        const i = [...list.children].indexOf(this);
        return rect(300 + i * 100, 68);
      }
      if (this.tagName === "LI" && list?.classList.contains("books-list")) {
        const i = [...list.children].indexOf(this);
        return rect(i * 400, 380);
      }
      return rect(300, 20);
    }
  );
  state.books = shelf();
  moveBook = vi.fn(() => Promise.resolve(true));
  moveChapter = vi.fn(() => Promise.resolve(true));
  state.moveBook = moveBook as never;
  state.moveChapter = moveChapter as never;
  onOpenChapter = vi.fn<(id: ChapterId) => void>();
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio(),
        onOpenChapter,
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
  await act(async () => bookToggle().click());
}

const bookToggle = () =>
  document.querySelector<HTMLButtonElement>(
    ".books-list > li .books-card-hit"
  )!;
const bookName = () =>
  document.querySelector<HTMLElement>(".books-list > li .books-name")!;
const items = () => [
  ...document.querySelectorAll<HTMLLIElement>("#chapters-" + mark + " > li"),
];
const title = (i: number) =>
  items()[i]!.querySelector<HTMLElement>(".books-chapter-title")!;
const rowButton = (i: number) => items()[i]!.querySelector("button")!;
const bubble = () => document.querySelector<HTMLElement>(".name-reveal");
const chapterLifted = () => document.querySelector(".books-lifted");
const bookLifted = () => document.querySelector(".books-card-lifted");

/** The ellipsis, as layout would report it: more content than room. */
function cutOff(el: HTMLElement) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: 420 });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 154 });
}

function pointer(el: Element | Window, type: string, init = {}) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 310,
      ...init,
    })
  );
}

async function hold(el: Element) {
  await act(async () => pointer(el, "pointerdown"));
  await act(async () => vi.advanceTimersByTime(450));
}

describe("a cut-off chapter title (S14, #1284)", () => {
  it("held 450 ms shows the whole name in a bubble, and the row does not lift", async () => {
    await mount();
    cutOff(title(2));
    await act(async () => pointer(title(2), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(449));
    expect(bubble()).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(bubble()?.textContent).toBe(LONG_CHAPTER);
    expect(chapterLifted()).toBeNull();
    // Long after a reorder would have lifted, still nothing lifts.
    await act(async () => vi.advanceTimersByTime(1000));
    expect(chapterLifted()).toBeNull();
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("is a picture of the name only: hidden from screen readers, which read the row's own name", async () => {
    await mount();
    cutOff(title(2));
    await hold(title(2));
    expect(bubble()!.getAttribute("aria-hidden")).toBe("true");
    expect(bubble()!.getAttribute("dir")).toBe("auto");
    // The row's accessible name already carries the whole name, with no hold.
    expect(rowButton(2).getAttribute("aria-label")).toBe(
      strings.openChapter(LONG_CHAPTER)
    );
  });

  it("the release puts it away and does not open the chapter; a later tap does", async () => {
    await mount();
    cutOff(title(2));
    await hold(title(2));
    await act(async () => pointer(window, "pointerup"));
    expect(bubble()).toBeNull();
    await act(async () => rowButton(2).click());
    expect(onOpenChapter).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => rowButton(2).click());
    expect(onOpenChapter).toHaveBeenCalledWith("ch2");
  });

  it("a tap shorter than the hold still opens the chapter", async () => {
    await mount();
    cutOff(title(2));
    await act(async () => pointer(title(2), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => pointer(window, "pointerup"));
    await act(async () => rowButton(2).click());
    expect(bubble()).toBeNull();
    expect(onOpenChapter).toHaveBeenCalledWith("ch2");
  });

  it("goes away on its own after 6 s, and on Escape", async () => {
    await mount();
    cutOff(title(2));
    await hold(title(2));
    await act(async () => vi.advanceTimersByTime(5999));
    expect(bubble()).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(bubble()).toBeNull();
    await act(async () => pointer(window, "pointerup"));

    await act(async () => vi.advanceTimersByTime(1000));
    await hold(title(2));
    expect(bubble()).not.toBeNull();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(bubble()).toBeNull();
  });

  it("goes away on a second touch", async () => {
    await mount();
    cutOff(title(2));
    await hold(title(2));
    await act(async () =>
      pointer(document.body, "pointerdown", { pointerId: 2 })
    );
    expect(bubble()).toBeNull();
  });
});

describe("a name that fits keeps the reorder hold (#953, #338)", () => {
  it("a fitting chapter title held 450 ms lifts its row, with no bubble", async () => {
    await mount();
    await hold(title(2));
    expect(bubble()).toBeNull();
    expect(items()[2]!.classList.contains("books-lifted")).toBe(true);
  });

  it("a fitting book name held 450 ms lifts the book, with no bubble", async () => {
    await mount();
    await hold(bookName());
    expect(bubble()).toBeNull();
    expect(bookLifted()).not.toBeNull();
  });

  it("the cover beside a cut-off book name still lifts the book", async () => {
    await mount();
    cutOff(bookName());
    await hold(document.querySelector(".books-list > li .books-cover")!);
    expect(bubble()).toBeNull();
    expect(bookLifted()).not.toBeNull();
  });
});

describe("a cut-off book name (S14, #1284)", () => {
  it("held 450 ms shows the whole name; the book neither lifts nor closes", async () => {
    await mount();
    expect(bookToggle().getAttribute("aria-expanded")).toBe("true");
    cutOff(bookName());
    await hold(bookName());
    expect(bubble()?.textContent).toBe(LONG_BOOK);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(bookLifted()).toBeNull();
    await act(async () => pointer(window, "pointerup"));
    await act(async () => bookToggle().click());
    expect(bubble()).toBeNull();
    expect(bookToggle().getAttribute("aria-expanded")).toBe("true");
    expect(moveBook).not.toHaveBeenCalled();
    expect(bookToggle().getAttribute("aria-label")).toContain(LONG_BOOK);
  });
});
