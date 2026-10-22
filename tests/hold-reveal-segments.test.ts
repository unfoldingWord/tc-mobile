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
 * Touch-and-hold to read a cut-off segment title (#1284, S14), wired: the real
 * `SegmentsScreen` and `SegmentRow` with `useChapterSegments` replaced at its
 * boundary, the `segments-reorder-o4` pattern. These cases are about the call
 * site: a hold on a title the row has cut off shows the whole title and does
 * NOT lift the row; a hold on a title that fits still lifts it.
 *
 * jsdom computes no layout, so "cut off" is faked by defining `scrollWidth`
 * and `clientWidth` on the title element. What this cannot see: whether the
 * real stylesheet cuts the title, where the bubble lands, and a real finger.
 * `e2e/hold-reveal-name.spec.ts` runs those in Chromium.
 */

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

const LONG =
  "The long account of the sower, the seed and the four kinds of soil";

function makeRow(i: number, label: string | null): Row {
  return {
    segmentId: `s${i}` as SegmentId,
    ordinal: i + 1,
    label,
    hasClip: true,
    finished: false,
    clipId: `c${i}` as ClipId,
    peaks: null,
    durationMs: 1000,
  };
}

let root: Root;
let moveSegment: ReturnType<typeof vi.fn>;
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

function box(top: number, height: number): DOMRect {
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
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === "LI" && this.parentElement) {
        const i = [...this.parentElement.children].indexOf(this);
        return box(i * 100, 90);
      }
      return box(300, 22);
    }
  );
  moveSegment = vi.fn(() => Promise.resolve(true));
  const rows = [makeRow(0, LONG), makeRow(1, "short")];
  mocks.chapter.mockImplementation(() => ({
    bookName: "Book",
    chapterNumber: 1,
    chapterName: null,
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
  }));
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
        onOpenRecorder: vi.fn(),
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
const title = (i: number) => items()[i]!.querySelector(".row-title")!;
const bubble = () => document.querySelector(".name-reveal");

/** Make the element report a one-line name wider than its box (or not). */
function cutOff(el: Element, isCut: boolean) {
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    value: isCut ? 400 : 100,
  });
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: 100,
  });
}

function pointer(
  el: Element | Window,
  type: string,
  x = 20,
  y = 300,
  init: PointerEventInit = {}
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
      ...init,
    })
  );
}

const lifted = () => document.querySelector(".segments-item--lifted");

describe("hold a cut-off segment title to read it (#1284, S14)", () => {
  it("shows the whole title at 450 ms and puts it away on release, with no lift and no move", async () => {
    await mount();
    cutOff(title(0), true);
    await act(async () => pointer(title(0), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(449));
    expect(bubble()).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(bubble()?.textContent).toBe(LONG);
    // The hold did not also become the row's reorder lift.
    expect(lifted()).toBeNull();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(bubble()).not.toBeNull();
    await act(async () => pointer(window, "pointerup"));
    expect(bubble()).toBeNull();
    expect(lifted()).toBeNull();
    expect(moveSegment).not.toHaveBeenCalled();
  });

  it("puts the title away after the cap if the finger never lifts", async () => {
    await mount();
    cutOff(title(0), true);
    await act(async () => pointer(title(0), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(450));
    expect(bubble()).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(6000));
    expect(bubble()).toBeNull();
  });

  it("puts it away on a touch elsewhere and on Escape", async () => {
    await mount();
    cutOff(title(0), true);
    await act(async () => pointer(title(0), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(450));
    await act(async () =>
      pointer(document.body, "pointerdown", 5, 5, { pointerId: 2 })
    );
    expect(bubble()).toBeNull();

    await act(async () => pointer(title(0), "pointerdown"));
    await act(async () => vi.advanceTimersByTime(450));
    expect(bubble()).not.toBeNull();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(bubble()).toBeNull();
  });

  it("shows nothing when the finger moves 8 px or more before the hold (a scroll)", async () => {
    await mount();
    cutOff(title(0), true);
    await act(async () => pointer(title(0), "pointerdown", 20, 300));
    await act(async () => pointer(window, "pointermove", 20, 312));
    await act(async () => vi.advanceTimersByTime(600));
    expect(bubble()).toBeNull();
  });

  it("leaves a title that fits to the row's own hold: it lifts, and no bubble shows", async () => {
    await mount();
    cutOff(title(1), false);
    await act(async () => pointer(title(1), "pointerdown", 20, 145));
    await act(async () => vi.advanceTimersByTime(450));
    expect(bubble()).toBeNull();
    expect(items()[1]!.classList.contains("segments-item--lifted")).toBe(true);
  });

  it("needs no gesture for a screen reader: the open button carries the whole title and the visible line is hidden from it", async () => {
    await mount();
    const open = items()[0]!.querySelector(".row-open")!;
    expect(open.getAttribute("aria-label")).toContain(LONG);
    expect(title(0).getAttribute("aria-hidden")).toBe("true");
  });
});
