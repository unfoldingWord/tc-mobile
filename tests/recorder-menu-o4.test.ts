// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecorderMenu,
  type RecorderMenuProps,
} from "@/components/recorder-menu";
import { TILE_GLYPH } from "@/components/o4-tile-look";
import { strings } from "@/lib/strings";

import { areaScope, areaSelector, declsFor, fileRules } from "./o4-area-css";

/**
 * The recorder menu on the O4 tile grid (#949 G3, epic #936), including the
 * edit-mode menu the header's ⋮ opens while editing (#1243) — both are this
 * one component.
 *
 * G3 (workbench round 4) drops Edit from this menu — the recorder screen
 * carries its own edit control — so the record-mode menu is Mark and Erase.
 * The theme tile left it (#1575, the DRI's pick on #1623: "Remove, Settings
 * only"); the negative case near the end pins that.
 *
 * Delete segment (#590) lived here too, from #1080 until #1104 (the
 * requirements owner's 2026-09-26 decision) pulled it back out of this menu
 * entirely — it belongs to the chapter view's own segment menu now
 * (`tests/segments-o4.test.ts` and `tests/segment-row-*.test.ts` cover that
 * one). The negative case near the end of this file pins the removal.
 *
 * Marking done (G8) is #995's shared `done` / `doneoff` tile tone, the same
 * mechanism the segment menu uses, not a recorder copy of it.
 *
 * What this file does NOT cover: the cascade (whether `o4/menus.css` wins on
 * a real page, and whether the sheet really stays under half a phone's
 * screen), and focus RETURN to the opener, which `recorder.tsx` owns and this
 * change does not touch. Nothing here has run on a phone.
 */

/** The part of the #927 cap's selector the component itself must satisfy. */
const CAP_PANEL = ".menu-panel:has(.recorder-menu-tile)";

let root: Root;
let host: HTMLDivElement;

const base: RecorderMenuProps = {
  open: true,
  onClose: vi.fn(),
  mode: "record",
  ordinal: 3,
  finishedState: "empty",
  markReason: null,
  eraseReason: null,
  onToggleFinished: vi.fn(),
  onErase: vi.fn(),
};

function show(over: Partial<RecorderMenuProps> = {}) {
  act(() => root.render(createElement(RecorderMenu, { ...base, ...over })));
  // A floor for every case: a case that loops over the tiles, or asks a
  // row question, must be asking it of the tile grid and not of rows. Three
  // in record mode: Mark, Erase (#1104 removed Delete and #1575 the theme
  // tile — see the negative cases near the end of this file). One in edit
  // mode: Erase (#1252 removed the Done tile).
  if (over.open ?? true)
    expect(tiles().length, "no tiles rendered").toBe(
      over.mode === "edit" ? 1 : 2
    );
}
const buttons = () => [...document.querySelectorAll("button")];
const named = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label") === label);
const startingWith = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label")?.startsWith(label));
const tiles = () => [...document.querySelectorAll("button.o4-tile")];
// The theme control names the DESTINATION, which depends on the theme the
// document starts in; either name is the theme control. It is not in this
// menu any more (#1575), so every use below asks for its absence.
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

describe("RecorderMenu on the tile grid (#949 G3)", () => {
  it("lays record mode out as Mark, then Erase, with no theme tile (#1575)", () => {
    show();
    const grid = document.querySelector(".o4-tiles");
    expect(grid).not.toBeNull();
    expect(labels().slice(0, 2)).toEqual([
      strings.markFinished(3),
      strings.eraseSegment,
    ]);
    expect(themeTile()).toBeUndefined();
    // Every action is a tile inside the one grid, and no spacer holds a place
    // for the theme tile that moved to Settings.
    expect(grid?.querySelectorAll("button.o4-tile")).toHaveLength(2);
    expect(grid?.querySelector(".o4-tiles-gap")).toBeNull();
    // G3 round 4: Edit is on the recorder screen, not in this menu.
    expect(startingWith(strings.enterEdit)).toBeUndefined();
  });

  it("lays edit mode (the ⋮ menu) out as Erase alone — no Done tile (#1252), no theme tile (#1575)", () => {
    show({ mode: "edit" });
    expect(labels()).toEqual([strings.eraseSegment]);
    expect(themeTile()).toBeUndefined();
    // "Done" keeps one meaning, mark finished (the requirements owner).
    expect(
      tiles().filter((t) => t.textContent?.includes(strings.tileFinished))
    ).toEqual([]);
    expect(named(strings.markFinished(3))).toBeUndefined();
  });

  it("never renders a Delete segment tile, in either mode (#1104 — Delete moved to the chapter view)", () => {
    // #590/#1080 first shipped a Delete tile here; the requirements owner's
    // 2026-09-26 decision on #1104 pulled it back out: "the menu inside the
    // segment editor (recorder) shows Erase only."
    show();
    expect(named(strings.deleteSegment)).toBeUndefined();
    show({ mode: "edit" });
    expect(named(strings.deleteSegment)).toBeUndefined();
  });

  it("keys the #927 half-screen cap's selector to this menu's rendered sheet, in both modes", () => {
    // The cap in o4/menus.css matches `.menu-panel:has(.recorder-menu-tile)`;
    // the stylesheet cases below read only the CSS, so this is the link from
    // that selector to what the component renders.
    for (const mode of ["record", "edit"] as const) {
      show({ mode });
      const panel = document.querySelector(".menu-panel");
      expect(panel, `${mode}: no .menu-panel rendered`).not.toBeNull();
      expect(panel?.matches(CAP_PANEL), `${mode}: cap selector misses`).toBe(
        true
      );
      const actions = tiles();
      expect(actions).toHaveLength(mode === "edit" ? 1 : 2);
      for (const t of actions)
        expect(
          t.classList.contains("recorder-menu-tile"),
          `${mode}: ${t.getAttribute("aria-label") ?? ""} lacks the cap class`
        ).toBe(true);
    }
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

  it("draws every tile's glyph at the shared 30px tile size", () => {
    show();
    // A literal, not TILE_GLYPH against itself: the tile glyph is pinned at
    // 30, larger than the 22px default a menu row's Control draws.
    expect(TILE_GLYPH).toBe(30);
    for (const tile of tiles()) {
      const size = Number(tile.querySelector("svg")?.getAttribute("width"));
      expect(size).toBe(30);
    }
  });

  it("gives the tiles their tones: doneoff Mark, plain Clear (#1119)", () => {
    show();
    expect(named(strings.markFinished(3))?.classList).toContain(
      "o4-tile--doneoff"
    );
    // Clear removes only the audio, so it takes the neutral well; the red
    // erase tone is kept for Delete, which lives in the chapter view.
    expect(named(strings.eraseSegment)?.classList).toContain("o4-tile--plain");
    expect(named(strings.eraseSegment)?.classList).not.toContain(
      "o4-tile--erase"
    );
  });

  it("keeps the Mark tile's label fixed and flips its tone (done / doneoff) and aria-pressed on the same value (#351)", () => {
    show({ finishedState: "finished" });
    const marked = named(strings.markFinished(3));
    expect(marked?.classList).toContain("o4-tile--done");
    expect(marked?.classList).not.toContain("o4-tile--doneoff");
    expect(marked?.getAttribute("aria-pressed")).toBe("true");
    expect(named("Mark segment 3 not done")).toBeUndefined();
    show({ finishedState: "empty" });
    const unmarked = named(strings.markFinished(3));
    expect(unmarked?.classList).toContain("o4-tile--doneoff");
    expect(unmarked?.classList).not.toContain("o4-tile--done");
    expect(unmarked?.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps paint and label agreeing when the ordinal is missing", () => {
    show({ ordinal: null, finishedState: "finished" });
    expect(startingWith(strings.markFinished(0))?.classList).toContain(
      "o4-tile--doneoff"
    );
    expect(named("Mark segment 0 not done")).toBeUndefined();
  });

  it("does NOT paint the green fill on a disabled-finished tile", () => {
    show({ finishedState: "disabled", markReason: "no-audio" });
    expect(startingWith(strings.markFinished(3))?.classList).toContain(
      "o4-tile--doneoff"
    );
  });

  it("greys a tile with its reason in the name, still reachable by keyboard", () => {
    show({
      eraseReason: "no-clip",
      markReason: "no-audio",
    });
    // The exact spoken name: the label, then the reason the tile is grey.
    for (const [label, reason] of [
      [strings.eraseSegment, strings.nothingStored],
      [strings.markFinished(3), strings.nothingRecorded],
    ] as const) {
      const tile = startingWith(label);
      expect(tile?.getAttribute("aria-label")).toBe(`${label}. ${reason}`);
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

  it("hands each tap to its prop", () => {
    const onErase = vi.fn();
    const onToggleFinished = vi.fn();
    const onClose = vi.fn();
    show({ onErase, onToggleFinished, onClose });
    act(() => named(strings.markFinished(3))?.click());
    act(() => named(strings.eraseSegment)?.click());
    show({ mode: "edit", onErase, onClose });
    act(() => named(strings.eraseSegment)?.click());
    expect(onToggleFinished).toHaveBeenCalledTimes(1);
    expect(onErase).toHaveBeenCalledTimes(2);
    // Marking does not close the sheet: the tile turns green under the thumb.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("puts Stop first while a take is recording, and its tap reaches onStopTake (#369)", () => {
    // The DRI's 2026-10-19 pick on #369: while recording, the menu's first
    // tile ends the take, so a menu opened by accident does not stand
    // between the translator and the transport underneath it. Since #614
    // that transport control is Stop (it commits the take), so this is too.
    const onStopTake = vi.fn();
    act(() =>
      root.render(
        createElement(RecorderMenu, {
          ...base,
          recording: true,
          onStopTake,
          markReason: "uncommitted-take",
          eraseReason: "uncommitted-take",
        })
      )
    );
    expect(tiles()).toHaveLength(3);
    const stop = named(strings.stop);
    expect(tiles()[0], "Stop is the first tile").toBe(stop);
    expect(stop?.querySelector(".control-caption")?.textContent).toBe(
      strings.tileStop
    );
    // Erase stays beside it (#1104 kept Erase); Delete does not come back.
    expect(startingWith(strings.eraseSegment)).toBeDefined();
    expect(named(strings.deleteSegment)).toBeUndefined();
    // The open edge lands on it: it is the first actionable tile.
    expect(document.activeElement).toBe(stop);
    act(() => stop?.click());
    expect(onStopTake).toHaveBeenCalledTimes(1);
  });

  it("draws no Stop tile when no take is recording, in either mode (#369)", () => {
    show({ recording: false, onStopTake: vi.fn() });
    expect(named(strings.stop)).toBeUndefined();
    show({ mode: "edit", recording: false, onStopTake: vi.fn() });
    expect(named(strings.stop)).toBeUndefined();
  });

  it("lands open-edge focus on the first actionable tile, never a tile that is not an action", () => {
    show();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      strings.markFinished(3)
    );
  });
});

describe("o4/menus.css, recorder-menu section (#949 G3)", () => {
  const menus = areaScope("menus");
  // Every rule in the whole file, every nested block included: "the cap is
  // its only rule" is a ban on any other, so it cannot stop at the layer.
  const rules = fileRules("menus");
  const panel = areaSelector("menus", CAP_PANEL);

  it("keeps the recorder sheet under half the screen", () => {
    expect(declsFor(menus, panel).get("max-height")).toBe("50dvh");
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
