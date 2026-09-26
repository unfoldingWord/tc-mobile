// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

import { areaRules, declsFor } from "./o4-area-css";

/**
 * #949's first slice: the chapter menu (G2), the segment menu (07) and
 * marking done (G8) on the O4 tile grid.
 *
 * Mounted through the whole `SegmentsScreen`, so the row menu gets the
 * breadcrumb parts the screen hands it, and both menus are opened the way a
 * translator opens them — a tap on their ⋮. The design is picked by mocking
 * `useDesign()` (the pattern `tests/segments-o4.test.ts` uses). The chapter
 * menu's switch contract is that the tiles change the paint, never the names
 * a screen reader hears or where focus lands on open. The segment menu's O4
 * branch changes both on purpose (D20: Rename in the head, Play in the
 * preview, Edit and Done greyed on an empty segment), so each look is pinned
 * separately there. In both menus and both looks, focus still goes back to
 * the ⋮ on close (#679 / #676 / #799 / #395).
 *
 * What this does NOT cover: the cascade, layout and paint. jsdom has none, so
 * whether the sheet looks like the workbench's G2 and 07 is a browser and
 * phone question this file does not answer.
 */

const design = vi.hoisted(() => ({ current: "current" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const mocks = vi.hoisted(() => ({ rows: [] as SegmentRow[] }));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
    chapterNumber: 4,
    chapterName: null,
    rows: mocks.rows,
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(async () => true),
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    missing: 0,
    sendUnconfirmed: false,
    ownsScreen: () => false,
    reset: () => {},
  }),
}));

const recorded: SegmentRow = {
  segmentId: "segment-3" as SegmentId,
  ordinal: 3,
  label: null,
  hasClip: true,
  finished: false,
  clipId: "clip-3" as ClipId,
  peaks: null,
  durationMs: 1000,
};
const finished: SegmentRow = { ...recorded, finished: true };
const empty: SegmentRow = {
  ...recorded,
  hasClip: false,
  clipId: null,
  durationMs: null,
};
const titled: SegmentRow = { ...recorded, label: "the sower" };

let root: Root;
const layers = new Map<string, Layer>();
const audio = {
  error: null,
  playingId: null,
  playbackElapsedMs: 0,
} as UseAudioSession;
const erase = {
  erase: vi.fn(async () => "ok" as const),
  erasing: false,
  isErasing: () => false,
};

beforeEach(() => {
  layers.clear();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  design.current = "current";
  vi.unstubAllGlobals();
});

async function mount(look: Design, row: SegmentRow = recorded) {
  design.current = look;
  mocks.rows = [row];
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase,
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    )
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}

/** Focus, then click: jsdom's `click()` alone moves no focus, and the
 * chapter menu captures its restore target from `document.activeElement`. */
async function tap(label: string) {
  const el = button(label);
  await act(async () => {
    el.focus();
    el.click();
  });
}

/** Escape in a name field: NameEdit's own cancel, back to the tiles. */
async function cancelField(fieldLabel: string) {
  const field = document.querySelector(`input[aria-label="${fieldLabel}"]`);
  expect(field, fieldLabel).not.toBeNull();
  await act(async () => {
    field!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
}

async function escape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

function dialog(): Element {
  const found = document.querySelectorAll('[role="dialog"]');
  expect(found).toHaveLength(1);
  return found[0]!;
}

/** Every button name the open dialog exposes to AT, in document order. */
function dialogNames(): string[] {
  return [...dialog().querySelectorAll("button")]
    .filter((el) => el.closest("[aria-hidden='true']") === null)
    .map((el) => el.getAttribute("aria-label") ?? "");
}

function focusedName(): string {
  const el = document.activeElement;
  if (!el || el === document.body) return "BODY";
  return el.getAttribute("aria-label") ?? el.tagName;
}

/** The open dialog's one button with this name — scoped, because the row's
 * own open button behind the scrim is also "Edit segment 3". */
function tile(label: string): HTMLButtonElement {
  const found = [
    ...dialog().querySelectorAll<HTMLButtonElement>("button"),
  ].filter((el) => el.getAttribute("aria-label") === label);
  expect(found, `one dialog button labelled "${label}"`).toHaveLength(1);
  expect(found[0]!.classList.contains("o4-tile"), label).toBe(true);
  return found[0]!;
}

/** The tile's tone class, e.g. `edit` for `o4-tile--edit`. */
function tone(el: Element): string | undefined {
  return [...el.classList]
    .find((c) => c.startsWith("o4-tile--"))
    ?.slice("o4-tile--".length);
}

/** Label-in-name (WCAG 2.5.3): the visible caption word is in the name. */
function expectCaptionInName() {
  const tiles = [...dialog().querySelectorAll("button.o4-tile")];
  expect(tiles.length).toBeGreaterThanOrEqual(1);
  for (const el of tiles) {
    const caption = el.querySelector(".control-caption")?.textContent ?? "";
    expect(caption, "a visible caption").not.toBe("");
    expect(
      (el.getAttribute("aria-label") ?? "").toLowerCase(),
      `${caption} in its name`
    ).toContain(caption.toLowerCase());
  }
}

/** The tiles' names, in grid order, with the spacer marked `|`. */
function gridOrder(): string[] {
  const grid = dialog().querySelector(".o4-tiles");
  expect(grid).not.toBeNull();
  return [...grid!.children].map((el) =>
    el.classList.contains("o4-tiles-gap")
      ? "|"
      : (el.getAttribute("aria-label") ?? el.tagName)
  );
}

const LOOKS = ["current", "o4"] as const;

describe("the segment menu (07) on the tile grid", () => {
  const openRow = () => tap(strings.segmentMenu(3));

  // The two looks no longer expose the same names in this menu: D20 (#949,
  // DRI 2026-09-25) moves Rename into the O4 head, adds Play to the preview
  // row and greys Edit and Done on a never-recorded segment. So each look is
  // pinned on its own: the current look exactly as before, O4 as the workbench
  // draws 07 (first focus on the head's pencil, its first control).
  it.each([
    ["recorded", recorded],
    ["finished", finished],
    ["titled", titled],
  ] as const)(
    "keeps the current look's names and first focus (%s)",
    async (_, row) => {
      await mount("current", row);
      await openRow();
      expect(dialogNames()).toEqual([
        strings.menuClose,
        strings.editSegment(3, row.label),
        row.finished ? strings.markUnfinished(3) : strings.markFinished(3),
        strings.renameSegment,
        strings.eraseSegment,
      ]);
      expect(focusedName()).toBe(strings.editSegment(3, row.label));
    }
  );

  it("keeps the current look's never-recorded menu: Rename alone, focused", async () => {
    await mount("current", empty);
    await openRow();
    expect(dialogNames()).toEqual([strings.menuClose, strings.renameSegment]);
    expect(focusedName()).toBe(strings.renameSegment);
  });

  it.each([
    ["recorded", recorded],
    ["finished", finished],
    ["titled", titled],
  ] as const)(
    "puts Rename in the head, Play in the preview, then the tiles, and lands on Rename (o4, D20, %s)",
    async (_, row) => {
      await mount("o4", row);
      await openRow();
      expect(dialogNames()).toEqual([
        strings.menuClose,
        strings.renameSegment,
        strings.playSegment(3),
        strings.editSegment(3, row.label),
        row.finished ? strings.markUnfinished(3) : strings.markFinished(3),
        strings.eraseSegment,
      ]);
      expect(focusedName()).toBe(strings.renameSegment);
    }
  );

  it("draws Edit and Done, then Erase past a gap, with Rename as the head's pencil (#859, D20)", async () => {
    await mount("o4", recorded);
    await openRow();
    // Edit and Done carry a hint slot (#135), so each sits in its
    // `.control-hinted` wrapper; read the grid's buttons, not its children.
    const grid = dialog().querySelector(".o4-tiles")!;
    expect(
      [...grid.querySelectorAll("button, .o4-tiles-gap")].map((el) =>
        el.classList.contains("o4-tiles-gap")
          ? "|"
          : el.getAttribute("aria-label")
      )
    ).toEqual([
      strings.editSegment(3, null),
      strings.markFinished(3),
      "|",
      strings.eraseSegment,
    ]);
    expect(tone(tile(strings.editSegment(3, null)))).toBe("edit");
    expect(tone(tile(strings.eraseSegment))).toBe("erase");
    const pen = button(strings.renameSegment);
    expect(pen.closest(".o4-sheet-bar"), "Rename sits in the head").not.toBe(
      null
    );
    expect(pen.closest(".o4-tiles"), "Rename is not a tile").toBeNull();
    expect(pen.classList.contains("o4-head-pen")).toBe(true);
    expectCaptionInName();
  });

  it("marks done grey until it is done, then the whole tile green (G8)", async () => {
    await mount("o4", recorded);
    await openRow();
    expect(tone(tile(strings.markFinished(3)))).toBe("doneoff");
    await escape();
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);

    await mount("o4", finished);
    await openRow();
    expect(tone(tile(strings.markUnfinished(3)))).toBe("done");
    expectCaptionInName();
  });

  it("shows Edit and Done greyed on a never-recorded segment, each saying why (o4, D20)", async () => {
    await mount("o4", empty);
    await openRow();
    const why = strings.nothingRecorded;
    const edit = `${strings.editSegment(3, null)}. ${why}`;
    const done = `${strings.markFinished(3)}. ${why}`;
    expect(dialogNames()).toEqual([
      strings.menuClose,
      strings.renameSegment,
      edit,
      done,
    ]);
    for (const name of [edit, done]) {
      const el = tile(name);
      // The #135 convention: aria-disabled (focusable, speaks its reason),
      // not the native attribute.
      expect(el.getAttribute("aria-disabled"), name).toBe("true");
      expect(el.disabled, name).toBe(false);
    }
    // No Play on a segment with nothing to play.
    expect(dialogNames()).not.toContain(strings.playSegment(3));
    expect(focusedName()).toBe(strings.renameSegment);
  });

  it("plays the segment from the preview row through the row's own play path, menu left open (o4, D20)", async () => {
    const playTake = vi.fn();
    Object.assign(audio, { playTake });
    try {
      await mount("o4", recorded);
      await openRow();
      // Scoped to the dialog: the row's own Play behind the scrim has the
      // same name.
      const play = dialog().querySelector<HTMLButtonElement>(
        `.o4-menu-preview button[aria-label="${strings.playSegment(3)}"]`
      );
      expect(play).not.toBeNull();
      await act(async () => play!.click());
      expect(playTake).toHaveBeenCalledTimes(1);
      expect(playTake.mock.calls[0]![0]).toMatchObject({
        segmentId: recorded.segmentId,
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      Object.assign(audio, { playTake: undefined });
    }
  });

  it("heads the sheet with the book, chapter and segment crumbs (§7), decoration only", async () => {
    await mount("o4", finished);
    await openRow();
    const head = dialog().querySelector(".o4-sheet-head");
    expect(head).not.toBeNull();
    expect(head!.getAttribute("aria-hidden")).toBe("true");
    const crumbs = [...head!.querySelectorAll(".o4-crumb")];
    expect(crumbs.map((c) => c.textContent)).toEqual(["Mark", "4", "3"]);
    expect(crumbs[2]!.getAttribute("data-state")).toBe("finished");
  });

  it("moves the segment's name into the preview row, beside its badge and wave", async () => {
    await mount("o4", titled);
    await openRow();
    const preview = dialog().querySelector(".o4-menu-preview");
    expect(preview).not.toBeNull();
    // D20 puts a live Play in this row, so the row itself can no longer be
    // aria-hidden; its badge and name/wave still are.
    expect(
      preview!.querySelector(".o4-menu-badge")?.getAttribute("aria-hidden")
    ).toBe("true");
    expect(
      preview!
        .querySelector(".o4-menu-preview-mid")
        ?.getAttribute("aria-hidden")
    ).toBe("true");
    expect(preview!.querySelector(".o4-menu-badge")?.textContent).toBe("3");
    expect(preview!.querySelector(".o4-menu-title")?.textContent).toBe(
      "the sower"
    );
    expect(preview!.querySelector("canvas")).not.toBeNull();
    // Not in the header any more.
    expect(dialog().querySelector(".o4-sheet-head")?.textContent).not.toMatch(
      /the sower/
    );
  });

  it("adds none of it in the current look", async () => {
    await mount("current", titled);
    await openRow();
    expect(dialog().querySelector(".o4-tiles")).toBeNull();
    expect(dialog().querySelector(".o4-sheet-head")).toBeNull();
    expect(dialog().querySelector(".o4-menu-preview")).toBeNull();
    expect(dialog().querySelector(".o4-tile")).toBeNull();
  });

  it.each(LOOKS)(
    "returns focus to the ⋮ on Escape, and to Rename when the field is cancelled (%s)",
    async (look) => {
      await mount(look, recorded);
      await openRow();
      await tap(strings.renameSegment);
      await cancelField(strings.segmentNameField);
      expect(focusedName()).toBe(strings.renameSegment);
      await escape();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(focusedName()).toBe(strings.segmentMenu(3));
    }
  );
});

describe("the chapter menu (G2) on the tile grid", () => {
  const openChapter = () => tap(strings.chapterMenuOpen);

  it("exposes the same names and lands focus on the same action in both looks", async () => {
    const seen: { names: string[]; focus: string }[] = [];
    for (const look of LOOKS) {
      await mount(look);
      await openChapter();
      seen.push({ names: dialogNames(), focus: focusedName() });
      await escape();
    }
    expect(seen[0]!.names.length).toBeGreaterThanOrEqual(3);
    expect(seen[1]).toEqual(seen[0]);
  });

  it("draws Rename and Share, then the theme tile past a gap", async () => {
    await mount("o4");
    await openChapter();
    const order = gridOrder();
    expect(order.slice(0, 3)).toEqual([
      strings.renameChapter,
      strings.shareChapter,
      "|",
    ]);
    expect(order).toHaveLength(4);
    expect(tone(tile(strings.renameChapter))).toBe("name");
    expect(tone(tile(strings.shareChapter))).toBe("send");
    expect(tone(tile(order[3]!))).toBe("plain");
    expectCaptionInName();
  });

  it("heads the sheet with the book and chapter crumbs, decoration only", async () => {
    await mount("o4");
    await openChapter();
    const head = dialog().querySelector(".o4-sheet-head");
    expect(head?.getAttribute("aria-hidden")).toBe("true");
    expect(
      [...head!.querySelectorAll(".o4-crumb")].map((c) => c.textContent)
    ).toEqual(["Mark", "4"]);
  });

  it("adds none of it in the current look", async () => {
    await mount("current");
    await openChapter();
    expect(dialog().querySelector(".o4-tiles")).toBeNull();
    expect(dialog().querySelector(".o4-sheet-head")).toBeNull();
  });

  it.each(LOOKS)(
    "returns focus to the ⋮ on Escape, and to Rename when the field is cancelled (%s)",
    async (look) => {
      await mount(look);
      await openChapter();
      await tap(strings.renameChapter);
      await cancelField(strings.chapterNameField);
      expect(focusedName()).toBe(strings.renameChapter);
      await escape();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(focusedName()).toBe(strings.chapterMenuOpen);
    }
  );
});

describe("marking-done copy (D17)", () => {
  it('captions the tile "Done" and says done in the label, one string for every menu', () => {
    expect(strings.tileFinished).toBe("Done");
    expect(strings.markFinished(3)).toBe("Mark segment 3 done");
    expect(strings.markUnfinished(3)).toBe("Mark segment 3 not done");
  });
});

describe("o4/menus.css, #949's chapter and segment menu section", () => {
  const rules = areaRules("menus");
  const O4 = '[data-design="o4"]';

  it("pins the erase tile's live ink (#973's deferral)", () => {
    expect(declsFor(rules, `${O4} .o4-tile--erase`).get("color")).toBe(
      "var(--s-live)"
    );
  });

  it("paints done green with its own ink, and not-yet-done on the well in faint ink (G8)", () => {
    expect(
      declsFor(rules, `${O4} .o4-tile--done::before`).get("background")
    ).toBe("var(--s-done)");
    expect(declsFor(rules, `${O4} .o4-tile--done`).get("color")).toBe(
      "var(--s-done-ink)"
    );
    expect(
      declsFor(rules, `${O4} .o4-tile--doneoff::before`).get("background")
    ).toBe("var(--s-well)");
    expect(declsFor(rules, `${O4} .o4-tile--doneoff`).get("color")).toBe(
      "var(--s-ink-faint)"
    );
  });

  it("draws the crumbs 40 tall on the well, chevron-clipped, a finished segment on the done wash (D19)", () => {
    const crumb = declsFor(rules, `${O4} .o4-crumb`);
    expect(crumb.get("height")).toBe("40px");
    expect(crumb.get("background")).toBe("var(--s-well)");
    expect(crumb.get("clip-path")).toMatch(/13px/);
    const finished = declsFor(rules, `${O4} .o4-crumb[data-state="finished"]`);
    expect(finished.get("background")).toBe("var(--s-done-quiet)");
    expect(finished.get("color")).toBe("var(--s-done-text)");
    expect(
      declsFor(rules, `${O4} .o4-crumb[data-state="recorded"]`).get(
        "background"
      )
    ).toBe("var(--s-voice-quiet)");
  });

  it("draws the head's Rename pencil as a 52 circle on the name role, and greys a refused tile (D20)", () => {
    const pen = declsFor(rules, `${O4} .o4-head-pen`);
    expect(pen.get("width")).toBe("52px");
    expect(pen.get("height")).toBe("52px");
    expect(pen.get("background")).toBe("var(--s-name)");
    expect(pen.get("color")).toBe("var(--s-tile-ink)");
    expect(
      declsFor(rules, `${O4} .o4-tile[aria-disabled="true"]`).get("opacity")
    ).toBe("0.35");
    expect(
      declsFor(
        rules,
        `${O4} .o4-menu-preview[data-state="finished"] .o4-menu-play`
      ).get("background")
    ).toBe("var(--s-done)");
  });

  it("draws the preview row 78 tall on the floor, its badge a 44 circle, a finished badge on the done wash (D19)", () => {
    const preview = declsFor(rules, `${O4} .o4-menu-preview`);
    expect(preview.get("min-height")).toBe("78px");
    expect(preview.get("background")).toBe("var(--s-floor)");
    const badge = declsFor(rules, `${O4} .o4-menu-badge`);
    expect(badge.get("width")).toBe("44px");
    expect(badge.get("height")).toBe("44px");
    const finished = declsFor(
      rules,
      `${O4} .o4-menu-badge[data-state="finished"]`
    );
    expect(finished.get("background")).toBe("var(--s-done-quiet)");
    expect(finished.get("color")).toBe("var(--s-done-text)");
  });
});
