// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import {
  COVER_COLOUR_KEYS,
  coverColourHex,
  resolveCoverKey,
} from "@/lib/cover-colour";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * The O4 Books screen (#942, epic #936): states 01 (empty shelf) and 03 (the
 * list), the book covers, the chapter rows and their progress dots.
 *
 * The whole screen is mounted, not a row in isolation, because two of the
 * promises are about the composition: the guided ring (#604, #834) landing
 * on the same control in both looks, and the accessible names and their order
 * staying the same when the switch flips. `useDesign()` is mocked so each
 * case picks its look — the pattern `tests/segments-o4.test.ts` follows. The
 * data hooks are mocked the way `tests/books-share-overlay-delete-guard.test.ts`
 * mocks them.
 *
 * What this file does NOT cover: the cascade, and layout. jsdom computes no
 * boxes, so "the dots fit" is proved here as arithmetic over the size and gap
 * the row emits against the 206px column the stylesheet declares — not as a
 * measured box. Nothing here has been run in a browser or on a phone.
 */

const design = vi.hoisted(() => ({ current: "current" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const shelfState = vi.hoisted(() => ({ books: [] as BookCard[] }));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelfState.books,
    newBookPlaceholder: "Book 001",
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
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/failure-log", () => ({ useFailureCount: () => 0 }));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const bookId = (n: number) =>
  `book-0000-4000-8000-${String(n).padStart(12, "0")}` as BookId;
const chapterId = (b: number, n: number) =>
  `chapter-${b}-4000-8000-${String(n).padStart(12, "0")}` as ChapterId;

function chapter(
  b: number,
  n: number,
  extra: Partial<ChapterRow> = {}
): ChapterRow {
  return {
    chapterId: chapterId(b, n),
    number: n,
    name: null,
    finishedCount: 0,
    totalCount: 0,
    recordedCount: 0,
    ...extra,
  };
}

let root: Root;
const layers = new Map<string, Layer>();

beforeEach(() => {
  layers.clear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  design.current = "current";
  shelfState.books = [];
});

/** A fresh root, so a second look starts from a collapsed shelf. */
async function fresh() {
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root")!);
}

async function mount(look: Design, books: BookCard[]) {
  design.current = look;
  shelfState.books = books;
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}

function all(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

function only(selector: string, within: ParentNode = document): HTMLElement {
  const found = [...within.querySelectorAll<HTMLElement>(selector)];
  expect(found, `exactly one ${selector}`).toHaveLength(1);
  return found[0]!;
}

/** Every button's accessible name, in document order. */
function buttonNames(): string[] {
  return all("#root button").map((el) => el.getAttribute("aria-label") ?? "");
}

/** The size and gap the row asked its dots to take, in px. */
function dotGeometry(row: HTMLElement): { size: number; gap: number } {
  const dots = only(".books-dots", row);
  const size = parseFloat(dots.style.getPropertyValue("--dot"));
  const gap = parseFloat(dots.style.getPropertyValue("--dot-gap"));
  return { size, gap };
}

/** Rows the dots wrap onto, and the height they take, in a 206px column. */
function packed(n: number, { size, gap }: { size: number; gap: number }) {
  const perRow = Math.floor((206 + gap) / (size + gap));
  const rows = Math.ceil(n / perRow);
  return { rows, height: rows * (size + gap) - gap };
}

describe("O4 Books list, state 03 (#942)", () => {
  it("draws each book as a card with a cover in its stored colour, or the id-derived one", async () => {
    // A stored key that is NOT this book's own fallback, so the two branches
    // of `resolveCoverKey` cannot pass for each other.
    const derived = resolveCoverKey({ id: bookId(1), coverColourKey: null });
    const stored = COVER_COLOUR_KEYS.find((key) => key !== derived)!;
    const chosen: BookCard = {
      bookId: bookId(1),
      name: "Mark",
      coverColourKey: stored,
      chapters: [],
    };
    const unchosen: BookCard = {
      bookId: bookId(2),
      name: "Ruth",
      coverColourKey: null,
      chapters: [chapter(2, 1)],
    };
    await mount("o4", [chosen, unchosen]);

    const cards = all(".books-card");
    expect(cards).toHaveLength(2);
    const [markCover, ruthCover] = cards.map((card) =>
      only(".books-cover", card)
    );
    // #964's API owns the colour: the stored key when there is one, its
    // id-derived fallback otherwise — never a second hash of this lane's.
    expect(markCover!.style.getPropertyValue("--book-cover")).toBe(
      coverColourHex(stored)
    );
    expect(coverColourHex(stored)).not.toBe(coverColourHex(derived));
    expect(ruthCover!.style.getPropertyValue("--book-cover")).toBe(
      coverColourHex(resolveCoverKey({ id: bookId(2), coverColourKey: null }))
    );
    // Decoration: the toggle's own name already says which book this is.
    expect(markCover!.closest("[aria-hidden='true']")).not.toBeNull();
    // The cover sits inside the toggle, so tapping it opens the book.
    expect(markCover!.closest("button")).toBe(
      button(strings.bookRow("Mark", 0, false))
    );
  });

  it("gives a chapter row a 44 badge, a chevron, and a title line only when the chapter has a typed name", async () => {
    await mount("o4", [
      {
        bookId: bookId(1),
        name: "Mark",
        coverColourKey: null,
        chapters: [
          chapter(1, 1),
          chapter(1, 2, { name: "The sower", totalCount: 3 }),
        ],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 2, false)).click());

    const plain = button(strings.openChapter(strings.chapterName(1)));
    expect(only(".books-chapter-num", plain).textContent).toBe("1");
    expect(only(".books-chapter-num", plain).classList.contains("is-dim")).toBe(
      false
    );
    expect(plain.querySelector(".books-chapter-title")).toBeNull();

    const titled = button(strings.openChapter("The sower"));
    expect(only(".books-chapter-num", titled).textContent).toBe("2");
    expect(
      only(".books-chapter-num", titled).classList.contains("is-dim")
    ).toBe(true);
    expect(only(".books-chapter-title", titled).textContent).toBe("The sower");
    // The row's name already carries the title, so none of this adds to the
    // reading order.
    for (const row of [plain, titled]) {
      expect(only(".books-chapter", row.parentElement!)).toBe(row);
      for (const child of row.children) {
        expect(child.getAttribute("aria-hidden")).toBe("true");
      }
    }
  });

  it("draws one dot per segment, finished, then recorded, then empty", async () => {
    await mount("o4", [
      {
        bookId: bookId(1),
        name: "Mark",
        coverColourKey: null,
        chapters: [
          chapter(1, 1, { totalCount: 6, finishedCount: 2, recordedCount: 3 }),
          chapter(1, 2),
        ],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 2, false)).click());

    const worked = button(strings.openChapter(strings.chapterName(1)));
    expect(
      [...only(".books-dots", worked).children].map((dot) =>
        dot.getAttribute("data-state")
      )
    ).toEqual(["finished", "finished", "recorded", "empty", "empty", "empty"]);
    // An empty chapter has nothing to count, and draws nothing — not "0/0".
    const empty = button(strings.openChapter(strings.chapterName(2)));
    expect(only(".books-dots", empty).children).toHaveLength(0);
  });

  it("fits every chapter's dots in the column in a 26-chapter book, titled or not", async () => {
    const chapters = Array.from({ length: 26 }, (_, i) =>
      chapter(1, i + 1, {
        // Every size the fit has to choose between, including 26 segments —
        // the design reference's own dot-fitting case — and past it.
        totalCount: i + 1 + (i >= 13 ? 20 : 0),
        finishedCount: i % 3,
        recordedCount: i % 5,
        name: i % 2 === 0 ? `Passage ${i + 1}` : null,
      })
    );
    await mount("o4", [
      { bookId: bookId(1), name: "Mark", coverColourKey: null, chapters },
    ]);
    await act(async () => button(strings.bookRow("Mark", 26, false)).click());

    const rows = all(".books-chapter");
    expect(rows).toHaveLength(26);
    const sizes = new Set<number>();
    for (const [i, row] of rows.entries()) {
      const { totalCount, name } = chapters[i]!;
      expect(only(".books-dots", row).children).toHaveLength(totalCount);
      const geometry = dotGeometry(row);
      sizes.add(geometry.size);
      // 44px of middle column without a title, 19px under a 20px title line
      // with its 5px gap (the design reference, §3).
      const room = name === null ? 44 : 19;
      expect(
        packed(totalCount, geometry).height,
        `chapter ${i + 1}: ${totalCount} dots at ${geometry.size}/${geometry.gap}`
      ).toBeLessThanOrEqual(room);
    }
    // The fit actually steps down, rather than one small size passing
    // everything.
    expect(sizes.has(13)).toBe(true);
    expect(sizes.size).toBeGreaterThanOrEqual(3);
  });

  it("takes the largest size that fits: 13/6, stepping down to 5/2", async () => {
    await mount("o4", [
      {
        bookId: bookId(1),
        name: "Mark",
        coverColourKey: null,
        chapters: [
          chapter(1, 1, { totalCount: 11 }),
          chapter(1, 2, { totalCount: 26 }),
          chapter(1, 3, { totalCount: 26, name: "Titled" }),
          chapter(1, 4, { totalCount: 41, name: "Many" }),
        ],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 4, false)).click());
    const [eleven, plain26, titled26, titled41] = all(".books-chapter");
    expect(dotGeometry(eleven!)).toEqual({ size: 13, gap: 6 });
    expect(dotGeometry(plain26!)).toEqual({ size: 11, gap: 5 });
    expect(dotGeometry(titled26!)).toEqual({ size: 7, gap: 3 });
    expect(dotGeometry(titled41!)).toEqual({ size: 5, gap: 2 });
  });

  it("keeps every accessible name, in the same order, as the current look", async () => {
    const shelf: BookCard[] = [
      {
        bookId: bookId(1),
        name: "Mark",
        coverColourKey: "teal",
        chapters: [
          chapter(1, 1, { totalCount: 4, finishedCount: 1, recordedCount: 2 }),
          chapter(1, 2, { name: "The sower" }),
        ],
      },
      { bookId: bookId(2), name: "Ruth", coverColourKey: null, chapters: [] },
    ];
    const names: Record<Design, string[]> = { current: [], o4: [] };
    for (const look of ["current", "o4"] as const) {
      await fresh();
      await mount(look, shelf);
      await act(async () => button(strings.bookRow("Mark", 2, false)).click());
      names[look] = buttonNames();
    }
    expect(names.o4.length).toBeGreaterThanOrEqual(7);
    expect(names.o4).toEqual(names.current);
  });

  it("adds none of its markup with the switch off", async () => {
    await mount("current", [
      {
        bookId: bookId(1),
        name: "Mark",
        coverColourKey: "teal",
        chapters: [chapter(1, 1, { totalCount: 4, name: "The sower" })],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 1, false)).click());
    expect(button(strings.openChapter("The sower"))).toBeTruthy();
    expect(document.querySelectorAll("[class*='books-']")).toHaveLength(0);
    expect(document.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("O4 Books header and empty shelf, state 01 (#942)", () => {
  it("draws the header as 56px with ghost buttons, and the empty shelf's outline", async () => {
    await mount("o4", []);
    only(".books-header");
    expect(button(strings.menuOpen).classList.contains("books-ghost")).toBe(
      true
    );
    // The invite's own CTA is the one create affordance (unchanged), under a
    // decorative book outline.
    const empty = only(".books-empty");
    expect(
      only(".books-empty-outline", empty).getAttribute("aria-hidden")
    ).toBe("true");
    expect(empty.contains(button(strings.newBook))).toBe(true);
  });

  it("makes the header's New book a square button once the shelf has books", async () => {
    await mount("o4", [
      { bookId: bookId(1), name: "Mark", coverColourKey: null, chapters: [] },
    ]);
    expect(button(strings.newBook).classList.contains("books-add")).toBe(true);
  });
});

describe("the guided ring lands on the same control in both looks (#604, #834)", () => {
  async function guidedIn(look: Design, books: BookCard[], expand?: string) {
    await mount(look, books);
    if (expand) await act(async () => button(expand).click());
    const marked = all("#root .is-guided");
    expect(marked, `${look}: one guided control`).toHaveLength(1);
    return marked[0]!.getAttribute("aria-label");
  }

  const cases: [string, BookCard[], string, string?][] = [
    ["new-book: the empty shelf's CTA", [], strings.newBook],
    [
      "add-chapter: a new book's + (#834), with another book on the shelf",
      [
        { bookId: bookId(2), name: "Ruth", coverColourKey: null, chapters: [] },
        {
          bookId: bookId(1),
          name: "Mark",
          coverColourKey: null,
          chapters: [chapter(1, 1)],
        },
      ],
      strings.addChapter("Ruth"),
    ],
    [
      "expand-book: the collapsed book's toggle",
      [
        {
          bookId: bookId(1),
          name: "Mark",
          coverColourKey: null,
          chapters: [chapter(1, 1)],
        },
      ],
      strings.bookRow("Mark", 1, false),
    ],
    [
      "open-chapter: the first chapter row",
      [
        {
          bookId: bookId(1),
          name: "Mark",
          coverColourKey: null,
          chapters: [chapter(1, 1)],
        },
      ],
      strings.openChapter(strings.chapterName(1)),
      strings.bookRow("Mark", 1, false),
    ],
  ];

  for (const [step, books, expected, expand] of cases) {
    it(step, async () => {
      expect(await guidedIn("current", books, expand)).toBe(expected);
      await fresh();
      expect(await guidedIn("o4", books, expand)).toBe(expected);
    });
  }
});

describe("o4/books.css (#942)", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../src/app/styles/o4/books.css"),
    "utf8"
  );
  // Comments stripped first, so a header naming a selector or a primitive can
  // neither satisfy nor trip a check below (AGENTS.md, the share-scrim trap).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const layerOpen = code.indexOf("@layer components {");
  const body = code.slice(layerOpen + "@layer components {".length);
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    declarations: m[2]!
      .split(";")
      .map((d) => d.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));
  const O4 = '[data-design="o4"]';

  function block(sel: string): string[] {
    const hits = rules.filter((r) => r.selectors.includes(sel));
    expect(hits, sel).toHaveLength(1);
    return hits[0]!.declarations;
  }

  it("holds its rules inside the components layer, every one scoped under the switch", () => {
    expect(layerOpen).toBeGreaterThanOrEqual(0);
    expect(rules.length).toBeGreaterThanOrEqual(12);
    for (const rule of rules) {
      for (const sel of rule.selectors) {
        expect(sel.startsWith(`${O4} `), sel).toBe(true);
      }
    }
  });

  it("reads colour only through layer-2 roles, and leaves the guide ring alone", () => {
    const values = rules.flatMap((r) => r.declarations);
    expect(values.length).toBeGreaterThanOrEqual(40);
    for (const decl of values) {
      expect(decl, decl).not.toMatch(/var\(--p-/);
      expect(decl, decl).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(decl, decl).not.toMatch(/rgba?\(|hsla?\(/);
    }
    // `.is-guided` is an inset box-shadow; an O4 rule on a guided control's
    // own selector that sets one would out-specify it and erase the ring.
    for (const sel of [
      `${O4} .books-card-hit`,
      `${O4} .books-chapter`,
      `${O4} .books-ghost`,
      `${O4} .books-add`,
    ]) {
      expect(
        block(sel).some((d) => d.startsWith("box-shadow")),
        sel
      ).toBe(false);
    }
  });

  it("carries the issue's geometry", () => {
    expect(block(`${O4} .books-header`)).toEqual(
      expect.arrayContaining(["height: 56px"])
    );
    expect(block(`${O4} .books-ghost`)).toEqual(
      expect.arrayContaining(["width: 44px", "height: 48px"])
    );
    expect(block(`${O4} .books-card`)).toEqual(
      expect.arrayContaining([
        "border-radius: 18px",
        "padding: 10px",
        "background: var(--s-surface)",
        "border: 1px solid var(--s-card-edge)",
      ])
    );
    expect(block(`${O4} .books-cover`)).toEqual(
      expect.arrayContaining([
        "width: 72px",
        "height: 90px",
        "border-radius: 9px",
        "background: var(--book-cover)",
      ])
    );
    expect(block(`${O4} .books-cover::before`)).toEqual(
      expect.arrayContaining(["width: 7px"])
    );
    expect(block(`${O4} .books-chapter`)).toEqual(
      expect.arrayContaining(["height: 68px", "border-radius: 12px"])
    );
    expect(block(`${O4} .books-chapter-num`)).toEqual(
      expect.arrayContaining([
        "width: 44px",
        "height: 44px",
        "background: var(--s-well)",
      ])
    );
    expect(block(`${O4} .books-chapter-num.is-dim`)).toEqual(
      expect.arrayContaining([
        "background: transparent",
        "color: var(--s-ink-faint)",
      ])
    );
    // The column the fit is computed against.
    expect(block(`${O4} .books-dots`)).toEqual(
      expect.arrayContaining(["max-width: 206px", "gap: var(--dot-gap)"])
    );
    expect(block(`${O4} .books-dots > i`)).toEqual(
      expect.arrayContaining(["width: var(--dot)", "height: var(--dot)"])
    );
    expect(block(`${O4} .books-dots > [data-state="finished"]`)).toContain(
      "background: var(--s-done)"
    );
    expect(block(`${O4} .books-dots > [data-state="recorded"]`)).toContain(
      "background: var(--s-voice)"
    );
  });
});
