// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * Press-and-hold reorder of BOOKS on the Books screen (#338), wired: the real
 * `BooksScreen` with `useBooks` replaced at its boundary, as
 * `books-reorder-o4.test.ts` does for chapters. These cases are about the
 * call sites — that the hold starts on the book's own row (its expand
 * toggle), and that the one `moveBook` call happens on the drop and nowhere
 * else. The gesture itself is `hooks/use-reorder-gesture.ts`, shared with
 * the chapter and segment lists and pinned in
 * `tests/reorder-gesture.test.ts`.
 *
 * Layout is faked: jsdom has none, so each book `<li>` reports a 150px card
 * at a 200px pitch (or, in the open-book cases, a short-tall-short shelf) and
 * everything else a 700px box. What this cannot see:
 * real touch panning, the cascade, and anything on a device.
 */

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  moveBook: null as unknown as (
    id: BookId,
    toIndex: number
  ) => Promise<boolean>,
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
    moveBook: (id: BookId, toIndex: number) => state.moveBook(id, toIndex),
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

const mark = "book-0000-4000-8000-000000000001" as BookId;
const ruth = "book-0000-4000-8000-000000000002" as BookId;
const luke = "book-0000-4000-8000-000000000003" as BookId;

const shelf = (): BookCard[] => [
  {
    bookId: mark,
    name: "Mark",
    number: 1,
    coverColourKey: "teal",
    chapters: [
      {
        chapterId: "ch0" as ChapterId,
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 1,
        recordedCount: 0,
      },
    ],
  },
  { bookId: ruth, name: "Ruth", number: 1, coverColourKey: null, chapters: [] },
  { bookId: luke, name: null, number: 2, coverColourKey: null, chapters: [] },
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

/** Book card `i`'s faked layout. Equal cards unless a case says otherwise. */
let cardRect: (i: number) => DOMRect;
let root: Root;
let moveBook: ReturnType<
  typeof vi.fn<(id: BookId, toIndex: number) => Promise<boolean>>
>;
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
  cardRect = (i) => rect(i * 200, 150);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const list = this.parentElement;
      if (this.tagName === "LI" && list?.classList.contains("books-list")) {
        const i = [...list.children].indexOf(this);
        return cardRect(i);
      }
      return rect(0, 700);
    }
  );
  state.books = shelf();
  moveBook = vi.fn<(id: BookId, toIndex: number) => Promise<boolean>>(() =>
    Promise.resolve(true)
  );
  state.moveBook = moveBook;
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

async function render() {
  await act(async () =>
    root.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

const cards = () => [
  ...document.querySelectorAll<HTMLLIElement>(".books-list > li"),
];
const toggle = (i: number) =>
  cards()[i]!.querySelector<HTMLButtonElement>(".books-card-hit")!;
const liveText = () =>
  document.querySelector('[data-reorder-status][role="status"]')?.textContent ??
  null;
const lifted = () => document.querySelector(".books-card-lifted");
const names = () =>
  [...document.querySelectorAll(".books-name")].map((n) => n.textContent);

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

async function hold(el: Element, y: number) {
  await act(async () => pointer(el, "pointerdown", y));
  await act(async () => vi.advanceTimersByTime(450));
}

/** Drag Mark (top) to the bottom and release. */
async function dragTopToBottom() {
  await hold(toggle(0), 75);
  await act(async () => pointer(toggle(0), "pointermove", 495));
  await act(async () => pointer(toggle(0), "pointerup", 495));
}

describe("the hold area: the book's own row (#338)", () => {
  it("lifts a book held 450 ms on its row, and announces it by its heading", async () => {
    await render();
    await act(async () => pointer(toggle(0), "pointerdown", 75));
    await act(async () => vi.advanceTimersByTime(449));
    expect(lifted()).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(cards()[0]!.classList.contains("books-card-lifted")).toBe(true);
    expect(liveText()).toBe(strings.bookReorderLifted("Mark"));
    expect(moveBook).not.toHaveBeenCalled();
  });

  it("lifts from the cover and the name, which sit inside the row", async () => {
    await render();
    await hold(cards()[1]!.querySelector(".books-name")!, 275);
    expect(cards()[1]!.classList.contains("books-card-lifted")).toBe(true);
    await act(async () => pointer(toggle(1), "pointercancel", 275));
    await hold(cards()[2]!.querySelector(".books-cover")!, 475);
    expect(cards()[2]!.classList.contains("books-card-lifted")).toBe(true);
  });

  it("never starts on the book's + or ⋮", async () => {
    await render();
    const head = cards()[0]!.querySelector(".books-card-head")!;
    for (const target of head.querySelectorAll("button:not(.books-card-hit)")) {
      await hold(target, 75);
      expect(lifted()).toBeNull();
      await act(async () => pointer(target, "pointerup", 75));
    }
    expect(moveBook).not.toHaveBeenCalled();
  });

  it("leaves a plain tap on the row opening and closing the book", async () => {
    await render();
    await act(async () => pointer(toggle(0), "pointerdown", 75));
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => pointer(toggle(0), "pointerup", 75));
    await act(async () => toggle(0).click());
    expect(toggle(0).getAttribute("aria-expanded")).toBe("true");
    expect(moveBook).not.toHaveBeenCalled();
  });

  it("marks the book rows as hold areas", async () => {
    await render();
    expect(
      [...document.querySelectorAll(".books-card-head [data-reorder-handle]")]
        .map((el) => el.className)
        .every((c) => c.split(" ").includes("books-card-hit"))
    ).toBe(true);
    expect(
      document.querySelectorAll(".books-card-head [data-reorder-handle]")
    ).toHaveLength(3);
  });
});

describe("the book-reorder landing wording (#1368)", () => {
  it("says the shelf position, not 'number', which already names the Book N placeholder", () => {
    expect(strings.bookReorderMoved("Mark", 3)).toBe(
      "Mark is now position 3 on the shelf."
    );
    expect(strings.bookReorderMoved("Mark", 3)).not.toMatch(/number/i);
  });
});

describe("the drag and the one write (#338)", () => {
  it("shifts the other books while dragging, writes nothing until the drop, then writes once", async () => {
    await render();
    await hold(toggle(0), 75);
    await act(async () => pointer(toggle(0), "pointermove", 495));
    const list = document.querySelector(".books-list")!;
    expect(list.hasAttribute("data-reordering")).toBe(true);
    expect(
      cards().map((li) => li.style.getPropertyValue("--reorder-y"))
    ).toEqual(["420px", "-200px", "-200px"]);
    expect(moveBook).not.toHaveBeenCalled();

    await act(async () => pointer(toggle(0), "pointerup", 495));
    expect(moveBook).toHaveBeenCalledTimes(1);
    expect(moveBook).toHaveBeenCalledWith(mark, 2);
    expect(moveChapter).not.toHaveBeenCalled();
    expect(liveText()).toBe(strings.bookReorderMoved("Mark", 3));
    expect(list.hasAttribute("data-reordering")).toBe(false);
  });

  it("names an unnamed book by its placeholder", async () => {
    await render();
    await hold(toggle(2), 475);
    expect(liveText()).toBe(
      strings.bookReorderLifted(strings.bookHeading(null, 2))
    );
  });

  it("swallows the release's click so a drop does not open the book", async () => {
    await render();
    await dragTopToBottom();
    await act(async () => toggle(0).click());
    expect(toggle(0).getAttribute("aria-expanded")).toBe("false");
  });

  it("writes nothing when dropped back in place, and says so", async () => {
    await render();
    await hold(toggle(1), 275);
    await act(async () => pointer(toggle(1), "pointermove", 480));
    await act(async () => pointer(toggle(1), "pointermove", 280));
    await act(async () => pointer(toggle(1), "pointerup", 280));
    expect(moveBook).not.toHaveBeenCalled();
    expect(liveText()).toBe(strings.bookReorderStayed("Ruth"));
    expect(lifted()).toBeNull();
  });

  it("says the book stayed when the write does not land", async () => {
    moveBook.mockImplementation(() => Promise.resolve(false));
    await render();
    await dragTopToBottom();
    expect(moveBook).toHaveBeenCalledWith(mark, 2);
    expect(liveText()).toBe(strings.bookReorderStayed("Mark"));
  });

  it("lets go without a write when an overlay covers the shelf", async () => {
    await render();
    await hold(toggle(0), 75);
    await act(async () => pointer(toggle(0), "pointermove", 495));
    const menu = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === strings.bookMenuOpen("Mark")
    )!;
    await act(async () => menu.click());
    expect(lifted()).toBeNull();
    await act(async () => pointer(toggle(0), "pointerup", 495));
    expect(moveBook).not.toHaveBeenCalled();
  });

  it("lets go without a write when the shelf changes under the finger", async () => {
    await render();
    await hold(toggle(0), 75);
    state.books = state.books.slice(0, 2);
    await render();
    expect(lifted()).toBeNull();
    await act(async () => pointer(toggle(0), "pointerup", 495));
    expect(moveBook).not.toHaveBeenCalled();
  });

  it("also moves an open book, with its chapters, as one card", async () => {
    await render();
    await act(async () => toggle(0).click());
    expect(toggle(0).getAttribute("aria-expanded")).toBe("true");
    await dragTopToBottom();
    expect(moveBook).toHaveBeenCalledWith(mark, 2);
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("hands focus to the moved book's row when focus was nowhere (a touch drag)", async () => {
    await render();
    (document.activeElement as HTMLElement | null)?.blur();
    await dragTopToBottom();
    // The hook's optimistic patch, as `useBooks().moveBook` applies it.
    const [m, r, l] = state.books;
    state.books = [r!, l!, m!];
    await render();
    expect(names()).toEqual(["Ruth", strings.bookHeading(null, 2), "Mark"]);
    expect(document.activeElement).toBe(toggle(2));
  });

  it("does not pull focus off another control", async () => {
    await render();
    toggle(1).focus();
    await dragTopToBottom();
    const [m, r, l] = state.books;
    state.books = [r!, l!, m!];
    await render();
    expect(document.activeElement).toBe(toggle(0));
    expect(toggle(0).querySelector(".books-name")!.textContent).toBe("Ruth");
  });
});

describe("an open book is a tall card, and still moves by its row (#338)", () => {
  // Mark 0–120, Ruth open 192–2592, Luke 2604–2724: a 12px gap below Ruth,
  // 72px below Mark. Ruth's pitch is 2412px, Mark's 192px. The scroller sits
  // at the top of the viewport with `scrollTop` 0, so it cannot auto-scroll
  // up, and a client y is a content y.
  beforeEach(() => {
    const tall = [rect(0, 120), rect(192, 2400), rect(2604, 120)];
    cardRect = (i) => tall[i]!;
  });
  const shifts = () =>
    cards().map((li) => li.style.getPropertyValue("--reorder-y"));

  it("drags a tall open book up to the top by its row", async () => {
    await render();
    await act(async () => toggle(1).click());
    expect(toggle(1).getAttribute("aria-expanded")).toBe("true");
    await hold(toggle(1), 192);
    await act(async () => pointer(toggle(1), "pointermove", 0));
    // Mark makes room by one step of Ruth's own pitch; Ruth follows the finger.
    expect(shifts()).toEqual(["2412px", "-192px", "0px"]);
    await act(async () => pointer(toggle(1), "pointerup", 0));
    expect(moveBook).toHaveBeenCalledTimes(1);
    expect(moveBook).toHaveBeenCalledWith(ruth, 0);
  });

  it("drags a tall open book down past a short one once its bottom has passed it, not before", async () => {
    await render();
    await act(async () => toggle(1).click());
    await hold(toggle(1), 192);
    // 100px down: Ruth's bottom (2692) is still above Luke's (2724), and the
    // slot below Luke would start at 324, under the finger at 292.
    await act(async () => pointer(toggle(1), "pointermove", 292));
    expect(shifts()).toEqual(["0px", "100px", "0px"]);
    // 140px down: Ruth's bottom (2732) has passed Luke's.
    await act(async () => pointer(toggle(1), "pointermove", 332));
    expect(shifts()).toEqual(["0px", "140px", "-2412px"]);
    await act(async () => pointer(toggle(1), "pointerup", 332));
    expect(moveBook).toHaveBeenCalledTimes(1);
    expect(moveBook).toHaveBeenCalledWith(ruth, 2);
  });

  it("does not jump a short book ahead of the finger past a tall one", async () => {
    await render();
    await act(async () => toggle(1).click());
    await hold(toggle(0), 60);
    // The finger is on Ruth's own row, far above where Mark would land below
    // her: Mark stays where he is.
    await act(async () => pointer(toggle(0), "pointermove", 260));
    expect(shifts()).toEqual(["200px", "0px", "0px"]);
    await act(async () => pointer(toggle(0), "pointerup", 260));
    expect(moveBook).not.toHaveBeenCalled();

    // Once Mark's bottom has passed Ruth's, he lands below her, and only her.
    await hold(toggle(0), 60);
    await act(async () => pointer(toggle(0), "pointermove", 2540));
    expect(shifts()).toEqual(["2480px", "-192px", "0px"]);
    await act(async () => pointer(toggle(0), "pointerup", 2540));
    expect(moveBook).toHaveBeenCalledTimes(1);
    expect(moveBook).toHaveBeenCalledWith(mark, 1);
  });
});

describe("o4/books.css: the book lift (#338)", () => {
  const books = stripCssComments(
    readFileSync(
      path.resolve(import.meta.dirname, "../src/app/styles/o4/books.css"),
      "utf8"
    )
  );
  const reduced = books.indexOf("@media (prefers-reduced-motion: reduce)");
  const main = books.slice(0, reduced);
  const motion = books.slice(reduced);

  it("slides the other cards over 160 ms and lifts the held one at scale 1.03 on z 8", () => {
    const slide = cssRule(main, ":root .books-list[data-reordering] > li");
    expect(declarationValue(slide, "transform")).toBe(
      "translateY(var(--reorder-y, 0px))"
    );
    expect(declarationValue(slide, "transition")).toBe("transform 160ms ease");
    const lift = cssRule(
      main,
      ":root .books-list[data-reordering] > .books-card-lifted"
    );
    expect(declarationValue(lift, "z-index")).toBe("8");
    expect(declarationValue(lift, "transform")).toBe(
      "translateY(var(--reorder-y, 0px)) scale(1.03)"
    );
    expect(declarationValue(lift, "transition")).toBe("none");
  });

  it("drops the slide under reduced motion", () => {
    expect(reduced).toBeGreaterThan(0);
    expect(
      declarationValue(
        cssRule(motion, ":root .books-list[data-reordering] > li"),
        "transition"
      )
    ).toBe("none");
  });

  it("casts the lift shadow from o4/segments.css's one rule", () => {
    const segments = stripCssComments(
      readFileSync(
        path.resolve(import.meta.dirname, "../src/app/styles/o4/segments.css"),
        "utf8"
      )
    );
    expect(
      declarationValue(
        cssRule(segments, ":root .books-card-lifted"),
        "box-shadow"
      )
    ).toBe("0 14px 30px rgba(0, 0, 0, 0.38)");
  });
});
