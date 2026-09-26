import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { CoverTile, O4BookHead, O4CoverPick } from "@/components/o4-book-menu";
import { COVER_COLOUR_KEYS } from "@/lib/cover-colour";
import { strings } from "@/lib/strings";
import { areaRules } from "./o4-area-css";
import { one, render } from "./render";

/**
 * The O4 book menu's own pieces (#949: 04 and #937 D7) as markup: props in,
 * attributes out, through the #197 render harness. What the sheet DOES
 * (opening the picker, the write, focus) is
 * `tests/books-menus-tiles-o4.test.ts`, which mounts the whole screen.
 *
 * The stylesheet half reads rules with comments stripped (`o4-area-css.ts`),
 * so a comment naming a selector cannot stand in for the rule.
 */

const O4 = '[data-design="o4"] ';

describe("O4BookHead (04's sheet head)", () => {
  it("draws the book's small cover and name as decoration, then its children", () => {
    const root = render(
      createElement(
        O4BookHead,
        { name: "Mark", coverHex: "#11796d" },
        createElement("button", { type: "button", "aria-label": "Pen" })
      )
    );
    const bar = one(root, ".o4-sheet-bar");
    const head = one(bar, ".o4-sheet-head.books-menu-head");
    // The dialog is named by `<Menu>`, and every action names what it does,
    // so the head is decoration, as `O4SheetHead` is on the other menus.
    expect(head.getAttribute("aria-hidden")).toBe("true");
    const cover = one(head, ".books-cover.is-sm");
    expect(cover.getAttribute("style")).toContain("--book-cover:#11796d");
    expect(one(head, ".books-sheet-name").textContent).toBe("Mark");
    // The child (the Rename pencil) follows the head, outside it, so it is
    // not hidden from AT with the decoration.
    const kids = [...bar.children];
    expect(kids).toHaveLength(2);
    expect(kids[1]!.getAttribute("aria-label")).toBe("Pen");
    expect(head.contains(kids[1]!)).toBe(false);
  });
});

describe("CoverTile (#937 D7)", () => {
  it("is one tile button whose spoken name contains its caption", () => {
    const root = render(
      createElement(CoverTile, { coverHex: "#2f6b3a", onClick: () => {} })
    );
    const tiles = root.querySelectorAll("button");
    expect(tiles).toHaveLength(1);
    const tile = tiles[0]!;
    expect(tile.classList).toContain("o4-tile");
    expect(tile.classList).toContain("o4-tile--cover");
    const caption = one(tile, ".control-caption").textContent!;
    expect(caption.length).toBeGreaterThan(0);
    expect(tile.getAttribute("aria-label")!.toLowerCase()).toContain(
      caption.toLowerCase()
    );
    expect(tile.getAttribute("aria-label")).toBe(strings.coverColourLabel);
  });

  it("carries the book's colour to its fill as the same custom property the covers use", () => {
    const root = render(
      createElement(CoverTile, { coverHex: "#2f6b3a", onClick: () => {} })
    );
    const holder = one(root, ".contents");
    expect(holder.getAttribute("style")).toContain("--book-cover:#2f6b3a");
    expect(holder.contains(one(root, "button"))).toBe(true);
  });
});

describe("O4CoverPick (#957's picker, mounted in the book sheet)", () => {
  function pick(error: string | null = null): Element {
    return render(
      createElement(O4CoverPick, {
        selected: "teal",
        onSelect: () => {},
        error,
      })
    );
  }

  it("sits in the tile grid, so the sheet keeps its bottom-sheet shell", () => {
    const root = pick();
    const grid = one(root, ".o4-tiles");
    const row = one(grid, ".books-cover-pick [role='group']");
    expect(row.getAttribute("aria-label")).toBe(strings.coverColourLabel);
  });

  it("offers every palette colour, with the book's own pressed", () => {
    const root = pick();
    const swatches = [...root.querySelectorAll(".cover-swatch")];
    expect(swatches).toHaveLength(COVER_COLOUR_KEYS.length);
    const pressed = swatches.filter(
      (s) => s.getAttribute("aria-pressed") === "true"
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.getAttribute("title")).toBe(strings.coverColourTeal);
    // Not disabled: a disabled swatch under the focus would drop it out of
    // the sheet's trap. The hook refuses a second write instead.
    expect(swatches.every((s) => !s.hasAttribute("disabled"))).toBe(true);
  });

  it("speaks a failed write in the sheet, and says nothing otherwise", () => {
    expect(pick().querySelector(".notice")).toBeNull();
    const failed = pick(strings.saveFailed);
    expect(failed.textContent).toContain(strings.saveFailed);
  });
});

describe("the book menu's rules", () => {
  const books = areaRules("books");
  const menus = areaRules("menus");

  it("fills the cover tile from the book's own colour (books.css, where the cover exception lives)", () => {
    expect(books.length).toBeGreaterThanOrEqual(12);
    const fill = books.filter((r) =>
      r.selectors.includes(`${O4}.o4-tile--cover::before`)
    );
    expect(fill).toHaveLength(1);
    expect(fill[0]!.decls.get("background")).toBe("var(--book-cover)");
  });

  it("draws the picker's swatches as the workbench's: 12 apart, radius 9, the selected one ringed in ink", () => {
    const get = (sel: string) => {
      const hits = books.filter((r) => r.selectors.includes(`${O4}${sel}`));
      expect(hits, sel).toHaveLength(1);
      return hits[0]!.decls;
    };
    expect(get(".books-cover-pick .cover-swatch-row").get("gap")).toBe("12px");
    expect(get(".books-cover-pick .cover-swatch").get("border-radius")).toBe(
      "9px"
    );
    expect(
      get('.books-cover-pick .cover-swatch[aria-pressed="true"]').get(
        "box-shadow"
      )
    ).toBe("0 0 0 3px var(--s-surface), 0 0 0 6px var(--s-ink)");
  });

  it("keeps the sheet shell while the book sheet asks before deleting (G6)", () => {
    expect(menus.length).toBeGreaterThanOrEqual(8);
    const panel = menus.filter((r) =>
      r.selectors.includes(`${O4}.menu-panel:has(.books-delete-ask)`)
    );
    expect(panel).toHaveLength(1);
    expect(panel[0]!.decls.get("border-radius")).toBe("26px");
    const scrim = menus.filter((r) =>
      r.selectors.includes(`${O4}.menu-scrim:has(.books-delete-ask)`)
    );
    expect(scrim).toHaveLength(1);
    expect(scrim[0]!.decls.get("align-items")).toBe("flex-end");
    const handle = menus.filter((r) =>
      r.selectors.includes(`${O4}.menu-panel:has(.books-delete-ask)::before`)
    );
    expect(handle).toHaveLength(1);
    expect(handle[0]!.decls.get("width")).toBe("56px");
  });
});
