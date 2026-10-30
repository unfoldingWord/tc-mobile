import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Tile, TileGrid, TileSpacer } from "@/components/o4-tile-menu";

import {
  areaScope,
  areaSelector,
  declsFor,
  readAreaCss,
  scopeDeclarations,
  scopeRules,
} from "./o4-area-css";
import { one, render } from "./render";

/**
 * #941: the O4 tile-menu primitive — a grid of 76 × 76 coloured tiles with a
 * caption below, and the bottom-sheet shell a `<Menu>` takes on while it
 * holds that grid.
 *
 * Markup half through `tests/render.ts`; rule half from `3-components/menus.css` read
 * as rules. No cascade here: whether the sheet shell actually wins over
 * `.menu-panel` in a browser is not answered by this file.
 */
describe("Tile (#941)", () => {
  it("is one Control button: the label is the name, the caption is visible and hidden from AT", () => {
    const el = one(
      render(
        createElement(Tile, {
          tone: "send",
          icon: "share",
          label: "Share the book",
          caption: "Share",
        })
      ),
      "button"
    );
    expect(el.classList.contains("control")).toBe(true);
    expect(el.classList.contains("o4-tile")).toBe(true);
    expect(el.classList.contains("o4-tile--send")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Share the book");
    const caption = one(el, ".control-caption");
    expect(caption.textContent).toBe("Share");
    expect(caption.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    "edit",
    "name",
    "send",
    "erase",
    "plain",
    "done",
    "doneoff",
  ] as const)("tone %s lands as its own class", (tone) => {
    const el = one(
      render(
        createElement(Tile, { tone, icon: "edit", label: "x", caption: "x" })
      ),
      "button"
    );
    expect(el.classList.contains(`o4-tile--${tone}`)).toBe(true);
  });

  it("keeps Control's toggle and inert semantics", () => {
    const pressed = one(
      render(
        createElement(Tile, {
          tone: "plain",
          icon: "check",
          label: "Mark done",
          caption: "Done",
          pressed: false,
        })
      ),
      "button"
    );
    expect(pressed.getAttribute("aria-pressed")).toBe("false");
    const hinted = one(
      render(
        createElement(Tile, {
          tone: "erase",
          icon: "trash",
          label: "Erase",
          caption: "Erase",
          disabled: true,
          hint: { label: "Recording" },
        })
      ),
      "button"
    );
    expect(hinted.hasAttribute("disabled")).toBe(false);
    expect(hinted.getAttribute("aria-disabled")).toBe("true");
    expect(hinted.getAttribute("aria-label")).toBe("Erase. Recording");
  });
});

describe("TileGrid and TileSpacer (#941)", () => {
  it("holds its tiles in one grid, the spacer decorative", () => {
    const root = render(
      createElement(
        TileGrid,
        null,
        createElement(Tile, {
          tone: "plain",
          icon: "share",
          label: "Export",
          caption: "Export",
        }),
        createElement(TileSpacer),
        createElement(Tile, {
          tone: "plain",
          icon: "sun",
          label: "Use the light screen",
          caption: "Light",
        })
      )
    );
    const grid = one(root, ".o4-tiles");
    expect(grid.querySelectorAll("button.o4-tile").length).toBe(2);
    expect(one(grid, ".o4-tiles-gap").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("3-components/menus.css (#941)", () => {
  const menus = areaScope("menus");
  const sel = (selector: string) => areaSelector("menus", selector);

  it("has rules to check (a floor, so an emptied file cannot pass vacuously)", () => {
    expect(scopeRules(menus).length).toBeGreaterThanOrEqual(8);
  });

  it("lets a tile caption wrap inside its tile's width plus the gap (#1665)", () => {
    const caption = declsFor(menus, sel(".o4-tile > .control-caption"));
    expect(caption.get("white-space")).toBe("normal");
    expect(caption.get("max-width")).toBe("calc(100% + 10px)");
    expect(caption.get("overflow-wrap")).toBe("break-word");
    // The compact grid's gap is 6px, so its caption bound follows it.
    const compact = declsFor(
      menus,
      sel(".o4-tiles--compact .o4-tile > .control-caption")
    );
    expect(compact.get("max-width")).toBe("calc(100% + 6px)");
    // The tile's one column must not size to the caption's width.
    expect(declsFor(menus, sel(".o4-tile")).get("grid-template-columns")).toBe(
      "minmax(0, 1fr)"
    );
  });

  it("paints colour only through layer-2 roles", () => {
    // The whole file, nested blocks included, not only the layer's rules.
    const colours = scopeDeclarations(readAreaCss("menus")).filter(([prop]) =>
      /color|background|shadow/.test(prop)
    );
    expect(colours.length).toBeGreaterThanOrEqual(8);
    for (const [prop, value] of colours) {
      expect(value, prop).not.toMatch(/--p-/);
      // `transparent` clears the base control's raised fill so the tile's
      // box, not its whole button, carries the colour; it names no colour.
      if (value !== "transparent") expect(value, prop).toMatch(/var\(--s-/);
    }
  });

  it("draws the tile box 76 × 76, radius 20, with the caption 8 below at 14px", () => {
    const box = declsFor(menus, sel(".o4-tile::before"));
    expect(box.get("width")).toBe("76px");
    expect(box.get("height")).toBe("76px");
    expect(box.get("border-radius")).toBe("20px");
    const tile = declsFor(menus, sel(".o4-tile"));
    expect(tile.get("width")).toBe("76px");
    expect(tile.get("row-gap")).toBe("8px");
    const caption = declsFor(menus, sel(".o4-tile > .control-caption"));
    expect(caption.get("font-size")).toBe("14px");
  });

  it("fills each tone from its role, with tile ink on the coloured ones", () => {
    for (const [tone, role] of [
      ["edit", "--s-edit"],
      ["name", "--s-name"],
      ["send", "--s-send"],
    ] as const) {
      expect(
        declsFor(menus, sel(`.o4-tile--${tone}::before`)).get("background"),
        tone
      ).toBe(`var(${role})`);
    }
    expect(declsFor(menus, sel(".o4-tile")).get("color")).toBe(
      "var(--s-tile-ink)"
    );
    expect(
      declsFor(menus, sel(".o4-tile--erase::before")).get("background")
    ).toBe("var(--s-live-quiet)");
    expect(
      declsFor(menus, sel(".o4-tile--plain::before")).get("background")
    ).toBe("var(--s-well)");
  });

  it("gives a menu holding the grid the bottom-sheet shell: radius 26 and a 56 × 5 handle", () => {
    const panel = declsFor(menus, sel(".menu-panel:has(.o4-tiles)"));
    expect(panel.get("border-radius")).toBe("26px");
    // The handle is `menu.tsx`'s grip (#1268): drawn in 3-components/sheets.css,
    // shown on a tile sheet here.
    const handle = declsFor(
      menus,
      sel(".menu-panel:has(.o4-tiles) .menu-grip")
    );
    expect(handle.get("display")).toBe("flex");
    const scrim = declsFor(menus, sel(".menu-scrim:has(.o4-tiles)"));
    expect(scrim.get("background")).toBe("var(--s-dim)");
    expect(scrim.get("padding")).toMatch(/^8px /);
  });
});
