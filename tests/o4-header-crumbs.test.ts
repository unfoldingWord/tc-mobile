// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { O4Crumbs } from "@/components/o4-crumbs";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { SegmentsScreen } from "@/components/segments-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { StopResult } from "@/hooks/use-recorder";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

import { cssRule, declarationValue, restingErase } from "./support";

/**
 * #1105: the top breadcrumb in the segments header and the recorder header
 * render the same chevron-chip markup the O4 menus already show
 * (`o4-crumbs.tsx`'s `O4SheetHead`).
 *
 * #1230: the header's CHAPTER chip shows the chapter's name — the typed one,
 * or the default "Chapter N" — resolved through `strings.chapterHeading`. The
 * requirements owner's decision on #1230 supersedes #1105's number-only
 * choice for these two headers, and the DRI's pick on #1263 ("Names in menus
 * too") extends it to the sheet heads of the menus opened from them: the
 * chapter menu, a segment's menu and the recorder's ⋮ menu. So a header and
 * its menu agree chip for chip. The spoken name follows the visible chip:
 * the recorder's chips are exposed as they are, the segments breadcrumb's
 * `aria-label` is built from the same resolved heading, and each menu's
 * sheet head carries the same place as one screen-reader-only line.
 *
 * The current (non-O4) look is asserted UNCHANGED: it still resolves and
 * shows the chapter's typed name through `chapterHeading`, in a plain text
 * trail, with no `.o4-crumb` anywhere.
 *
 * What this does NOT cover: layout, the CSS cascade and truncation (jsdom
 * has none of the three). `e2e/header-crumbs-fit.spec.ts` measures those in
 * Chromium against the shipped build; a real phone is not covered by either.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const recorderView = vi.hoisted(() => ({
  bookName: "Book Mine",
  bookCoverHex: "#11796d",
  // A chapter the facilitator renamed, reproducing Tim's report verbatim:
  // its NUMBER is 1, its typed name is "2:1-4".
  chapterNumber: 1,
  chapterName: "2:1-4" as string | null,
  ordinal: 1,
  segmentLabel: null as string | null,
  finished: false,
  hasClip: true,
  samples: new Int16Array([1, 2, 3, 4]),
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: recorderView,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn().mockResolvedValue(recorderView),
    setFinished: vi.fn(),
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

const segmentsMocks = vi.hoisted(() => ({
  rows: [] as SegmentRow[],
  chapterName: "2:1-4" as string | null,
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Book Mine",
    bookCoverHex: "#11796d",
    chapterNumber: 1,
    // Reproduces the same renamed chapter as the recorder case above.
    chapterName: segmentsMocks.chapterName,
    rows: segmentsMocks.rows,
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

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  design.current = "o4";
  segmentsMocks.rows = [];
  segmentsMocks.chapterName = "2:1-4";
  recorderView.chapterName = "2:1-4";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `one button labelled "${label}" in scope`).toHaveLength(1);
  return found[0]!;
}

async function tap(scope: ParentNode, label: string) {
  const el = button(scope, label);
  await act(async () => el.click());
}

/** Every `.o4-crumb`'s text and (if the crumb carries one) its `data-state`,
 * in order — the one shape both the header and the menu head must match. */
function crumbs(scope: ParentNode): { text: string; state: string | null }[] {
  return [...scope.querySelectorAll(".o4-crumb")].map((el) => ({
    text: el.textContent ?? "",
    state: el.getAttribute("data-state"),
  }));
}

/**
 * What a screen reader gets for the place a menu acts on. The chips are
 * `aria-hidden` inside a menu, so the sheet head carries the same place as
 * one screen-reader-only line; this reads that line, and fails if there is
 * not exactly one.
 */
function spokenPlace(panel: Element): string {
  const lines = panel.querySelectorAll(".o4-sheet-place");
  expect(lines, "one spoken place line in the menu").toHaveLength(1);
  expect(lines[0]!.closest('[aria-hidden="true"]')).toBeNull();
  return lines[0]!.textContent ?? "";
}

function header(): Element {
  const found = document.querySelector("header");
  expect(found, "a header").not.toBeNull();
  return found!;
}

describe("the recorder header (#1105)", () => {
  async function mount(
    look: Design,
    options: {
      recorderState?: UseAudioSession["recorderState"];
      stopRecording?: UseAudioSession["stopRecording"];
      /** Hand the sheet the two-level Back (#1275), as App does. */
      withBooks?: boolean;
    } = {}
  ) {
    design.current = look;
    const ref = createRef<RecorderHandle>();
    const onExit = vi.fn();
    // What App hands the recorder: the one Back path, which lands on the
    // sheet's own close. A spy, so a test can count the header's Backs.
    const onRequestBack = vi.fn(() => {
      void ref.current?.requestClose();
    });
    // The adapter's two-level Back (#1275). In App its first level is this
    // same close, then the Segments Back; here it is a spy, so a test can
    // tell which handler the book crumb ran. The chain itself is
    // `tests/nav-back-to-books.test.ts`.
    const onRequestBackToBooks = vi.fn();
    const audio: UseAudioSession = {
      playingId: null,
      playingBuffer: false,
      playbackElapsedMs: 0,
      playbackRanOut: false,
      recorderState: options.recorderState ?? "idle",
      takeCap: { nearLimit: false, remainingMs: 20 * 60_000, reached: false },
      elapsedMs: 0,
      supported: true,
      error: null,
      recorderError: null,
      meterFailed: false,
      playTake: vi.fn(),
      playBuffer: vi.fn(),
      stopBuffer: vi.fn(),
      readPlaybackPosition: () => null,
      startRecording: vi.fn(),
      stopRecording: options.stopRecording ?? vi.fn(),
      retryDecode: vi.fn(),
      leave: vi.fn(),
      primeAudioContext: vi.fn(),
      readLevel: () => 0,
      readMeterAvailable: () => true,
      readScope: () => null,
      peekScope: () => null,
    };
    await act(async () =>
      root.render(
        createElement(Recorder, {
          ref,
          segmentId: "segment" as SegmentId,
          audio,
          saveRecording: vi.fn(),
          saveEditedSegment: vi.fn(),
          clipboard: null,
          onClipboardChange: vi.fn(),
          databaseUnreachable: false,
          erase: restingErase(),
          onExit,
          onRequestBack,
          ...(options.withBooks === false ? {} : { onRequestBackToBooks }),
        })
      )
    );
    return { audio, onExit, onRequestBack, onRequestBackToBooks };
  }

  it("makes the book and chapter crumbs buttons to their places and the segment crumb the current place (#1269, #1275)", async () => {
    await mount("o4");
    const chips = [...header().querySelectorAll(".o4-crumb")];
    expect(chips.map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "SPAN"]);
    // Spelled out, so a change to either entry cannot pass by agreeing
    // with itself: "Go to book {name}", and "Go to {heading}" (DRI pick on
    // #1274).
    expect(chips[0]!.getAttribute("aria-label")).toBe("Go to book Book Mine");
    expect(chips[0]!.textContent).toBe("Book Mine");
    expect(chips[1]!.getAttribute("aria-label")).toBe("Go to 2:1-4");
    expect(chips[1]!.textContent).toBe("2:1-4");
    expect(chips[2]!.getAttribute("aria-current")).toBe("page");
    expect(header().querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("runs the two-level Back, and only that, when the book crumb is tapped (#1275)", async () => {
    const { onRequestBack, onRequestBackToBooks, onExit } = await mount("o4");
    await tap(header(), strings.goToBook("Book Mine"));
    expect(onRequestBackToBooks).toHaveBeenCalledTimes(1);
    // Not the one-level Back as well: the adapter's first level IS that
    // close, and running it here too would issue a second traversal.
    expect(onRequestBack).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("leaves the book crumb a plain chip when no two-level Back is handed in (#1275)", async () => {
    await mount("o4", { withBooks: false });
    const chips = [...header().querySelectorAll(".o4-crumb")];
    expect(chips.map((el) => el.tagName)).toEqual(["SPAN", "BUTTON", "SPAN"]);
    expect(chips[0]!.getAttribute("aria-current")).toBeNull();
  });

  it("names an unnamed chapter's crumb by its default heading (#1269)", async () => {
    recorderView.chapterName = null;
    await mount("o4");
    // The second linked crumb: the first is the book's (#1275).
    const crumb = header().querySelectorAll("button.o4-crumb")[1]!;
    expect(crumb.getAttribute("aria-label")).toBe("Go to Chapter 1");
    expect(crumb.textContent).toBe(strings.chapterName(1));
  });

  it("runs the header's own Back when the chapter crumb is tapped (#1269)", async () => {
    const { onRequestBack, onExit } = await mount("o4");
    await tap(header(), strings.goToChapter("2:1-4"));
    expect(onRequestBack).toHaveBeenCalledTimes(1);
    // That Back is the recorder's own close, which exits the sheet.
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("seals the take in progress, as Back does, and is disabled with Back while the close runs (#1269)", async () => {
    // A take in progress: the crumb's Back must stop the capture first,
    // exactly as the Close control's does. The stop is held open so the
    // close window can be observed.
    let release!: (value: StopResult) => void;
    const stopRecording = vi.fn(
      () =>
        new Promise<StopResult>((resolve) => {
          release = resolve;
        })
    );
    const { onRequestBack, onRequestBackToBooks, onExit } = await mount("o4", {
      recorderState: "recording",
      stopRecording,
    });
    await tap(header(), strings.goToChapter("2:1-4"));
    expect(onRequestBack).toHaveBeenCalledTimes(1);
    expect(stopRecording).toHaveBeenCalledTimes(1);
    // The close is in flight: Back and both crumbs are disabled, so a
    // second tap on any of them cannot start a second exit (#1275: the
    // book crumb would otherwise issue a traversal under the one in flight).
    const crumb = button(header(), strings.goToChapter("2:1-4"));
    const bookCrumb = button(header(), strings.goToBook("Book Mine"));
    const back = button(header(), strings.closeRecorder);
    expect(back.disabled).toBe(true);
    expect(crumb.disabled).toBe(true);
    expect(bookCrumb.disabled).toBe(true);
    await act(async () => crumb.click());
    await act(async () => bookCrumb.click());
    expect(onRequestBack).toHaveBeenCalledTimes(1);
    expect(onRequestBackToBooks).not.toHaveBeenCalled();
    // A capture with audio, so the close saves it and exits.
    await act(async () =>
      release({ samples: new Int16Array([5, 6]), blob: null, error: null })
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  // #1278 (#1274 Low): the crumbs' `disabled` is `heldTake !== null ||
  // isClosing`. The close-window test above holds `isClosing`; this one
  // holds only the take. A decode that failed with its bytes kept is held
  // on the recovery panel, the close window has ended, and the take exists
  // nowhere else, so a crumb must not leave.
  it("stays disabled with Back while a take is held for recovery, after the close window ends (#1274)", async () => {
    const stopRecording = vi.fn(async (): Promise<StopResult> => ({
      samples: null,
      blob: new Blob(["kept"]),
      error: "undecodable",
    }));
    const { onRequestBack, onRequestBackToBooks, onExit } = await mount("o4", {
      recorderState: "recording",
      stopRecording,
    });
    await tap(header(), strings.goToChapter("2:1-4"));
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    const crumb = button(header(), strings.goToChapter("2:1-4"));
    const bookCrumb = button(header(), strings.goToBook("Book Mine"));
    expect(button(header(), strings.closeRecorder).disabled).toBe(true);
    expect(crumb.disabled).toBe(true);
    expect(bookCrumb.disabled).toBe(true);
    await act(async () => crumb.click());
    await act(async () => bookCrumb.click());
    expect(onRequestBack).toHaveBeenCalledTimes(1);
    expect(onRequestBackToBooks).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("shows a renamed chapter's typed name in the chapter chip (#1230)", async () => {
    await mount("o4");
    expect(crumbs(header())).toEqual([
      { text: "Book Mine", state: null },
      { text: "2:1-4", state: null }, // the name, not the number 1
      // Recorded but not marked finished (`view.finished: false`, audio
      // present): the same "recorded" tint `RecorderMenu`'s own O4SheetHead
      // derives for this state (recorder-menu.tsx).
      { text: "1", state: "recorded" },
    ]);
  });

  it("shows the default name for a chapter with no stored name (#1230)", async () => {
    recorderView.chapterName = null;
    await mount("o4");
    expect(crumbs(header())[1]).toEqual({
      text: strings.chapterName(1),
      state: null,
    });
  });

  it("exposes the chips to assistive tech: the only thing in the header naming the place", async () => {
    await mount("o4");
    const row = header().querySelector(".o4-crumbs")!;
    // Not hidden: `closeRecorder` names the action, not the take, so hiding
    // the chips would drop book/chapter/segment from the tree (George R2).
    expect(row.closest('[aria-hidden="true"]')).toBeNull();
    expect(header().querySelectorAll(".o4-crumbs")).toHaveLength(1);
    // So the chapter's name is what is spoken, as it is what is shown.
    expect(row.textContent).toContain("2:1-4");
    // The Back control is untouched by this fix: still there, still named.
    expect(() => button(header(), strings.closeRecorder)).not.toThrow();
  });

  it.each([["2:1-4"], [null]])(
    "agrees with the ⋮ menu's own crumbs, chip for chip, and the menu speaks the chapter (name %s)",
    async (name) => {
      recorderView.chapterName = name;
      await mount("o4");
      const headerCrumbs = crumbs(header());
      await tap(document, strings.recorderMenuOpen);
      const panel = document.querySelector(".menu-panel")!;
      expect(panel).not.toBeNull();
      expect(crumbs(panel)).toEqual(headerCrumbs);
      expect(spokenPlace(panel)).toBe(
        strings.recorderBreadcrumb(
          "Book Mine",
          strings.chapterHeading(name, 1),
          1,
          null
        )
      );
    }
  );

  it("keeps the current look's plain-text trail, resolving the renamed chapter's name (unchanged)", async () => {
    await mount("current");
    expect(header().querySelector(".o4-crumb")).toBeNull();
    expect(header().textContent).toContain("Book Mine > 2:1-4 > 1");
  });

  it("sets a typed name's direction on the chips, the menu's head and its spoken place, not on the segment number (#1267)", async () => {
    recorderView.chapterName = "שלום.";
    await mount("o4");
    const dirs = (scope: ParentNode) =>
      [...scope.querySelectorAll(".o4-crumb > span")].map((el) =>
        el.getAttribute("dir")
      );
    expect(dirs(header())).toEqual(["auto", "auto", null]);
    await tap(document, strings.recorderMenuOpen);
    const panel = document.querySelector(".menu-panel")!;
    expect(dirs(panel)).toEqual(["auto", "auto", null]);
    expect(panel.querySelector(".o4-sheet-place")?.getAttribute("dir")).toBe(
      "auto"
    );
  });

  it("current look: the trail's span sets its direction (#1267)", async () => {
    await mount("current");
    const trail = [...header().querySelectorAll("span")].find((el) =>
      el.textContent?.includes("Book Mine > ")
    );
    expect(trail?.getAttribute("dir")).toBe("auto");
  });
});

describe("the segments header (#1105)", () => {
  const recorded: SegmentRow = {
    segmentId: "segment-1" as SegmentId,
    ordinal: 1,
    label: null,
    hasClip: true,
    finished: false,
    clipId: "clip-1" as ClipId,
    peaks: null,
    durationMs: 1000,
  };

  const layers = new Map<string, Layer>();
  const audio = {
    error: null,
    playingId: null,
    playbackElapsedMs: 0,
  } as UseAudioSession;
  const erase = restingErase();

  async function mount(look: Design, onBack = vi.fn()) {
    design.current = look;
    segmentsMocks.rows = [recorded];
    layers.clear();
    await act(async () =>
      root.render(
        createElement(SegmentsScreen, {
          chapterId: "chapter" as ChapterId,
          audio,
          erase,
          onBack,
          onOpenRecorder: vi.fn(),
          pushLayer: (layer: Layer) => layers.set(layer.id, layer),
          popLayer: (id: string) => {
            layers.delete(id);
          },
        })
      )
    );
    return onBack;
  }

  function breadcrumbButton(): HTMLButtonElement {
    const found =
      header().querySelector<HTMLButtonElement>("button.breadcrumb");
    expect(found, "the breadcrumb button").not.toBeNull();
    return found!;
  }

  it("shows a renamed chapter's typed name in the chapter chip (#1230)", async () => {
    await mount("o4");
    expect(crumbs(header())).toEqual([
      { text: "Book Mine", state: null },
      { text: "2:1-4", state: null },
    ]);
  });

  it("shows the default name for a chapter with no stored name (#1230)", async () => {
    segmentsMocks.chapterName = null;
    await mount("o4");
    expect(crumbs(header())[1]).toEqual({
      text: strings.chapterName(1),
      state: null,
    });
  });

  it("makes the book crumb a button to Books and the chapter crumb the current place (#1269)", async () => {
    await mount("o4");
    const chips = [...header().querySelectorAll(".o4-crumb")];
    expect(chips.map((el) => el.tagName)).toEqual(["BUTTON", "SPAN"]);
    // Named for where it goes, and holding the text it shows (WCAG 2.5.3).
    // Not `strings.backToBooks`: two controls with that name on one screen
    // broke every `getByRole(button, { name: "Back to books" })` lookup in
    // the e2e suite (#1105); the exact-name test below still guards it.
    expect(chips[0]!.getAttribute("aria-label")).toBe(
      strings.goToBook("Book Mine")
    );
    expect(chips[1]!.getAttribute("aria-current")).toBe("page");
    expect(chips[1]!.closest("button")).toBeNull();
    // The chips are exposed now, since the chapter chip is what names this
    // screen's chapter to assistive tech; the old look's Back button is gone.
    expect(
      header().querySelector('.o4-crumbs [aria-hidden="true"]')
    ).toBeNull();
    expect(
      header().querySelector(".o4-crumbs")!.closest('[aria-hidden="true"]')
    ).toBeNull();
    expect(header().querySelector("button.breadcrumb")).toBeNull();
  });

  it("runs the header's own Back when the book crumb is tapped (#1269)", async () => {
    const onBack = await mount("o4");
    await tap(header(), strings.goToBook("Book Mine"));
    expect(onBack).toHaveBeenCalledTimes(1);
    // The same handler the Back control runs, not a second exit.
    await act(async () =>
      header()
        .querySelector<HTMLButtonElement>('button[title="Back to books"]')!
        .click()
    );
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("puts the book crumb out of reach with the rest of the header while an overlay is up (#1269)", async () => {
    await mount("o4");
    await tap(document, strings.chapterMenuOpen);
    expect(document.querySelector(".menu-panel")).not.toBeNull();
    const book = button(header(), strings.goToBook("Book Mine"));
    expect(book.closest("[inert]")).toBe(header());
  });

  it("never shares an accessible name with the plain Back control beside it", async () => {
    await mount("o4");
    const named = (name: string) =>
      [...document.querySelectorAll("button")].filter(
        (el) => el.getAttribute("aria-label") === name
      );
    expect(named(strings.backToBooks)).toHaveLength(1);
    // Exact identity, not a loose negative: the ONE control named
    // "Back to books" is the plain Control, not the breadcrumb button.
    expect(named(strings.backToBooks)[0]).toBe(
      header().querySelector('button[title="Back to books"]')
    );
  });

  it.each([["2:1-4"], [null]])(
    "agrees with the chapter menu's own crumbs, chip for chip, and the menu speaks the chapter (name %s)",
    async (name) => {
      segmentsMocks.chapterName = name;
      await mount("o4");
      const headerCrumbs = crumbs(header());
      await tap(document, strings.chapterMenuOpen);
      const panel = document.querySelector(".menu-panel")!;
      expect(panel).not.toBeNull();
      expect(crumbs(panel)).toEqual(headerCrumbs);
      expect(spokenPlace(panel)).toBe(
        strings.chapterBreadcrumb("Book Mine", strings.chapterHeading(name, 1))
      );
    }
  );

  it.each([["2:1-4"], [null]])(
    "names the chapter the same way in a segment's own menu (name %s)",
    async (name) => {
      segmentsMocks.chapterName = name;
      await mount("o4");
      const headerCrumbs = crumbs(header());
      await tap(document, strings.segmentMenu(1));
      const panel = document.querySelector(".menu-panel")!;
      expect(panel).not.toBeNull();
      // Book and chapter as the header shows them, then the segment.
      expect(crumbs(panel).slice(0, 2)).toEqual(headerCrumbs);
      expect(spokenPlace(panel)).toBe(
        strings.recorderBreadcrumb(
          "Book Mine",
          strings.chapterHeading(name, 1),
          1,
          null
        )
      );
    }
  );

  it("keeps the current look's plain-text trail and implicit accessible name (unchanged)", async () => {
    await mount("current");
    expect(header().querySelector(".o4-crumb")).toBeNull();
    const btn = breadcrumbButton();
    expect(btn.getAttribute("aria-label")).toBeNull();
    expect(btn.textContent).toBe(
      strings.chapterBreadcrumb("Book Mine", "2:1-4")
    );
  });

  it("sets the direction of the name chips, and of the current look's trail (#1267)", async () => {
    await mount("o4");
    expect(
      [...header().querySelectorAll(".o4-crumb > span")].map((el) =>
        el.getAttribute("dir")
      )
    ).toEqual(["auto", "auto"]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("current");
    expect(breadcrumbButton().querySelector("span")?.getAttribute("dir")).toBe(
      "auto"
    );
  });
});

describe("a linked crumb, the #1274 Lows (#1278)", () => {
  // No caller passes both today; the next one that does must not ship a
  // control that looks current and navigates with the marker gone.
  it("keeps aria-current on a crumb that is both current and linked", async () => {
    await act(async () =>
      root.render(
        createElement(O4Crumbs, {
          book: "Book Mine",
          chapter: "2:1-4",
          links: { chapter: { label: "Go to 2:1-4", onClick: vi.fn() } },
          current: "chapter",
        })
      )
    );
    const chip = button(container, "Go to 2:1-4");
    expect(chip.getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  // A WebKit button keeps its native look unless the author turns it off;
  // the transparent background and no border do not reset `appearance`.
  // This reads the rule; a WKWebView on a phone is what would show it.
  it("drops the native button look on a linked crumb, WebKit prefix included", () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, "..", "src/app/styles/o4/menus.css"),
      "utf8"
    );
    const rule = cssRule(css, '[data-design="o4"] button.o4-crumb');
    expect(declarationValue(rule, "appearance")).toBe("none");
    expect(declarationValue(rule, "-webkit-appearance")).toBe("none");
  });
});
