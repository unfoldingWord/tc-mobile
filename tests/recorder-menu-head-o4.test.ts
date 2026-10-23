import { createElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  RecorderMenu,
  type RecorderMenuProps,
} from "@/components/recorder-menu";

import { render } from "./render";

/**
 * The recorder menu's O4 sheet head (#949 G3; workbench G3's `shead`, design
 * reference §7): the book, chapter and segment crumbs above the tiles, as on
 * the chapter and segment menus. The tiles themselves are
 * `tests/recorder-menu-o4.test.ts`'s; this file asks only about the head.
 *
 * Rendered through `tests/render.ts`. `Menu` portals to `<body>`, which the
 * static renderer refuses, so `createPortal` is replaced here by one that
 * renders its children in place, and the Node environment gets a stand-in
 * `document` for the portal's target argument, which that replacement never
 * reads. Nothing else about `Menu` changes, and no assertion below is about
 * where the panel mounts.
 *
 * What this file does NOT cover: the cascade (the crumbs' paint is `o4/menus.css`'s, asserted as
 * declarations in `tests/o4-menus-chapter-segment.test.ts`), and the
 * recorder screen passing its view's book and chapter in, which
 * `tests/recorder-menu-head-wiring.test.ts` renders through the real sheet.
 */

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode) => children,
}));

beforeAll(() => vi.stubGlobal("document", { body: null }));
afterAll(() => vi.unstubAllGlobals());

const base: RecorderMenuProps = {
  open: true,
  onClose: () => {},
  mode: "record",
  ordinal: 3,
  finishedState: "empty",
  markReason: null,
  eraseReason: null,
  onToggleFinished: () => {},
  onErase: () => {},
  bookName: "Ruth",
  bookCoverHex: "#7a3570",
  chapterNumber: 2,
};

function show(over: Partial<RecorderMenuProps> = {}) {
  return render(createElement(RecorderMenu, { ...base, ...over }));
}

const crumbs = (el: Element) =>
  [...el.querySelectorAll(".o4-sheet-head .o4-crumb")].map((c) => ({
    text: c.textContent,
    state: c.getAttribute("data-state"),
  }));

describe("the recorder menu's sheet head (G3)", () => {
  it.each(["record", "edit"] as const)(
    "heads the %s-mode sheet with the book, chapter and segment crumbs, decoration only",
    (mode) => {
      const el = show({ mode });
      const heads = el.querySelectorAll(".o4-sheet-head");
      expect(heads).toHaveLength(1);
      expect(heads[0]!.getAttribute("aria-hidden")).toBe("true");
      expect(heads[0]!.querySelector("button")).toBeNull();
      // Above the tiles, inside the one dialog.
      const panel = el.querySelector('[role="dialog"]');
      expect(panel?.contains(heads[0]!)).toBe(true);
      expect(
        heads[0]!.compareDocumentPosition(el.querySelector(".o4-tiles")!) &
          4 /* DOCUMENT_POSITION_FOLLOWING */
      ).toBeTruthy();
      expect(crumbs(el)).toEqual([
        { text: "Ruth", state: null },
        { text: "2", state: null },
        { text: "3", state: "recorded" },
      ]);
    }
  );

  it.each([
    ["finished", "finished"],
    ["empty", "recorded"],
    ["disabled", "empty"],
  ] as const)(
    "tints the segment crumb from the state the menu already reads (%s -> %s)",
    (finishedState, state) => {
      expect(crumbs(show({ finishedState })).at(-1)).toEqual({
        text: "3",
        state,
      });
    }
  );

  it("drops the segment crumb, and never paints a mark, before the segment has loaded", () => {
    const el = show({ ordinal: null, finishedState: "finished" });
    expect(crumbs(el)).toEqual([
      { text: "Ruth", state: null },
      { text: "2", state: null },
    ]);
    expect(el.querySelector('.o4-crumb[data-state="finished"]')).toBeNull();
  });

  it("leaves the book and chapter crumbs out when the caller has neither", () => {
    const el = show({ bookName: undefined, chapterNumber: undefined });
    expect(crumbs(el)).toEqual([{ text: "3", state: "recorded" }]);
  });

  it("draws the book's cover-colour square before the crumbs (#949, #957)", () => {
    const el = show({});
    const head = el.querySelector(".o4-sheet-head")!;
    const cover = head.querySelector(".books-cover.is-sm") as HTMLElement;
    expect(cover).not.toBeNull();
    expect(cover.style.getPropertyValue("--book-cover")).toBe("#7a3570");
    expect(
      cover.compareDocumentPosition(head.querySelector(".o4-crumbs")!) &
        4 /* DOCUMENT_POSITION_FOLLOWING */
    ).toBeTruthy();
  });

  it("leaves the square out when the caller has no colour to give", () => {
    const el = show({ bookCoverHex: undefined });
    expect(
      el.querySelector(".o4-sheet-head")!.querySelector(".books-cover")
    ).toBeNull();
    // The book and chapter crumbs are unaffected.
    expect(crumbs(el).slice(0, 2)).toEqual([
      { text: "Ruth", state: null },
      { text: "2", state: null },
    ]);
  });

  it("leaves the square out when there is no book crumb either, even with a colour to give", () => {
    const el = show({ bookName: undefined, chapterNumber: undefined });
    expect(el.querySelector(".books-cover")).toBeNull();
  });
});

describe("the recorder menu shows the full chapter name at its top (#1284, U3)", () => {
  const NAME60 = "abcdefghij".repeat(6);

  it("draws a 60-letter name whole as the wrapping heading, and no heading without the prop", () => {
    const el = show({ chapterName: NAME60, chapterHeading: "Chapter 2" });
    const heading = el.querySelector(".o4-sheet-name");
    expect(heading?.textContent).toBe(NAME60);
    expect(heading?.textContent).toHaveLength(60);
    expect(show().querySelector(".o4-sheet-name")).toBeNull();
  });

  it("with the number-only setting on, the name is still exposed to a screen reader", () => {
    const el = show({ chapterName: NAME60, chapterHeading: "Chapter 2" });
    const heading = el.querySelector(".o4-sheet-name")!;
    expect(heading.getAttribute("aria-hidden")).toBeNull();
    expect(el.querySelector(".o4-sheet-place")?.textContent).toContain(
      "Chapter 2"
    );
  });

  it("with the setting off, the place line carries the name and the heading is hidden", () => {
    const el = show({ chapterName: NAME60, chapterHeading: NAME60 });
    expect(el.querySelector(".o4-sheet-place")?.textContent).toContain(NAME60);
    expect(
      el.querySelector(".o4-sheet-name")?.getAttribute("aria-hidden")
    ).toBe("true");
  });

  it("an unnamed chapter's heading is the default name", () => {
    const el = show({ chapterName: null, chapterHeading: "Chapter 2" });
    expect(el.querySelector(".o4-sheet-name")?.textContent).toBe("Chapter 2");
  });
});
