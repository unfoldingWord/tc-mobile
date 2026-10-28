// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { idleChapterAudio } from "./chapter-audio";
import {
  COVER_COLOUR_KEYS,
  coverColourHex,
  resolveCoverKey,
} from "@/lib/cover-colour";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

import {
  areaRule,
  areaScope,
  areaSelector,
  scopeDeclarations,
  scopeRules,
} from "./o4-area-css";
import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * The O4 Books screen (#942, epic #936): states 01 (empty shelf) and 03 (the
 * list), the book covers, the chapter rows and their progress dots.
 *
 * The whole screen is mounted, not a row in isolation, because two of the
 * promises are about the composition: the guided ring (#604, #834) landing
 * on the intended control, and the accessible names and their order. The
 * data hooks are mocked the way `tests/books-share-overlay-delete-guard.test.ts`
 * mocks them.
 *
 * What this file does NOT cover: the cascade, and layout. jsdom computes no
 * boxes, so "the dots fit" is proved here as arithmetic over the size and gap
 * the row emits against the narrowest column a supported phone gives the dots
 * — derived below from the stylesheets' own declarations, not measured.
 */

const shelfState = vi.hoisted(() => ({ books: [] as BookCard[] }));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelfState.books,
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
    templateNumber: null,
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
  shelfState.books = [];
});

async function mount(books: BookCard[]) {
  shelfState.books = books;
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio(),
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

/** A stylesheet with its comments stripped (AGENTS.md, the share-scrim trap). */
const cssCode = (file: string) =>
  stripCssComments(
    readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
  );

/** Every `--p-*` primitive in layer 1, name → value. */
const primitives = new Map(
  [
    ...cssCode("src/app/styles/1-primitives.css").matchAll(
      /(--p-[\w-]+):\s*([^;]+);/g
    ),
  ].map(([, name, value]) => [name!, value!.trim()])
);
/** A declaration with each `var(--p-*)` replaced by the primitive's value. */
const resolvePrimitives = (decl: string) =>
  decl.replace(/var\((--p-[\w-]+)\)/g, (whole, name: string) => {
    const value = primitives.get(name);
    expect(value, `${name} is a layer-1 primitive`).toBeDefined();
    return value ?? whole;
  });

/** One rule body's declarations, read one property at a time through
 *  `declarationValue` (which throws on a missing or doubled one), with the
 *  value's whitespace collapsed and each primitive resolved. */
const declarations = (body: string) => ({
  get: (property: string) =>
    resolvePrimitives(declarationValue(body, property).replace(/\s+/g, " ")),
});
const px = (value: string | undefined) => {
  expect(value, "a px length").toMatch(/^-?\d+(\.\d+)?px$|^0$/);
  return parseFloat(value!);
};

/**
 * The narrowest supported viewport, in px: `e2e/edit-history-cue.spec.ts`'s
 * docblock names 320 as the narrowest width this repo supports.
 */
const NARROWEST_VIEWPORT = 320;

/**
 * The dots' column on the narrowest supported phone, walked down the CSS
 * chain from the viewport: the shell's side padding (`.app-shell`), the
 * card's padding and border, the chapter row's own padding, the 44 badge,
 * the row's two gaps and the end slot (`.books-chapter-go`, which took the
 * chevron's place in #1469 and holds the row's ⋮ too since #1730). The shelf's scroll box, the book list
 * and the chapter list add no inline space (none sets a padding). Every term
 * is read from the stylesheets, so a change to any of them moves this number.
 */
function narrowestDotColumn(): number {
  const books = areaScope("books");
  const rule = (selector: string) =>
    declarations(areaRule(books, areaSelector("books", selector)));
  const shell = declarations(
    cssRule(cssCode("src/app/styles/3-components.css"), ".app-shell")
  )
    .get("padding")!
    .split(" ");
  const shellSide = px(shell[1] ?? shell[0]);
  const card = rule(`.books-card`);
  const cardBorder = px(card.get("border")!.split(" ")[0]);
  const row = rule(`.books-chapter`);
  // Logical since #1552: `padding-inline: <start> <end>`, both summed here.
  const [rowLeft, rowRight] = row.get("padding-inline")!.split(" ");
  const badge = px(rule(`.books-chapter-num`).get("width"));
  return (
    NARROWEST_VIEWPORT -
    2 * shellSide -
    2 * (px(card.get("padding")) + cardBorder) -
    (px(rowLeft) + px(rowRight)) -
    badge -
    2 * px(row.get("gap")) -
    px(rule(`.books-chapter-go`).get("width"))
  );
}

/** Rows the dots wrap onto, and the height they take, in `column` px. */
function packed(
  n: number,
  { size, gap }: { size: number; gap: number },
  column: number
) {
  const perRow = Math.floor((column + gap) / (size + gap));
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
      number: 1,
      coverColourKey: stored,
      chapters: [],
    };
    const unchosen: BookCard = {
      bookId: bookId(2),
      name: "Ruth",
      number: 1,
      coverColourKey: null,
      chapters: [chapter(2, 1)],
    };
    await mount([chosen, unchosen]);

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

  it("badges read the slot, and an unnamed template chapter's title keeps the template's number (#1272 B, Q1 (b))", async () => {
    await mount([
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
        coverColourKey: null,
        chapters: [
          chapter(1, 1),
          chapter(1, 2, { name: "The sower" }),
          chapter(1, 3, { templateNumber: 7 }),
          chapter(1, 4),
        ],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 4, false)).click());

    const badges = all(".books-chapter-num").map((el) => el.textContent);
    expect(badges).toEqual(["1", "2", "3", "4"]);
    const titles = all(".books-chapter-title").map((el) => el.textContent);
    expect(titles).toEqual([
      strings.chapterName(1),
      "The sower",
      strings.chapterName(7),
      strings.chapterName(4),
    ]);
    // The row's spoken name is the same title, so the badge and the name
    // can differ for a template chapter: slot 3, "Chapter 7".
    const templated = button(strings.openChapter(strings.chapterName(7)));
    expect(only(".books-chapter-num", templated).textContent).toBe("3");
  });

  it("gives a chapter row a 44 badge, the play control's room, and a title line with its name, the default when it has none (#1219)", async () => {
    await mount([
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
        coverColourKey: null,
        chapters: [
          chapter(1, 1),
          chapter(1, 2, { name: "The sower", totalCount: 3 }),
        ],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 2, false)).click());

    // A chapter nobody has named still shows a title: the default name the
    // New Chapter prompt offered (#609), which is the name it goes by.
    const plain = button(strings.openChapter(strings.chapterName(1)));
    expect(only(".books-chapter-num", plain).textContent).toBe("1");
    expect(only(".books-chapter-num", plain).classList.contains("is-dim")).toBe(
      true
    );
    expect(only(".books-chapter-title", plain).textContent).toBe(
      strings.chapterName(1)
    );

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
    await mount([
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
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

  it("fits every chapter's dots in the narrowest supported column in a 26-chapter book, named or not", async () => {
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
    await mount([
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
        coverColourKey: null,
        chapters,
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 26, false)).click());

    const rows = all(".books-chapter");
    expect(rows).toHaveLength(26);
    // 320 − 2×8 − 2×(10 + 1) − (12 + 16) − 44 − 2×14 − 72 = 110px: the end
    // slot holds the play control and the row's ⋮ (#1730). Pinned so a change
    // anywhere in the chain is seen here, not only as a looser fit.
    const column = narrowestDotColumn();
    expect(column).toBe(110);
    const sizes = new Set<number>();
    for (const [i, row] of rows.entries()) {
      const { totalCount } = chapters[i]!;
      expect(only(".books-dots", row).children).toHaveLength(totalCount);
      const geometry = dotGeometry(row);
      sizes.add(geometry.size);
      // 19px under the 20px title line with its 5px gap (the design
      // reference, §3). Every row carries the title line since #1219, so a
      // chapter with no typed name gets no more room than a named one.
      const room = 19;
      expect(
        packed(totalCount, geometry, column).height,
        `chapter ${i + 1}: ${totalCount} dots at ${geometry.size}/${geometry.gap}`
      ).toBeLessThanOrEqual(room);
    }
    // The fit actually steps down, rather than one small size passing
    // everything.
    expect(sizes.has(13)).toBe(true);
    expect(sizes.size).toBeGreaterThanOrEqual(3);
  });

  it("takes the largest size that fits: 13/6, stepping down to 5/2", async () => {
    await mount([
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
        coverColourKey: null,
        chapters: [
          chapter(1, 1, { totalCount: 8 }),
          chapter(1, 2, { totalCount: 11 }),
          chapter(1, 3, { totalCount: 26 }),
          chapter(1, 4, { totalCount: 26, name: "Titled" }),
          chapter(1, 5, { totalCount: 41, name: "Many" }),
        ],
      },
    ]);
    await act(async () => button(strings.bookRow("Mark", 5, false)).click());
    const [eight, eleven, plain26, titled26, titled41] = all(".books-chapter");
    // Every row has the title line since #1219, so an unnamed chapter's dots
    // fit the same 19px a named one's do.
    // At the 110px column the row's ⋮ leaves (#1730).
    expect(dotGeometry(eight!)).toEqual({ size: 9, gap: 4 });
    expect(dotGeometry(eleven!)).toEqual({ size: 7, gap: 3 });
    expect(dotGeometry(plain26!)).toEqual({ size: 5, gap: 2 });
    expect(dotGeometry(titled26!)).toEqual({ size: 5, gap: 2 });
    expect(dotGeometry(titled41!)).toEqual({ size: 5, gap: 2 });
  });

  it("names every button, in reading order", async () => {
    const shelf: BookCard[] = [
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
        coverColourKey: "teal",
        chapters: [
          chapter(1, 1, { totalCount: 4, finishedCount: 1, recordedCount: 2 }),
          chapter(1, 2, { name: "The sower" }),
        ],
      },
      {
        bookId: bookId(2),
        name: "Ruth",
        number: 1,
        coverColourKey: null,
        chapters: [],
      },
    ];
    await mount(shelf);
    await act(async () => button(strings.bookRow("Mark", 2, false)).click());
    // Pinned whole, so a dropped, added or reordered button fails: the
    // header, then each book's toggle, + and ⋮, with an open book's chapter
    // rows under its own controls.
    expect(buttonNames()).toEqual([
      strings.newBook,
      strings.settingsOpen,
      strings.menuOpen,
      strings.bookRow("Mark", 2, true),
      strings.addChapter("Mark"),
      strings.bookMenuOpen("Mark"),
      strings.openChapter(strings.chapterName(1)),
      // The play control follows its own row, a sibling after the row button
      // (#1469); a chapter with nothing recorded names why it is inert.
      strings.playChapter(strings.chapterName(1)),
      // Then the row's ⋮ (#1730), named by the chapter's slot.
      strings.chapterRowMenu(1),
      strings.openChapter("The sower"),
      strings.chapterNothingToPlay("The sower"),
      strings.chapterRowMenu(2),
      strings.bookRow("Ruth", 0, false),
      strings.addChapter("Ruth"),
      strings.bookMenuOpen("Ruth"),
    ]);
  });
});

describe("O4 Books header and empty shelf, state 01 (#942)", () => {
  it("draws the header as 56px with a ghost menu button, and the empty shelf's outline", async () => {
    await mount([]);
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

  it("makes the header's New book #941's shared square button once the shelf has books", async () => {
    await mount([
      {
        bookId: bookId(1),
        name: "Mark",
        number: 1,
        coverColourKey: null,
        chapters: [],
      },
    ]);
    const add = button(strings.newBook);
    // The shared 56 × 56 r14 well from `o4-controls.tsx`, not a local copy.
    expect(add.classList.contains("o4-square")).toBe(true);
    expect(add.className).not.toMatch(/\bbooks-add\b/);
  });
});

describe("the guided ring lands on the intended control (#604, #834)", () => {
  async function guidedIn(books: BookCard[], expand?: string) {
    await mount(books);
    if (expand) await act(async () => button(expand).click());
    const marked = all("#root .is-guided");
    expect(marked, "one guided control").toHaveLength(1);
    return marked[0]!.getAttribute("aria-label");
  }

  const cases: [string, BookCard[], string, string?][] = [
    ["new-book: the empty shelf's CTA", [], strings.newBook],
    [
      "add-chapter: a new book's + (#834), with another book on the shelf",
      [
        {
          bookId: bookId(2),
          name: "Ruth",
          number: 1,
          coverColourKey: null,
          chapters: [],
        },
        {
          bookId: bookId(1),
          name: "Mark",
          number: 1,
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
          number: 1,
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
          number: 1,
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
      expect(await guidedIn(books, expand)).toBe(expected);
    });
  }
});

describe("o4/books.css (#942)", () => {
  // Read by selector, comments stripped (`areaScope`), so a header naming a
  // selector or a primitive can neither satisfy nor trip a check below
  // (AGENTS.md, the share-scrim trap).
  const layer = areaScope("books");
  const reduced = areaScope("books", "@media (prefers-reduced-motion: reduce)");
  const rules = scopeRules(layer);
  const sel = (selector: string) => areaSelector("books", selector);

  /** The value `selector`'s rule declares for `property`, primitives resolved. */
  const block = (selector: string, property: string) =>
    resolvePrimitives(
      declarationValue(areaRule(layer, selector), property).replace(/\s+/g, " ")
    );

  it("holds its rules inside the components layer", () => {
    expect(rules.length).toBeGreaterThanOrEqual(12);
  });

  it("reads colour only through layer-2 roles, and leaves the guide ring alone", () => {
    // Every declaration in both blocks of the file, one string each.
    const values = [
      ...scopeDeclarations(layer),
      ...scopeDeclarations(reduced),
    ].map(([property, value]) => `${property}: ${value}`);
    expect(values.length).toBeGreaterThanOrEqual(40);
    // Structural primitives (radius, type, space) are read directly, as
    // `3-components.css`'s header allows; any other `--p-*` is a colour
    // family, which only layer 2 may name. An allowlist, so a colour family
    // added to layer 1 later is caught without editing this test.
    const structural = /var\(--p-(radius|text|weight|space|font|dur|ease)-/;
    expect(values.some((d) => structural.test(d))).toBe(true);
    for (const decl of values) {
      expect(decl, decl).not.toMatch(
        /var\(--p-(?!(radius|text|weight|space|font|dur|ease)-)/
      );
      expect(decl, decl).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(decl, decl).not.toMatch(/rgba?\(|hsla?\(/);
    }
    // `.is-guided` is an inset box-shadow; an O4 rule on a guided control's
    // own selector that sets one would out-specify it and erase the ring.
    for (const selector of [
      sel(".books-card-hit"),
      sel(".books-chapter"),
      sel(".books-ghost"),
    ]) {
      expect(() => block(selector, "box-shadow"), selector).toThrow(
        "declarationValue: no box-shadow declaration"
      );
    }
  });

  it("carries the issue's geometry", () => {
    const geometry: [string, Record<string, string>][] = [
      [".books-header", { height: "56px" }],
      [".books-ghost", { width: "44px", height: "48px" }],
      [
        ".books-card",
        {
          "border-radius": "18px",
          padding: "10px",
          background: "var(--s-surface)",
          border: "1px solid var(--s-card-edge)",
        },
      ],
      [
        ".books-cover",
        {
          width: "72px",
          height: "90px",
          "border-radius": "9px",
          background: "var(--book-cover)",
        },
      ],
      [".books-cover::before", { width: "7px" }],
      [".books-chapter", { "min-height": "68px", "border-radius": "12px" }],
      [
        ".books-chapter-num",
        { width: "44px", height: "44px", background: "var(--s-well)" },
      ],
      [
        ".books-chapter-num.is-dim",
        { background: "transparent", color: "var(--s-ink-faint)" },
      ],
      // The column the fit is computed against.
      [".books-dots", { "max-width": "206px", gap: "var(--dot-gap)" }],
      [".books-dots > i", { width: "var(--dot)", height: "var(--dot)" }],
      [
        '.books-dots > [data-state="finished"]',
        { background: "var(--s-done)" },
      ],
      [
        '.books-dots > [data-state="recorded"]',
        { background: "var(--s-voice)" },
      ],
    ];
    for (const [selector, declared] of geometry) {
      for (const [property, value] of Object.entries(declared)) {
        expect(block(sel(selector), property), `${selector} ${property}`).toBe(
          value
        );
      }
    }
  });
});

describe("right-to-left names on the shelf (#1267)", () => {
  const HEBREW = "שלום.";
  const ARABIC = "مرقس.";
  const shelf = (): BookCard[] => [
    {
      bookId: bookId(1),
      name: HEBREW,
      number: 1,
      coverColourKey: null,
      chapters: [chapter(1, 1), chapter(1, 2, { name: ARABIC })],
    },
  ];

  it("the book's name and a typed chapter title carry dir=auto, the default chapter name does not", async () => {
    await mount(shelf());
    await act(async () => button(strings.bookRow(HEBREW, 2, false)).click());
    expect(only(".books-name").getAttribute("dir")).toBe("auto");
    const typed = button(strings.openChapter(ARABIC));
    expect(only(".books-chapter-title", typed).getAttribute("dir")).toBe(
      "auto"
    );
    // "Chapter 1" is a UI string: it follows the app locale.
    const plain = button(strings.openChapter(strings.chapterName(1)));
    expect(only(".books-chapter-title", plain).hasAttribute("dir")).toBe(false);
  });
});
