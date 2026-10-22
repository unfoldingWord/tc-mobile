// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { O4BookHead } from "@/components/o4-book-menu";
import { O4SheetHead } from "@/components/o4-crumbs";
import { SegmentsScreen } from "@/components/segments-screen";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { strings } from "@/lib/strings";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { render } from "./render";
import { cssRule, declarationValue, restingErase } from "./support";

/**
 * The row menus show the full name at their top (#1284, the requirements
 * owner's U3: "When tapping the kebab to open the menu, show the full chapter
 * name at the top of that menu"). The chapter menu is the real
 * `SegmentsScreen` opened through its kebab, with `useChapterSegments`
 * replaced at its boundary. The book and segment menus share the pattern, so
 * their heads and rules are read directly.
 *
 * What this cannot see: the cascade and the wrapping at 360 px (jsdom has no
 * layout). `e2e/menu-full-name.spec.ts` runs that in Chromium.
 */

const mocks = vi.hoisted(() => ({ chapter: vi.fn() }));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: mocks.chapter,
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    ownsScreen: () => false,
    reset: () => {},
  }),
}));

const LONG =
  "The long account of the sower, the seed and the four kinds of soil";

function makeRow(i: number): Row {
  return {
    segmentId: `s${i}` as SegmentId,
    ordinal: i + 1,
    label: null,
    hasClip: true,
    finished: false,
    clipId: `c${i}` as ClipId,
    peaks: null,
    durationMs: 1000,
  };
}

let root: Root;
const erase = restingErase();
const audio = {
  error: null,
  playingId: null,
  playingBuffer: false,
  playbackElapsedMs: 0,
  playbackRanOut: false,
  playTake: vi.fn(),
  leave: vi.fn(),
  stopBuffer: vi.fn(),
} as unknown as UseAudioSession;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const rows = [makeRow(0)];
  mocks.chapter.mockImplementation(() => ({
    bookName: "Book",
    chapterNumber: 1,
    chapterName: LONG,
    rows,
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(),
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    moveSegment: vi.fn(),
  }));
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase,
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

const ROOT = path.resolve(import.meta.dirname, "..");
const css = (file: string) =>
  readFileSync(path.join(ROOT, "src", "app", "styles", "o4", file), "utf8");

describe("the chapter menu shows the full chapter name at its top (#1284, U3)", () => {
  it("draws the whole typed name as a heading once the kebab opens the menu, and not before", async () => {
    await mount();
    expect(document.querySelector(".o4-sheet-name")).toBeNull();
    const kebab = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === strings.chapterMenuOpen
    )!;
    await act(async () => kebab.click());
    const heading = document.querySelector(".o4-sheet-name")!;
    expect(heading.textContent).toBe(LONG);
    // The menu keeps its own name, and the spoken place line still carries
    // the chapter's name once, so the heading is decoration for a reader.
    const dialog = document.querySelector('[role="dialog"]')!;
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const name =
      dialog.getAttribute("aria-label") ??
      document.getElementById(labelledBy ?? "")?.textContent;
    expect(name).toBe(strings.chapterMenuTitle);
    expect(document.querySelector(".o4-sheet-place")?.textContent).toContain(
      LONG
    );
    expect(heading.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the same pattern on the book and segment menus", () => {
  it("draws the heading only when asked, and keeps the screen-reader line either way", () => {
    const off = render(
      createElement(O4SheetHead, { book: "Book", chapter: LONG })
    );
    expect(off.querySelector(".o4-sheet-name")).toBeNull();
    const on = render(
      createElement(O4SheetHead, {
        book: "Book",
        chapter: LONG,
        fullName: true,
      })
    );
    expect(on.querySelector(".o4-sheet-name")?.textContent).toBe(LONG);
    expect(on.querySelector(".o4-sheet-place")?.textContent).toContain(LONG);
  });

  it("puts the whole book name in the book menu head", () => {
    const head = render(
      createElement(O4BookHead, { name: LONG, coverHex: "#336699" })
    );
    expect(head.querySelector(".books-sheet-name")?.textContent).toBe(LONG);
  });

  it("declares no nowrap, ellipsis or clip on the three name lines, and wraps them", () => {
    for (const [file, selector] of [
      ["menus.css", ".o4-sheet-name"],
      ["menus.css", ".o4-menu-title"],
      ["books.css", ".books-sheet-name"],
    ] as const) {
      const rule = cssRule(css(file), `:root ${selector}`);
      expect(rule, selector).not.toMatch(/white-space\s*:\s*nowrap/);
      expect(rule, selector).not.toMatch(/text-overflow/);
      expect(rule, selector).not.toMatch(/overflow\s*:\s*hidden/);
      expect(declarationValue(rule, "overflow-wrap"), selector).toBe(
        "anywhere"
      );
    }
  });
});
