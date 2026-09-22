// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

import { stripCssComments } from "./support";

/**
 * Press-and-hold reorder of CHAPTERS on the Books screen (#953 PR2b), wired:
 * the real `BooksScreen`, with `useBooks` and `useDesign` replaced at their
 * boundary (the `books-delete-in-sheet-o4` pattern), so these cases are about
 * the call sites — that the hold starts on the chapter row (the workbench's
 * `data-reorder="ch"` sits on the whole row button), that the O4 switch gates
 * it, and that the one `moveChapter` call happens on the drop and nowhere
 * else. The gesture itself is `hooks/use-reorder-gesture.ts`, shared with
 * the Segments list and pinned in `tests/segments-reorder-o4.test.ts` and
 * `tests/reorder-gesture.test.ts`.
 *
 * Layout is faked: jsdom has none, so each chapter `<li>` reports a 68px row
 * at a 100px pitch and everything else a 700px box. What this cannot see:
 * real touch panning, the cascade (whether `o4/books.css` paints the lift),
 * and anything on a device.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  // Replaced per test in `beforeEach`; the default is never called.
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

const mark = "book-0000-4000-8000-000000000001" as BookId;
const ruth = "book-0000-4000-8000-000000000002" as BookId;

function chapter(i: number, extra: Partial<ChapterRow> = {}): ChapterRow {
  return {
    chapterId: `ch${i}` as ChapterId,
    number: i + 1,
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
    chapters: [chapter(0), chapter(1), chapter(2, { name: "Mark 3" })],
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
let moveChapter: ReturnType<
  typeof vi.fn<(id: ChapterId, toIndex: number) => Promise<boolean>>
>;
let onOpenChapter: ReturnType<typeof vi.fn<(id: ChapterId) => void>>;

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
        return rect(i * 100, 68);
      }
      return rect(0, 700);
    }
  );
  design.current = "o4";
  state.books = shelf();
  moveChapter = vi.fn<(id: ChapterId, toIndex: number) => Promise<boolean>>(
    () => Promise.resolve(true)
  );
  state.moveChapter = moveChapter;
  onOpenChapter = vi.fn<(id: ChapterId) => void>();
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  design.current = "o4";
});

async function render() {
  await act(async () =>
    root.render(
      createElement(BooksScreen, {
        onOpenChapter,
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

/** Mount, then open Mark so its chapters show (books start collapsed). */
async function mount(look: Design = "o4") {
  design.current = look;
  await render();
  const toggle = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.bookRow("Mark", 3, false)
  )!;
  await act(async () => toggle.click());
}

const items = () => [
  ...document.querySelectorAll<HTMLLIElement>("#chapters-" + mark + " > li"),
];
const row = (i: number) => items()[i]!.querySelector("button")!;
const liveText = () =>
  document.querySelector('[data-reorder-status][role="status"]')?.textContent ??
  null;
const lifted = () => document.querySelector(".books-lifted");
const scroller = () =>
  document.querySelector("#chapters-" + mark)!.closest(".overflow-y-auto")!;

function pointer(
  el: Element,
  type: string,
  y: number,
  init: PointerEventInit = {}
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: y,
      ...init,
    })
  );
}

async function hold(el: Element, y: number) {
  await act(async () => pointer(el, "pointerdown", y));
  await act(async () => vi.advanceTimersByTime(450));
}

describe("the O4 hold area (#953 PR2b: the chapter row)", () => {
  it("lifts a chapter held 450 ms on its row, and announces it", async () => {
    await mount();
    await act(async () => pointer(row(0), "pointerdown", 34));
    await act(async () => vi.advanceTimersByTime(449));
    expect(lifted()).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(items()[0]!.classList.contains("books-lifted")).toBe(true);
    expect(liveText()).toBe(strings.chapterReorderLifted(1));
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("lifts from the number badge and the title, which sit inside the row", async () => {
    await mount();
    await hold(items()[2]!.querySelector(".books-chapter-title")!, 234);
    expect(items()[2]!.classList.contains("books-lifted")).toBe(true);
    await act(async () => pointer(row(2), "pointercancel", 234));
    await hold(items()[1]!.querySelector(".books-chapter-num")!, 134);
    expect(items()[1]!.classList.contains("books-lifted")).toBe(true);
  });

  it("never starts on the book's own buttons", async () => {
    await mount();
    const head = document.querySelector(".books-card-head")!;
    for (const target of head.querySelectorAll("button")) {
      await hold(target, 34);
      await act(async () => pointer(target, "pointerup", 34));
      expect(lifted()).toBeNull();
    }
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("leaves a plain tap on the row opening the chapter", async () => {
    await mount();
    await act(async () => pointer(row(1), "pointerdown", 134));
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => pointer(row(1), "pointerup", 134));
    await act(async () => row(1).click());
    expect(onOpenChapter).toHaveBeenCalledWith("ch1");
    expect(moveChapter).not.toHaveBeenCalled();
  });
});

describe("the drag and the one write", () => {
  it("shifts the neighbours while dragging, writes nothing until the drop, then writes once", async () => {
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    const list = document.querySelector("#chapters-" + mark)!;
    expect(list.hasAttribute("data-reordering")).toBe(true);
    expect(
      items().map((li) => li.style.getPropertyValue("--reorder-y"))
    ).toEqual(["215px", "-100px", "-100px"]);
    expect(moveChapter).not.toHaveBeenCalled();

    await act(async () => pointer(row(0), "pointerup", 249));
    expect(moveChapter).toHaveBeenCalledTimes(1);
    expect(moveChapter).toHaveBeenCalledWith("ch0", 2);
    expect(liveText()).toBe(strings.chapterReorderMoved(1, 3));
    expect(list.hasAttribute("data-reordering")).toBe(false);
  });

  it("swallows the release's click so a drop does not open the chapter", async () => {
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => pointer(row(0), "pointerup", 249));
    await act(async () => row(0).click());
    expect(onOpenChapter).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => row(0).click());
    expect(onOpenChapter).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when dropped back in place", async () => {
    await mount();
    await hold(row(1), 134);
    await act(async () => pointer(row(1), "pointermove", 240));
    await act(async () => pointer(row(1), "pointermove", 140));
    await act(async () => pointer(row(1), "pointerup", 140));
    expect(moveChapter).not.toHaveBeenCalled();
    expect(liveText()).toBe(strings.chapterReorderStayed(2));
    expect(lifted()).toBeNull();
  });

  it("writes nothing on pointercancel, and puts the row back", async () => {
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => pointer(row(0), "pointercancel", 249));
    await act(async () => pointer(row(0), "pointerup", 249));
    expect(moveChapter).not.toHaveBeenCalled();
    expect(lifted()).toBeNull();
    expect(
      items().map((li) => li.style.getPropertyValue("--reorder-y"))
    ).toEqual(["", "", ""]);
  });

  it("cancels at 8px before the hold ends", async () => {
    await mount();
    await act(async () => pointer(row(0), "pointerdown", 34));
    await act(async () => pointer(row(0), "pointermove", 42));
    await act(async () => vi.advanceTimersByTime(450));
    expect(lifted()).toBeNull();
  });

  it("cancels when the shelf scrolls before the lift", async () => {
    await mount();
    await act(async () => pointer(row(0), "pointerdown", 34));
    await act(async () => {
      scroller().dispatchEvent(new Event("scroll"));
    });
    await act(async () => vi.advanceTimersByTime(450));
    expect(lifted()).toBeNull();
  });

  it("writes nothing when the screen goes away mid-drag", async () => {
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => root.unmount());
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, isPrimary: true })
    );
    expect(moveChapter).not.toHaveBeenCalled();
    root = createRoot(document.getElementById("root")!);
  });

  it("lets go without a write when the chapters change under the finger", async () => {
    await mount();
    await hold(row(0), 34);
    state.books = [
      {
        ...state.books[0]!,
        chapters: [...state.books[0]!.chapters, chapter(3)],
      },
      state.books[1]!,
    ];
    await render();
    expect(lifted()).toBeNull();
    await act(async () => pointer(row(0), "pointerup", 249));
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("lets go without a write when an overlay covers the shelf", async () => {
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    const menu = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === strings.bookMenuOpen("Mark")
    )!;
    await act(async () => menu.click());
    expect(lifted()).toBeNull();
    await act(async () => pointer(row(0), "pointerup", 249));
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("says the chapter stayed when the write does not land", async () => {
    moveChapter.mockImplementation(() => Promise.resolve(false));
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => pointer(row(0), "pointerup", 249));
    expect(moveChapter).toHaveBeenCalledWith("ch0", 2);
    expect(liveText()).toBe(strings.chapterReorderStayed(1));
  });

  it("does not move the book on the shelf (#953 scope Q4)", async () => {
    await mount();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => pointer(row(0), "pointerup", 249));
    expect(
      [...document.querySelectorAll(".books-name")].map((n) => n.textContent)
    ).toEqual(["Mark", "Ruth"]);
  });

  /** Drag chapter 1 to the end, then apply the hook's optimistic patch. */
  async function dragFirstToLast() {
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => pointer(row(0), "pointerup", 249));
    const [a, b, c] = state.books[0]!.chapters;
    state.books = [
      {
        ...state.books[0]!,
        chapters: [
          { ...b!, number: 1 },
          { ...c!, number: 2 },
          { ...a!, number: 3 },
        ],
      },
      state.books[1]!,
    ];
    await render();
  }

  it("hands focus to the moved chapter's row when focus was nowhere (a touch drag)", async () => {
    await mount();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await dragFirstToLast();
    expect(document.activeElement).toBe(row(2));
    expect(row(2).getAttribute("aria-label")).toBe(
      strings.openChapter(strings.chapterHeading(null, 3))
    );
  });

  it("keeps focus that was on the moved chapter with that chapter", async () => {
    await mount();
    row(0).focus();
    await dragFirstToLast();
    expect(document.activeElement).toBe(row(2));
  });

  it("does not pull focus off another control", async () => {
    await mount();
    row(1).focus();
    await dragFirstToLast();
    expect(document.activeElement).toBe(row(0));
    expect(row(0).getAttribute("aria-label")).toBe(
      strings.openChapter(strings.chapterHeading(null, 1))
    );
  });
});

describe("the switch-off look does not gain the gesture", () => {
  it("renders no hold area and no live region, and a held row lifts nothing", async () => {
    await mount("current");
    expect(items()).toHaveLength(3);
    expect(document.querySelector("[data-reorder-handle]")).toBeNull();
    expect(document.querySelector("[data-reorder-status]")).toBeNull();
    await hold(row(0), 34);
    await act(async () => pointer(row(0), "pointermove", 249));
    await act(async () => pointer(row(0), "pointerup", 249));
    expect(lifted()).toBeNull();
    expect(document.querySelector("[data-reordering]")).toBeNull();
    expect(moveChapter).not.toHaveBeenCalled();
  });

  it("marks exactly the chapter rows as the hold area in O4", async () => {
    await mount();
    expect(
      [...document.querySelectorAll("[data-reorder-handle]")].map(
        (el) => el.className
      )
    ).toEqual(["books-chapter", "books-chapter", "books-chapter"]);
  });
});

describe("o4/books.css: the lift (§3, §4)", () => {
  const code = stripCssComments(
    readFileSync(
      path.resolve(import.meta.dirname, "../src/app/styles/o4/books.css"),
      "utf8"
    )
  );
  const reduced = code.indexOf("@media (prefers-reduced-motion: reduce)");
  const main = code.slice(0, reduced === -1 ? code.length : reduced);
  const motion = reduced === -1 ? "" : code.slice(reduced);
  function decls(source: string, selector: string): string[] {
    const hits = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1]!
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .includes(selector)
    );
    expect(hits, selector).toHaveLength(1);
    return hits[0]![2]!
      .split(";")
      .map((d) => d.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
  const O4 = '[data-design="o4"]';

  it("lifts the row at scale 1.03 on z 8 and slides the neighbours over 160 ms", () => {
    expect(
      decls(main, `${O4} .books-chapters[data-reordering] > .books-lifted`)
    ).toEqual(
      expect.arrayContaining([
        "z-index: 8",
        "transform: translateY(var(--reorder-y, 0px)) scale(1.03)",
        "transition: none",
      ])
    );
    expect(decls(main, `${O4} .books-chapters[data-reordering] > li`)).toEqual(
      expect.arrayContaining([
        "transform: translateY(var(--reorder-y, 0px))",
        "transition: transform 160ms ease",
      ])
    );
  });

  it("gives a lifted chapter row the raised ground (§3)", () => {
    expect(decls(main, `${O4} .books-lifted > .books-chapter`)).toContain(
      "background: var(--s-raised)"
    );
  });

  it("casts the lift shadow from o4/segments.css's one rule, on the item rather than the guided button", () => {
    const segments = stripCssComments(
      readFileSync(
        path.resolve(import.meta.dirname, "../src/app/styles/o4/segments.css"),
        "utf8"
      )
    );
    expect(decls(segments, `${O4} .books-lifted`)).toContain(
      "box-shadow: 0 14px 30px rgba(0, 0, 0, 0.38)"
    );
  });

  it("drops the slide under reduced motion", () => {
    expect(reduced).toBeGreaterThan(0);
    expect(
      decls(motion, `${O4} .books-chapters[data-reordering] > li`)
    ).toContain("transition: none");
  });
});
