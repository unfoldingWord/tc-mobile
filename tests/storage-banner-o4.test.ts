// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { StoragePressureBanner } from "@/components/storage-pressure-banner";
import type { StoragePressureNotice } from "@/components/storage-pressure-notice";
import type { UseLibraryShare } from "@/hooks/use-library-share";
import type { BookLabel } from "@/lib/export/book";
import type { Layer } from "@/lib/nav/layer-stack";
import type { StoragePressureMarker } from "@/lib/storage/pressure";
import { strings } from "@/lib/strings";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

import { areaRules } from "./o4-area-css";
import { one, render } from "./render";

/**
 * State 17 of the O4 workbench, the storage warning on Books (#983, from
 * #948), and its "Share your work" button (#948's D14, the action #987/#992
 * built).
 *
 * Props-to-markup through `tests/render.ts` for the banner itself, and a real
 * jsdom mount (the `tests/books-o4.test.ts` pattern) where a CLICK or the
 * screen's own wiring is what is under test. No cascade and no layout: that
 * the rules in `o4/books.css` paint what the workbench shows is not something
 * this file can answer — the CSS cases below only read which roles the rules
 * name.
 *
 * `useLibraryShare` is mocked: its own behaviour is `tests/use-library-share
 * .test.ts`'s. What this file pins is that the banner hands it the right
 * arguments and says what each of its states means.
 */

const share = vi.hoisted(() => ({
  status: "idle" as "idle" | "preparing" | "ready",
  error: null as null | "nothing" | "encoder" | "failed" | "storage",
  sendUnconfirmed: false,
  missing: 0,
  incompleteChapters: 0,
  incompleteBooks: 0,
  prepare: vi.fn<
    (
      zipFilename: string,
      nameBook: (book: BookLabel) => string,
      nameChapter: (
        book: BookLabel,
        chapterNumber: number,
        chapterName: string | null
      ) => string
    ) => Promise<null>
  >(() => Promise.resolve(null)),
  send: vi.fn(() => Promise.resolve("sent" as const)),
}));
/** The hook's surface as the banner reads it, from the fields above. */
const shareSurface = (): UseLibraryShare => ({
  status: share.status,
  error: share.error,
  sendUnconfirmed: share.sendUnconfirmed,
  missing: share.missing,
  incompleteChapters: share.incompleteChapters,
  incompleteBooks: share.incompleteBooks,
  progress: { phase: "hidden" },
  prepare: share.prepare,
  send: share.send,
  reset: vi.fn(),
  ownsScreen: () => false,
  dismissProgress: vi.fn(),
});
vi.mock("@/hooks/use-library-share", () => ({
  useLibraryShare: () => shareSurface(),
}));

// The screen-level cases below mount `BooksScreen`, so its data hooks are
// mocked the way `tests/books-o4.test.ts` mocks them.
const pressure = vi.hoisted(() => ({
  current: null as StoragePressureMarker | null,
}));
vi.mock("@/hooks/use-storage-pressure", () => ({
  useStoragePressure: () => pressure.current,
}));
const shelf = vi.hoisted(() => ({ books: [] as BookCard[] }));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf.books,
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

const low: StoragePressureNotice = { tone: "info", text: strings.storageLow };
const critical: StoragePressureNotice = {
  tone: "alert",
  text: strings.storageCritical,
};

const banner = (notice: StoragePressureNotice) =>
  render(
    createElement(StoragePressureBanner, { notice, share: shareSurface() })
  );

let root: Root | null = null;
beforeEach(() => {
  share.status = "idle";
  share.error = null;
  share.sendUnconfirmed = false;
  share.missing = 0;
  share.incompleteChapters = 0;
  share.incompleteBooks = 0;
  share.prepare.mockClear();
  share.send.mockClear();
  pressure.current = null;
  shelf.books = [];
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  vi.unstubAllGlobals();
});

async function mount(element: ReturnType<typeof createElement>) {
  root = createRoot(document.getElementById("root")!);
  const r = root;
  await act(async () => r.render(element));
  return document.getElementById("root")!;
}

describe("state 17", () => {
  it("draws the banner with the phone icon as decoration", () => {
    const container = banner(low);
    one(container, ".o4-storage");
    const icon = one(container, ".o4-storage-icon");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    // The workbench draws `I.phone(34)`.
    expect(icon.querySelector("svg")?.getAttribute("width")).toBe("34");
    expect(container.querySelector(".notice")).toBeNull();
  });

  it("leads with the workbench's line and keeps the #247 reason", () => {
    const container = banner(critical);
    expect(one(container, ".o4-storage-title").textContent).toBe(
      strings.storageShareSoon
    );
    expect(one(container, ".o4-storage-why").textContent).toBe(
      strings.storageCritical
    );
  });

  it.each([
    ["low", low, "status"],
    ["critical", critical, "alert"],
  ])(
    "%s keeps the Notice's urgency on its words, not on the button",
    (_band, notice, role) => {
      const container = banner(notice);
      const words = one(container, ".o4-storage-words");
      expect(words.getAttribute("role")).toBe(role);
      expect(words.querySelector("button")).toBeNull();
      expect(one(container, ".o4-storage").getAttribute("data-tone")).toBe(
        notice.tone
      );
    }
  );

  it("offers Share your work, not Send log (#948 D14)", () => {
    const button = one(banner(low), "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareAll);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("says it is preparing, and stays focusable, while tap 1 runs", () => {
    share.status = "preparing";
    const container = banner(low);
    const button = one(container, "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareAllPreparing);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("becomes Share now once armed", () => {
    share.status = "ready";
    const button = one(banner(low), "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareSend);
  });

  it("names an unconfirmed last attempt", () => {
    share.sendUnconfirmed = true;
    const button = one(banner(low), "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareAllUnconfirmed);
  });

  it.each([
    ["nothing", strings.shareAllNothing],
    // Plain Node reads as the web build (#1333).
    ["failed", strings.shareAllFailedWeb],
    ["storage", strings.shareAllStorage],
    ["encoder", strings.shareEncoderStopped],
  ] as const)("words the %s refusal", (code, text) => {
    share.error = code;
    const container = banner(low);
    expect(one(container, ".o4-storage .notice").textContent).toBe(text);
  });

  it("says what a ready archive left out, in books and chapters", () => {
    share.status = "ready";
    share.missing = 2;
    share.incompleteChapters = 1;
    share.incompleteBooks = 1;
    const container = banner(low);
    expect(one(container, ".o4-storage .notice").textContent).toBe(
      `${strings.shareAllMissing(2)} ${strings.shareAllIncomplete(1)}`
    );
  });

  it("says nothing about a gap before the archive is ready", () => {
    share.missing = 2;
    expect(banner(low).querySelector(".notice")).toBeNull();
  });
});

describe("the button runs the library share", () => {
  it("tap 1 prepares every book, named from the string table", async () => {
    const container = await mount(
      createElement(StoragePressureBanner, {
        notice: low,
        share: shareSurface(),
      })
    );
    const button = container.querySelector<HTMLButtonElement>(
      "button.o4-storage-share"
    )!;
    await act(async () => button.click());
    expect(share.prepare).toHaveBeenCalledTimes(1);
    const [zip, nameBook, nameChapter] = share.prepare.mock.calls[0]!;
    expect(zip).toBe(strings.shareAllFilename);
    const mark = { name: "Mark", number: 1 };
    expect(nameBook({ name: "Mark/Luke", number: 1 })).toBe(
      strings.shareAllFolder("Mark/Luke")
    );
    expect(nameChapter(mark, 3, null)).toBe(strings.shareFilename("Mark", 3));
    // The chapter's own name reaches the MP3, as in Share Book (#1218).
    expect(nameChapter(mark, 3, "The sower")).toBe("Mark - The sower.mp3");
    // An unnamed book is labelled by the placeholder its slot renders, the
    // same words its shelf row shows (#169) — never an empty folder name.
    const unnamed = { name: null, number: 4 };
    expect(nameBook(unnamed)).toBe(
      strings.shareAllFolder(strings.bookHeading(null, 4))
    );
    expect(nameChapter(unnamed, 2, null)).toBe(
      strings.shareFilename(strings.bookHeading(null, 4), 2)
    );
    expect(share.send).not.toHaveBeenCalled();
  });

  it("tap 2 hands the armed archive to the share sheet", async () => {
    share.status = "ready";
    const container = await mount(
      createElement(StoragePressureBanner, {
        notice: low,
        share: shareSurface(),
      })
    );
    const button = container.querySelector<HTMLButtonElement>(
      "button.o4-storage-share"
    )!;
    await act(async () => button.click());
    expect(share.send).toHaveBeenCalledTimes(1);
    expect(share.prepare).not.toHaveBeenCalled();
  });
});

describe("tap 1 -> tap 2 hands focus to the armed Send (#1046 item 2)", () => {
  it("focuses the Send control once preparing becomes ready", async () => {
    // Both branches render a `<Control>` at the same tree position with no
    // `key`, so React updates the existing button in place rather than
    // unmounting and remounting it. The DOM's native `autoFocus` (which is
    // all `<Control autoFocus>` sets, `control.tsx`) is only ever applied by
    // the renderer on a fresh insertion — an update never re-triggers it.
    // Without a fix this stays on the "preparing" button (or nothing, if
    // nothing was ever mounted focused), never the "ready" one.
    share.status = "idle";
    await mount(
      createElement(StoragePressureBanner, {
        notice: low,
        share: shareSurface(),
      })
    );
    share.status = "ready";
    await act(async () =>
      root!.render(
        createElement(StoragePressureBanner, {
          notice: low,
          share: shareSurface(),
        })
      )
    );
    const button = document.querySelector<HTMLButtonElement>(
      "button.o4-storage-share"
    )!;
    expect(document.activeElement).toBe(button);
  });
});

describe("Books shows the banner where the #247 line was", () => {
  const recorded: BookCard = {
    bookId: "book-0000-4000-8000-000000000001" as BookId,
    name: "Mark",
    number: 1,
    chapters: [
      {
        chapterId: "chapter-1-4000-8000-000000000001" as ChapterId,
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 1,
        recordedCount: 1,
      },
    ],
  };

  async function screen() {
    pressure.current = "critical";
    shelf.books = [recorded];
    const layers = new Map<string, Layer>();
    return mount(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    );
  }

  it("draws state 17", async () => {
    const container = await screen();
    one(container, ".o4-storage");
    expect(one(container, ".o4-storage-why").textContent).toBe(
      strings.storageCritical
    );
  });
});

describe("o4/books.css, the banner rules", () => {
  const rules = areaRules("books").filter((r) =>
    r.selectors.some((s) => s.includes(".o4-storage"))
  );

  it("exist (a floor, so the checks below cannot loop over nothing)", () => {
    expect(rules.length).toBeGreaterThanOrEqual(4);
  });

  it("all carry the :root prefix that holds their specificity (o4/index.css)", () => {
    for (const rule of rules)
      for (const selector of rule.selectors)
        expect(selector.startsWith(":root ")).toBe(true);
  });

  it("paint the warn wash and warn ink, per state 17", () => {
    const decls = (sel: string) =>
      rules.find((r) => r.selectors.includes(`:root ${sel}`))?.decls;
    expect(decls(".o4-storage")?.get("background")).toBe("var(--s-warn-quiet)");
    expect(decls(".o4-storage-title")?.get("color")).toBe("var(--s-warn-text)");
    expect(decls(".o4-storage-icon")?.get("color")).toBe("var(--s-warn-text)");
    expect(decls(".o4-storage-share")?.get("background")).toBe(
      "var(--s-voice)"
    );
  });

  // #1046 item 1: George on #1037 found this describe block checked a rule
  // count, O4 scoping and colour, but nothing required `.o4-storage-why`,
  // `.o4-storage-row` or `.o4-storage-words` to exist, and nothing pinned the
  // 72/84/19/15 px sizes the PR claims (icon box, share button, title and
  // why-line type). Both gaps are closed here, the same slice-the-rule-block
  // way the rest of this describe already reads the stylesheet.
  it("names .o4-storage-row, .o4-storage-why and .o4-storage-words", () => {
    const selectors = rules.flatMap((r) => r.selectors);
    for (const cls of [
      ".o4-storage-row",
      ".o4-storage-why",
      ".o4-storage-words",
    ])
      expect(selectors).toContain(`:root ${cls}`);
  });

  it("pins the workbench's 72/84/19/15 px sizes (state 17)", () => {
    const decls = (sel: string) =>
      rules.find((r) => r.selectors.includes(`:root ${sel}`))?.decls;
    expect(decls(".o4-storage-icon")?.get("width")).toBe("72px");
    expect(decls(".o4-storage-icon")?.get("height")).toBe("72px");
    expect(decls(".o4-storage-share")?.get("width")).toBe("84px");
    expect(decls(".o4-storage-share")?.get("height")).toBe("84px");
    // The title and why-line sizes are structural primitives, not literal
    // px (AGENTS.md: "component and app-level rules read [structural
    // primitives] directly"), so the rule cited here is the token name; a
    // sibling suite, `tests/o4-primitives.test.ts`, pins `--p-text-19` and
    // `--p-text-15` themselves to 19px/15px.
    expect(decls(".o4-storage-title")?.get("font-size")).toBe(
      "var(--p-text-19)"
    );
    expect(decls(".o4-storage-why")?.get("font-size")).toBe("var(--p-text-15)");
  });

  it("take colour only from layer-2 roles", () => {
    const colourProps =
      /^(color|background|background-color|border|border-color)$/;
    let seen = 0;
    for (const rule of rules)
      for (const [prop, value] of rule.decls) {
        if (!colourProps.test(prop)) continue;
        seen += 1;
        expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|--p-/i);
        expect(value).toMatch(/var\(--s-[a-z-]+\)/);
      }
    expect(seen).toBeGreaterThanOrEqual(4);
  });
});
