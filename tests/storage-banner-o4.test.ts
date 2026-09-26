// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { Notice } from "@/components/notice";
import { StoragePressureBanner } from "@/components/storage-pressure-banner";
import type { StoragePressureNotice } from "@/components/storage-pressure-notice";
import type { UseLibraryShare } from "@/hooks/use-library-share";
import type { Design } from "@/lib/design";
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
      nameBook: (bookName: string) => string,
      nameChapter: (bookName: string, chapterNumber: number) => string
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
const design = vi.hoisted(() => ({ current: "current" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));
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

const low: StoragePressureNotice = { tone: "info", text: strings.storageLow };
const critical: StoragePressureNotice = {
  tone: "alert",
  text: strings.storageCritical,
};

const banner = (notice: StoragePressureNotice, o4: boolean) =>
  render(
    createElement(StoragePressureBanner, { notice, o4, share: shareSurface() })
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
  design.current = "current";
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

describe("the current look is the #247 Notice, unchanged", () => {
  it.each([
    ["low", low],
    ["critical", critical],
  ])("%s renders exactly what <Notice> renders", (_band, notice) => {
    const expected = render(
      createElement(Notice, { tone: notice.tone, children: notice.text })
    );
    expect(banner(notice, false).innerHTML).toBe(expected.innerHTML);
  });

  it("carries no O4 markup and no share button", () => {
    const container = banner(critical, false);
    expect(container.querySelector(".o4-storage")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("state 17, O4", () => {
  it("draws the banner with the phone icon as decoration", () => {
    const container = banner(low, true);
    one(container, ".o4-storage");
    const icon = one(container, ".o4-storage-icon");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    // The workbench draws `I.phone(34)`.
    expect(icon.querySelector("svg")?.getAttribute("width")).toBe("34");
    expect(container.querySelector(".notice")).toBeNull();
  });

  it("leads with the workbench's line and keeps the #247 reason", () => {
    const container = banner(critical, true);
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
      const container = banner(notice, true);
      const words = one(container, ".o4-storage-words");
      expect(words.getAttribute("role")).toBe(role);
      expect(words.querySelector("button")).toBeNull();
      expect(one(container, ".o4-storage").getAttribute("data-tone")).toBe(
        notice.tone
      );
    }
  );

  it("offers Share your work, not Send log (#948 D14)", () => {
    const button = one(banner(low, true), "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareAll);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("says it is preparing, and stays focusable, while tap 1 runs", () => {
    share.status = "preparing";
    const container = banner(low, true);
    const button = one(container, "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareAllPreparing);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("becomes Share now once armed", () => {
    share.status = "ready";
    const button = one(banner(low, true), "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareSend);
  });

  it("names an unconfirmed last attempt", () => {
    share.sendUnconfirmed = true;
    const button = one(banner(low, true), "button.o4-storage-share");
    expect(button.getAttribute("aria-label")).toBe(strings.shareAllUnconfirmed);
  });

  it.each([
    ["nothing", strings.shareAllNothing],
    ["failed", strings.shareAllFailed],
    ["storage", strings.shareAllStorage],
    ["encoder", strings.shareEncoderStopped],
  ] as const)("words the %s refusal", (code, text) => {
    share.error = code;
    const container = banner(low, true);
    expect(one(container, ".o4-storage .notice").textContent).toBe(text);
  });

  it("says what a ready archive left out, in books and chapters", () => {
    share.status = "ready";
    share.missing = 2;
    share.incompleteChapters = 1;
    share.incompleteBooks = 1;
    const container = banner(low, true);
    expect(one(container, ".o4-storage .notice").textContent).toBe(
      `${strings.shareAllMissing(2)} ${strings.shareAllIncomplete(1)}`
    );
  });

  it("says nothing about a gap before the archive is ready", () => {
    share.missing = 2;
    expect(banner(low, true).querySelector(".notice")).toBeNull();
  });
});

describe("the button runs the library share", () => {
  it("tap 1 prepares every book, named from the string table", async () => {
    const container = await mount(
      createElement(StoragePressureBanner, {
        notice: low,
        o4: true,
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
    expect(nameBook("Mark/Luke")).toBe(strings.shareAllFolder("Mark/Luke"));
    expect(nameChapter("Mark", 3)).toBe(strings.shareFilename("Mark", 3));
    expect(share.send).not.toHaveBeenCalled();
  });

  it("tap 2 hands the armed archive to the share sheet", async () => {
    share.status = "ready";
    const container = await mount(
      createElement(StoragePressureBanner, {
        notice: low,
        o4: true,
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

describe("Books shows the banner where the #247 line was", () => {
  const recorded: BookCard = {
    bookId: "book-0000-4000-8000-000000000001" as BookId,
    name: "Mark",
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

  async function screen(look: Design) {
    design.current = look;
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

  it("O4 draws state 17", async () => {
    const container = await screen("o4");
    one(container, ".o4-storage");
    expect(one(container, ".o4-storage-why").textContent).toBe(
      strings.storageCritical
    );
  });

  it("the current look keeps its Notice and no share button", async () => {
    const container = await screen("current");
    expect(container.querySelector(".o4-storage")).toBeNull();
    const line = [...container.querySelectorAll(".notice")].find(
      (n) => n.textContent === strings.storageCritical
    );
    expect(line?.getAttribute("data-tone")).toBe("alert");
    expect(
      container.querySelector(`button[aria-label="${strings.shareAll}"]`)
    ).toBeNull();
  });
});

describe("o4/books.css, the banner rules", () => {
  const rules = areaRules("books").filter((r) =>
    r.selectors.some((s) => s.includes(".o4-storage"))
  );

  it("exist (a floor, so the checks below cannot loop over nothing)", () => {
    expect(rules.length).toBeGreaterThanOrEqual(4);
  });

  it("are all scoped to the O4 look", () => {
    for (const rule of rules)
      for (const selector of rule.selectors)
        expect(selector.startsWith('[data-design="o4"] ')).toBe(true);
  });

  it("paint the warn wash and warn ink, per state 17", () => {
    const decls = (sel: string) =>
      rules.find((r) => r.selectors.includes(`[data-design="o4"] ${sel}`))
        ?.decls;
    expect(decls(".o4-storage")?.get("background")).toBe("var(--s-warn-quiet)");
    expect(decls(".o4-storage-title")?.get("color")).toBe("var(--s-warn-text)");
    expect(decls(".o4-storage-icon")?.get("color")).toBe("var(--s-warn-text)");
    expect(decls(".o4-storage-share")?.get("background")).toBe(
      "var(--s-voice)"
    );
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
