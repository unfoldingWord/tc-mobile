// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { SegmentsScreen } from "@/components/segments-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

/**
 * #1105: the top breadcrumb in the segments header and the recorder header
 * render the same chevron-chip markup the O4 menus already show
 * (`o4-crumbs.tsx`'s `O4SheetHead`).
 *
 * #1230: the header's CHAPTER chip shows the chapter's name — the typed one,
 * or the default "Chapter N" — resolved through `strings.chapterHeading`. The
 * requirements owner's decision on #1230 supersedes #1105's number-only
 * choice for these two headers. The menus' own sheet heads are not named in
 * that decision and still take the number, so the header and the menu agree
 * chip for chip on the book and the segment, and differ on the chapter chip.
 * The spoken name follows the visible chip: the recorder's chips are exposed
 * as they are, and the segments breadcrumb's `aria-label` is built from the
 * same resolved heading.
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

function header(): Element {
  const found = document.querySelector("header");
  expect(found, "a header").not.toBeNull();
  return found!;
}

describe("the recorder header (#1105)", () => {
  async function mount(look: Design) {
    design.current = look;
    const ref = createRef<RecorderHandle>();
    const audio: UseAudioSession = {
      playingId: null,
      playingBuffer: false,
      playbackElapsedMs: 0,
      playbackRanOut: false,
      recorderState: "idle",
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
      stopRecording: vi.fn(),
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
          erase: {
            erase: vi.fn(async () => "ok" as const),
            erasing: false,
            isErasing: () => false,
          },
          onExit: vi.fn(),
          onRequestBack: () => {
            void ref.current?.requestClose();
          },
        })
      )
    );
  }

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

  it("agrees with the ⋮ menu's own crumbs on the book and the segment", async () => {
    await mount("o4");
    const headerCrumbs = crumbs(header());
    await tap(document, strings.recorderMenuOpen);
    const panel = document.querySelector(".menu-panel")!;
    expect(panel).not.toBeNull();
    const menuCrumbs = crumbs(panel);
    expect(menuCrumbs).toHaveLength(3);
    expect(menuCrumbs[0]).toEqual(headerCrumbs[0]);
    expect(menuCrumbs[2]).toEqual(headerCrumbs[2]);
    // The chapter chip is the one #1230 changes, and only in the header: the
    // menu's sheet head is outside that decision and keeps the number.
    expect(menuCrumbs[1]).toEqual({ text: "1", state: null });
  });

  it("keeps the current look's plain-text trail, resolving the renamed chapter's name (unchanged)", async () => {
    await mount("current");
    expect(header().querySelector(".o4-crumb")).toBeNull();
    expect(header().textContent).toContain("Book Mine > 2:1-4 > 1");
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
  const erase = {
    erase: vi.fn(async () => "ok" as const),
    erasing: false,
    isErasing: () => false,
  };

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

  it("shows the default name for a chapter with no stored name, and names it (#1230)", async () => {
    segmentsMocks.chapterName = null;
    await mount("o4");
    expect(crumbs(header())[1]).toEqual({
      text: strings.chapterName(1),
      state: null,
    });
    expect(breadcrumbButton().getAttribute("aria-label")).toBe(
      strings.chapterBreadcrumb("Book Mine", strings.chapterName(1))
    );
  });

  it("keeps the breadcrumb an interactive Back control, with its own accessible name once its text is hidden", async () => {
    const onBack = await mount("o4");
    const btn = breadcrumbButton();
    expect(
      btn.querySelector(".o4-crumbs")?.closest('[aria-hidden="true"]')
    ).not.toBeNull();
    // The same `chapterBreadcrumb` trail shape — NOT `strings.backToBooks`. A first
    // version of this fix reused that string and put two controls named
    // "Back to books" on this one screen (the plain Control beside it, and
    // this button), which broke every `getByRole(button, { name:
    // "Back to books" })` lookup in the e2e suite with a strict-mode
    // ambiguity error — caught by CI, not by this file, until this guard
    // was added. The exact-name test below is the guard.
    // Built from the same resolved chapter name the visible chip shows, so
    // the spoken name names the chapter and the visible text sits inside it
    // (WCAG 2.5.3 label-in-name, George R2 on #1105; #1230).
    expect(btn.getAttribute("aria-label")).toBe(
      strings.chapterBreadcrumb("Book Mine", "2:1-4")
    );

    await act(async () => breadcrumbButton().click());
    expect(onBack).toHaveBeenCalledTimes(1);
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

  it("agrees with the chapter menu's own crumbs on the book", async () => {
    await mount("o4");
    const headerCrumbs = crumbs(header());
    await tap(document, strings.chapterMenuOpen);
    const panel = document.querySelector(".menu-panel")!;
    expect(panel).not.toBeNull();
    const menuCrumbs = crumbs(panel);
    expect(menuCrumbs).toHaveLength(2);
    expect(menuCrumbs[0]).toEqual(headerCrumbs[0]);
    // Outside #1230's decision: the menu's sheet head keeps the number.
    expect(menuCrumbs[1]).toEqual({ text: "1", state: null });
  });

  it("keeps the current look's plain-text trail and implicit accessible name (unchanged)", async () => {
    await mount("current");
    expect(header().querySelector(".o4-crumb")).toBeNull();
    const btn = breadcrumbButton();
    expect(btn.getAttribute("aria-label")).toBeNull();
    expect(btn.textContent).toBe(
      strings.chapterBreadcrumb("Book Mine", "2:1-4")
    );
  });
});
