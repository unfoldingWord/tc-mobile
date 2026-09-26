import { createElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  RecorderMenu,
  type RecorderMenuProps,
} from "@/components/recorder-menu";
import type { Design } from "@/lib/design";

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
 * `useDesign()` is mocked so each case picks its look. What this file does
 * NOT cover: the cascade (the crumbs' paint is `o4/menus.css`'s, asserted as
 * declarations in `tests/o4-menus-chapter-segment.test.ts`), and the
 * recorder screen passing its view's book and chapter in, which
 * `tests/recorder-menu-head-wiring.test.ts` renders through the real sheet.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));
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
  editReason: null,
  markReason: null,
  eraseReason: null,
  onEnterEdit: () => {},
  onToggleFinished: () => {},
  onErase: () => {},
  onExitEdit: () => {},
  bookName: "Ruth",
  chapterNumber: 2,
};

function show(over: Partial<RecorderMenuProps> = {}, look: Design = "o4") {
  design.current = look;
  return render(createElement(RecorderMenu, { ...base, ...over }));
}

const crumbs = (el: Element) =>
  [...el.querySelectorAll(".o4-sheet-head .o4-crumb")].map((c) => ({
    text: c.textContent,
    state: c.getAttribute("data-state"),
  }));

describe("the recorder menu's O4 sheet head (G3)", () => {
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

  it("adds nothing in the current look, and its markup ignores the head's props", () => {
    const withHead = show({}, "current");
    expect(withHead.querySelector(".o4-sheet-head")).toBeNull();
    const without = show(
      { bookName: undefined, chapterNumber: undefined },
      "current"
    );
    expect(withHead.innerHTML).toBe(without.innerHTML);
  });
});
