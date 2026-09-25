// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecorderMenu,
  type RecorderMenuProps,
} from "@/components/recorder-menu";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";

import { areaRules, declsFor } from "./o4-area-css";

/**
 * The recorder menu on the O4 tile grid (#949 G3, epic #936), including the
 * edit-mode menu the edit toolbar's ⋮ opens (#863) — both are this one
 * component.
 *
 * The switch is read through `useDesign()`, mocked so each case picks its
 * look (`tests/segments-o4.test.ts` is the pattern). The first case below is
 * the "switch off means unchanged" guard.
 *
 * G3 (workbench round 4) drops Edit from this menu in O4 — the recorder
 * screen carries its own edit control — so the record-mode O4 menu is Mark,
 * Erase and the theme tile. Every other row keeps the accessible name,
 * gating and hint it has in the current look; the cases below re-ask the
 * current suite's questions of the O4 branch.
 *
 * Marking done (G8) is #995's shared `done` / `doneoff` tile tone and the
 * theme tile is `ThemeControl`'s shared `tile` prop — the same two mechanisms
 * the segment menu uses, not a recorder copy of either.
 *
 * What this file does NOT cover: the cascade (whether `o4/menus.css` wins on
 * a real page, and whether the sheet really stays under half a phone's
 * screen), and focus RETURN to the opener, which `recorder.tsx` owns and this
 * change does not touch. Nothing here has run on a phone.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

let root: Root;
let host: HTMLDivElement;

const base: RecorderMenuProps = {
  open: true,
  onClose: vi.fn(),
  mode: "record",
  ordinal: 3,
  finishedState: "empty",
  editReason: null,
  markReason: null,
  eraseReason: null,
  onEnterEdit: vi.fn(),
  onToggleFinished: vi.fn(),
  onErase: vi.fn(),
  onExitEdit: vi.fn(),
};

function show(over: Partial<RecorderMenuProps> = {}, look: Design = "o4") {
  design.current = look;
  act(() => root.render(createElement(RecorderMenu, { ...base, ...over })));
  // A floor for every O4 case: a case that loops over the tiles, or asks a
  // row question, must be asking it of the tile grid and not of rows.
  if (look === "o4" && (over.open ?? true))
    expect(tiles().length, "no O4 tiles rendered").toBe(3);
}
const buttons = () => [...document.querySelectorAll("button")];
const named = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label") === label);
const startingWith = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label")?.startsWith(label));
const tiles = () => [...document.querySelectorAll("button.o4-tile")];
// The theme tile names the DESTINATION, which depends on the theme the
// document starts in; either name is the theme tile.
const themeTile = () =>
  named(strings.useLightTheme) ?? named(strings.useDarkTheme);
const labels = () => tiles().map((t) => t.getAttribute("aria-label"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("RecorderMenu in O4 (#949 G3)", () => {
  it("keeps the current look's rows when the switch is off", () => {
    show({}, "current");
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector(".o4-tiles")).toBeNull();
    expect(named(strings.enterEdit)).toBeDefined();
  });

  it("lays record mode out as Mark, Erase, then the theme tile past a spacer", () => {
    show();
    const grid = document.querySelector(".o4-tiles");
    expect(grid).not.toBeNull();
    expect(labels().slice(0, 2)).toEqual([
      strings.markFinished(3),
      strings.eraseSegment,
    ]);
    expect(labels()[2]).toBe(themeTile()?.getAttribute("aria-label"));
    // Every action is a tile inside the one grid, the spacer before theme.
    expect(grid?.querySelectorAll("button.o4-tile")).toHaveLength(3);
    const kids = [...(grid?.children ?? [])];
    expect(kids[2]?.classList.contains("o4-tiles-gap")).toBe(true);
    // G3 round 4: Edit is on the recorder screen, not in this menu.
    expect(startingWith(strings.enterEdit)).toBeUndefined();
  });

  it("lays edit mode (the ⋮ menu, #863) out as Done, Erase, then theme", () => {
    show({ mode: "edit" });
    expect(labels().slice(0, 2)).toEqual([
      strings.doneEditing,
      strings.eraseSegment,
    ]);
    expect(labels()[2]).toBe(themeTile()?.getAttribute("aria-label"));
    expect(named(strings.markFinished(3))).toBeUndefined();
  });

  it("shows each tile's caption as a word of its accessible name (label-in-name)", () => {
    for (const over of [
      {},
      { finishedState: "finished" as const },
      { mode: "edit" as const },
    ]) {
      show(over);
      for (const tile of tiles()) {
        const caption = tile
          .querySelector(".control-caption")
          ?.textContent?.toLowerCase();
        expect(caption, tile.getAttribute("aria-label") ?? "").toBeTruthy();
        expect(
          tile
            .getAttribute("aria-label")
            ?.toLowerCase()
            .split(/[^a-z]+/)
        ).toContain(caption);
      }
    }
  });

  it("draws larger glyphs on the tiles than the current look's rows", () => {
    show({}, "current");
    const rowSize = Number(
      named(strings.markFinished(3))
        ?.querySelector("svg")
        ?.getAttribute("width")
    );
    show();
    for (const tile of tiles()) {
      const size = Number(tile.querySelector("svg")?.getAttribute("width"));
      expect(size).toBeGreaterThan(rowSize);
    }
  });

  it("gives the tiles their tones: doneoff Mark, plain theme, the erase tile for Erase", () => {
    show();
    expect(named(strings.markFinished(3))?.classList).toContain(
      "o4-tile--doneoff"
    );
    expect(named(strings.eraseSegment)?.classList).toContain("o4-tile--erase");
    expect(themeTile()?.classList).toContain("o4-tile--plain");
    show({ mode: "edit" });
    expect(named(strings.doneEditing)?.classList).toContain("o4-tile--plain");
  });

  it("flips the Mark tile's LABEL and its tone (done / doneoff) on the same value", () => {
    show({ finishedState: "finished" });
    const marked = named(strings.markUnfinished(3));
    expect(marked?.classList).toContain("o4-tile--done");
    expect(marked?.classList).not.toContain("o4-tile--doneoff");
    show({ finishedState: "empty" });
    const unmarked = named(strings.markFinished(3));
    expect(unmarked?.classList).toContain("o4-tile--doneoff");
    expect(unmarked?.classList).not.toContain("o4-tile--done");
  });

  it("keeps paint and label agreeing when the ordinal is missing", () => {
    show({ ordinal: null, finishedState: "finished" });
    expect(startingWith(strings.markFinished(0))?.classList).toContain(
      "o4-tile--doneoff"
    );
    expect(named(strings.markUnfinished(0))).toBeUndefined();
  });

  it("does NOT paint the green fill on a disabled-finished tile", () => {
    show({ finishedState: "disabled", markReason: "no-audio" });
    expect(startingWith(strings.markFinished(3))?.classList).toContain(
      "o4-tile--doneoff"
    );
  });

  it("greys a tile with its reason in the name, still reachable by keyboard", () => {
    show({ eraseReason: "no-clip", markReason: "no-audio" });
    for (const label of [strings.eraseSegment, strings.markFinished(3)]) {
      const tile = startingWith(label);
      expect(tile?.getAttribute("aria-label")).not.toBe(label);
      expect(tile?.getAttribute("aria-disabled")).toBe("true");
      expect(tile?.hasAttribute("disabled")).toBe(false);
    }
    show({ mode: "edit", eraseReason: "no-clip" });
    expect(
      startingWith(strings.eraseSegment)?.getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("HARD-disables a tile whose reason has nothing to say", () => {
    show({ markReason: "no-segment" });
    const mark = named(strings.markFinished(3));
    expect(mark?.hasAttribute("disabled")).toBe(true);
    expect(mark?.getAttribute("aria-disabled")).toBeNull();
  });

  it("hands each tap to the same prop the current look does", () => {
    const onErase = vi.fn();
    const onToggleFinished = vi.fn();
    const onExitEdit = vi.fn();
    const onClose = vi.fn();
    show({ onErase, onToggleFinished, onClose });
    act(() => named(strings.markFinished(3))?.click());
    act(() => named(strings.eraseSegment)?.click());
    show({ mode: "edit", onErase, onExitEdit, onClose });
    act(() => named(strings.doneEditing)?.click());
    act(() => named(strings.eraseSegment)?.click());
    expect(onToggleFinished).toHaveBeenCalledTimes(1);
    expect(onErase).toHaveBeenCalledTimes(2);
    expect(onExitEdit).toHaveBeenCalledTimes(1);
    // Marking does not close the sheet: the tile turns green under the thumb.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lands open-edge focus on the first actionable tile, never the theme tile first", () => {
    show();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      strings.markFinished(3)
    );
  });
});

describe("o4/menus.css, recorder-menu section (#949 G3)", () => {
  const rules = areaRules("menus");
  const panel = '[data-design="o4"] .menu-panel:has(.recorder-menu-tile)';

  it("keeps the recorder sheet under half the screen", () => {
    expect(declsFor(rules, panel).get("max-height")).toBe("50dvh");
  });

  it("paints no done fill of its own: the half-screen cap is its only rule", () => {
    // Marking done is #995's shared tone; a recorder-keyed paint rule would
    // be the second mechanism this section must not grow back.
    expect(rules.length, "menus.css parsed to no rules").toBeGreaterThan(0);
    const own = rules.filter((r) =>
      r.selectors.some((sel) => sel.includes("recorder-menu"))
    );
    expect(own.map((r) => r.selectors)).toEqual([[panel]]);
  });
});
