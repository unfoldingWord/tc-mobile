// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { restingErase } from "./support";

/**
 * Hold-to-reveal on the Segments screen (S14, #1284), wired: the real
 * `SegmentsScreen` with `useChapterSegments` replaced at its boundary (the
 * `segments-reorder-o4` pattern). The one rule under test: a press on a name
 * is claimed only when that name is cut off, so a title that fits still lifts
 * its row for the reorder (#953) exactly as before.
 *
 * Layout is faked: jsdom has none, so `scrollWidth` and `clientWidth` are both
 * 0, which reads as "fits"; `cutOff` gives one name a wider content box than
 * its own box. What this cannot see: real touch, where the bubble lands on a
 * phone, and the cascade (`e2e/hold-reveal-name.spec.ts` covers the first
 * layout in a desktop browser).
 */

const LONG_TITLE =
  "The healing of the man with the withered hand on the Sabbath";
const LONG_CHAPTER = "Verses one through twenty-four read aloud together";

const mocks = vi.hoisted(() => ({ chapter: vi.fn() }));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: mocks.chapter,
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    ownsScreen: () => false,
    reset: () => {},
  }),
}));

function makeRow(i: number, extra: Partial<Row> = {}): Row {
  return {
    segmentId: `s${i}` as SegmentId,
    ordinal: i + 1,
    label: null,
    hasClip: true,
    finished: false,
    clipId: `c${i}` as ClipId,
    peaks: null,
    durationMs: 1000,
    ...extra,
  };
}

let root: Root;
let rows: Row[];
let chapterName: string | null;
let moveSegment: ReturnType<typeof vi.fn>;
let onOpenRecorder: ReturnType<
  typeof vi.fn<(segmentId: SegmentId, ordinal: number) => void>
>;

const erase = restingErase();
const audio = {
  error: null,
  playingId: null,
  playingBuffer: false,
  playbackElapsedMs: 0,
  playbackRanOut: false,
  playTake: vi.fn(),
  leave: vi.fn(),
  stopBuffer: vi.fn(),
} as unknown as UseAudioSession;

function chapterState() {
  return {
    bookName: "Book",
    chapterNumber: 1,
    chapterName,
    rows,
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(),
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    moveSegment,
  };
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 360,
    width: 360,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // The waveform captures the pointer at first touch; jsdom has no capture.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === "LI" && this.parentElement) {
        const i = [...this.parentElement.children].indexOf(this);
        return rect(i * 100, 90);
      }
      return rect(0, 700);
    }
  );
  chapterName = LONG_CHAPTER;
  rows = [
    makeRow(0, { label: LONG_TITLE }),
    makeRow(1, { label: "verses 5-6" }),
    makeRow(2),
  ];
  moveSegment = vi.fn(() => Promise.resolve(true));
  onOpenRecorder = vi.fn<(segmentId: SegmentId, ordinal: number) => void>();
  mocks.chapter.mockImplementation(chapterState);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        erase,
        onBack: vi.fn(),
        onOpenRecorder,
        pushLayer: vi.fn(),
        popLayer: vi.fn(),
      })
    )
  );
}

const items = () =>
  [...document.querySelectorAll("ul > li")].filter(
    (li) => li.querySelector(".row") !== null
  );
const rowTitle = (i: number) =>
  items()[i]!.querySelector<HTMLElement>(".row-title")!;
const chapterTitle = () =>
  document.querySelector<HTMLElement>(".segments-title")!;
const bubble = () => document.querySelector<HTMLElement>(".name-reveal");
const lifted = () => document.querySelector(".segments-item--lifted");

/** The ellipsis, as layout would report it: more content than room. */
function cutOff(el: HTMLElement) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: 420 });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 154 });
}

function pointer(el: Element | Window, type: string, init = {}) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 45,
      ...init,
    })
  );
}

async function hold(el: Element) {
  await act(async () => pointer(el, "pointerdown"));
  await act(async () => vi.advanceTimersByTime(450));
}

describe("a cut-off segment title (S14, #1284)", () => {
  it("held 450 ms shows the whole title in a bubble, and the row does not lift", async () => {
    await mount();
    cutOff(rowTitle(0));
    await act(async () => pointer(rowTitle(0), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(449));
    expect(bubble()).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(bubble()?.textContent).toBe(LONG_TITLE);
    expect(bubble()!.getAttribute("aria-hidden")).toBe("true");
    // Long after a reorder would have lifted, still nothing lifts.
    await act(async () => vi.advanceTimersByTime(1000));
    expect(lifted()).toBeNull();
    expect(moveSegment).not.toHaveBeenCalled();
  });

  it("the release puts the bubble away and opens nothing", async () => {
    await mount();
    cutOff(rowTitle(0));
    await hold(rowTitle(0));
    await act(async () => pointer(window, "pointerup"));
    expect(bubble()).toBeNull();
    expect(onOpenRecorder).not.toHaveBeenCalled();
    expect(lifted()).toBeNull();
  });
});

describe("a title that fits keeps the reorder hold (#953)", () => {
  it("a fitting segment title held 450 ms lifts its row, with no bubble", async () => {
    await mount();
    await hold(rowTitle(1));
    expect(bubble()).toBeNull();
    expect(items()[1]!.classList.contains("segments-item--lifted")).toBe(true);
  });

  it("the badge beside a cut-off title still lifts the row", async () => {
    await mount();
    cutOff(rowTitle(0));
    await hold(items()[0]!.querySelector(".row-open")!);
    expect(bubble()).toBeNull();
    expect(items()[0]!.classList.contains("segments-item--lifted")).toBe(true);
  });
});

describe("the chapter name (S14, #1284)", () => {
  it("a cut-off one held 450 ms shows the whole name", async () => {
    await mount();
    cutOff(chapterTitle());
    await hold(chapterTitle());
    expect(bubble()?.textContent).toBe(LONG_CHAPTER);
    await act(async () => pointer(window, "pointerup"));
    expect(bubble()).toBeNull();
  });

  it("one that fits shows nothing", async () => {
    await mount();
    await hold(chapterTitle());
    expect(bubble()).toBeNull();
  });
});

describe("the header crumbs (S14, #1284)", () => {
  /** The text span inside the header's `n`th crumb: book, then chapter. */
  const crumbText = (n: number) =>
    document
      .querySelector(".o4-crumbs-bar")!
      .querySelectorAll<HTMLElement>(".o4-crumb > span")[n]!;

  it("a cut-off chapter crumb held 450 ms shows the whole name", async () => {
    await mount();
    const text = crumbText(1);
    expect(text.textContent).toBe(LONG_CHAPTER);
    cutOff(text);
    await hold(text);
    expect(bubble()?.textContent).toBe(LONG_CHAPTER);
    await act(async () => pointer(window, "pointerup"));
    expect(bubble()).toBeNull();
  });

  it("a cut-off book crumb shows the whole name, and its release does not go back", async () => {
    const onBack = vi.fn();
    await act(async () =>
      root.render(
        createElement(SegmentsScreen, {
          chapterId: "chapter" as ChapterId,
          audio,
          erase,
          onBack,
          onOpenRecorder,
          pushLayer: vi.fn(),
          popLayer: vi.fn(),
        })
      )
    );
    const text = crumbText(0);
    expect(text.textContent).toBe("Book");
    cutOff(text);
    await hold(text);
    expect(bubble()?.textContent).toBe("Book");
    await act(async () => pointer(window, "pointerup"));
    await act(async () => text.click());
    expect(onBack).not.toHaveBeenCalled();
  });
});
