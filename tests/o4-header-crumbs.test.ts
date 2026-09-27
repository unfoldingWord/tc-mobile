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
 * must render the same chevron-chip markup the O4 menus already show
 * (`o4-crumbs.tsx`'s `O4SheetHead`), and must agree with the menu on what
 * each crumb SAYS — not just how it looks.
 *
 * The bug report's root cause (evidence: `strings.ts`, `o4-crumbs.tsx`,
 * `docs/design/o4-design-system.md` §6 "Menus"): the pre-fix header read
 * `strings.chapterHeading(view.chapterName, view.chapterNumber)`, which
 * prefers a chapter's TYPED name once one is set (#264/#169); the menu's
 * `O4SheetHead` has only ever taken `chapter?: number` — "the chapter's
 * number, the second crumb (the workbench's `crumbs()`)" is that prop's own
 * docblock, unchanged since #949. A chapter renamed to "2:1-4" therefore read
 * "2:1-4" in the header and "1" (its actual ordinal) in the menu — not a
 * wrong-chapter bug, a title-vs-number disagreement. This file pins the
 * number as the one both paths now show, and that the header and the menu
 * render byte-for-byte the same `.o4-crumb` chips for the same chapter.
 *
 * The current (non-O4) look is asserted UNCHANGED: it still resolves and
 * shows the chapter's typed name through `chapterHeading`, in a plain text
 * trail, with no `.o4-crumb` anywhere — #1105 is an O4-only fix.
 *
 * What this does NOT cover: layout, the CSS cascade and truncation on a real
 * phone (jsdom has none of the three) — the claim it stands in for is that
 * the header renders the identical `.o4-crumb`/`.o4-crumbs` markup the menu
 * already ships under, so whatever the menu's own cascade does, the header's
 * now does too.
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
  chapterName: "2:1-4",
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
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Book Mine",
    bookCoverHex: "#11796d",
    chapterNumber: 1,
    // Reproduces the same renamed chapter as the recorder case above.
    chapterName: "2:1-4",
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

  it("shows the chapter's NUMBER in a chip, never the renamed chapter's typed name", async () => {
    await mount("o4");
    expect(crumbs(header())).toEqual([
      { text: "Book Mine", state: null },
      { text: "1", state: null }, // the number, not "2:1-4"
      // Recorded but not marked finished (`view.finished: false`, audio
      // present): the same "recorded" tint `RecorderMenu`'s own O4SheetHead
      // derives for this state (recorder-menu.tsx).
      { text: "1", state: "recorded" },
    ]);
    expect(header().textContent).not.toContain("2:1-4");
  });

  it("marks the chips aria-hidden, decoration on top of the Back control's own accessible name", async () => {
    await mount("o4");
    const row = header().querySelector(".o4-crumbs")!;
    expect(row.closest('[aria-hidden="true"]')).not.toBeNull();
    // The Back control is untouched by this fix: still there, still named.
    expect(() => button(header(), strings.closeRecorder)).not.toThrow();
  });

  it("agrees with the ≡ menu's own crumbs, chip for chip", async () => {
    await mount("o4");
    const headerCrumbs = crumbs(header());
    await tap(document, strings.recorderMenuOpen);
    const panel = document.querySelector(".menu-panel")!;
    expect(panel).not.toBeNull();
    expect(crumbs(panel)).toEqual(headerCrumbs);
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

  it("shows the chapter's NUMBER in a chip, never the renamed chapter's typed name", async () => {
    await mount("o4");
    expect(crumbs(header())).toEqual([
      { text: "Book Mine", state: null },
      { text: "1", state: null },
    ]);
    expect(header().textContent).not.toContain("2:1-4");
  });

  it("keeps the breadcrumb an interactive Back control, with its own accessible name once its text is hidden", async () => {
    const onBack = await mount("o4");
    const btn = breadcrumbButton();
    expect(
      btn.querySelector(".o4-crumbs")?.closest('[aria-hidden="true"]')
    ).not.toBeNull();
    // The SAME trail this button has always exposed (both looks rendered
    // identically here before #1105) — NOT `strings.backToBooks`. A first
    // version of this fix reused that string and put two controls named
    // "Back to books" on this one screen (the plain Control beside it, and
    // this button), which broke every `getByRole(button, { name:
    // "Back to books" })` lookup in the e2e suite with a strict-mode
    // ambiguity error — caught by CI, not by this file, until this guard
    // was added. The exact-name test below is the guard.
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

  it("agrees with the chapter menu's own crumbs, chip for chip", async () => {
    await mount("o4");
    const headerCrumbs = crumbs(header());
    await tap(document, strings.chapterMenuOpen);
    const panel = document.querySelector(".menu-panel")!;
    expect(panel).not.toBeNull();
    expect(crumbs(panel)).toEqual(headerCrumbs);
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
