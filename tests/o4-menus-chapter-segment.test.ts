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
 * `useDesign()` (the pattern `tests/segments-o4.test.ts` uses), and every case
 * that could drift runs in BOTH looks: the switch contract is that the tiles
 * change the paint, never the names a screen reader hears, where focus lands
 * on open, or where it goes back to on close (#679 / #676 / #799 / #395).
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

  it.each([
    ["recorded", recorded],
    ["finished", finished],
    ["never recorded", empty],
    ["titled", titled],
  ] as const)(
    "exposes the same names and lands focus on the same action in both looks (%s)",
    async (_, row) => {
      const seen: { names: string[]; focus: string }[] = [];
      for (const look of LOOKS) {
        await mount(look, row);
        await openRow();
        seen.push({ names: dialogNames(), focus: focusedName() });
        await escape();
      }
      expect(seen[0]!.names.length).toBeGreaterThanOrEqual(2);
      expect(seen[1]).toEqual(seen[0]);
    }
  );

  it("draws Edit, Finished and Rename, then Erase past a gap, each told apart by colour (#859)", async () => {
    await mount("o4", recorded);
    await openRow();
    expect(gridOrder()).toEqual([
      strings.editSegment(3, null),
      strings.markFinished(3),
      strings.renameSegment,
      "|",
      strings.eraseSegment,
    ]);
    expect(tone(tile(strings.editSegment(3, null)))).toBe("edit");
    expect(tone(tile(strings.renameSegment))).toBe("name");
    expect(tone(tile(strings.eraseSegment))).toBe("erase");
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

  it("offers only Rename on a never-recorded segment, as the current look does", async () => {
    await mount("o4", empty);
    await openRow();
    expect(gridOrder()).toEqual([strings.renameSegment]);
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
    expect(preview!.getAttribute("aria-hidden")).toBe("true");
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

  it("draws the crumbs 40 tall on the well, chevron-clipped, a finished segment on the done fill", () => {
    const crumb = declsFor(rules, `${O4} .o4-crumb`);
    expect(crumb.get("height")).toBe("40px");
    expect(crumb.get("background")).toBe("var(--s-well)");
    expect(crumb.get("clip-path")).toMatch(/13px/);
    expect(
      declsFor(rules, `${O4} .o4-crumb[data-state="finished"]`).get(
        "background"
      )
    ).toBe("var(--s-done)");
    expect(
      declsFor(rules, `${O4} .o4-crumb[data-state="recorded"]`).get(
        "background"
      )
    ).toBe("var(--s-voice-quiet)");
  });

  it("draws the preview row 78 tall on the floor, its badge a 44 circle", () => {
    const preview = declsFor(rules, `${O4} .o4-menu-preview`);
    expect(preview.get("min-height")).toBe("78px");
    expect(preview.get("background")).toBe("var(--s-floor)");
    const badge = declsFor(rules, `${O4} .o4-menu-badge`);
    expect(badge.get("width")).toBe("44px");
    expect(badge.get("height")).toBe("44px");
    expect(
      declsFor(rules, `${O4} .o4-menu-badge[data-state="finished"]`).get(
        "background"
      )
    ).toBe("var(--s-done)");
  });
});
