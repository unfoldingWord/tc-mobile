// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { O4SheetHead } from "@/components/o4-crumbs";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

import { restingErase } from "./support";

/**
 * Hold a cut-off header crumb to read it whole (S14, #1284): the recorder
 * header's book and chapter crumbs, through the real `Recorder` with its
 * segment loader replaced at the boundary (the `o4-header-crumbs` pattern).
 * The same hold, the same bubble and the same rule as the Books and Segments
 * names: only a crumb that is actually cut off claims the press, and the
 * release's click is swallowed, so a hold never navigates.
 *
 * Layout is faked: jsdom has none, so `scrollWidth` and `clientWidth` are both
 * 0, which reads as "fits"; `cutOff` gives one crumb's text a wider content
 * box than its own box. The real ellipsis is `e2e/hold-reveal-name.spec.ts`.
 */

const LONG_BOOK = "The Complete Account Of The Long Journey Told In Full";
const LONG_CHAPTER = "Verses one through twenty-four read aloud together";

const recorderView = vi.hoisted(() => ({
  bookName: "",
  bookCoverHex: "#11796d",
  chapterNumber: 1,
  chapterTemplateNumber: null as number | null,
  chapterName: "" as string | null,
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

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
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
  recorderView.bookName = LONG_BOOK;
  recorderView.chapterName = LONG_CHAPTER;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const audio = {
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
  chapterPlay: {
    chapterId: null,
    status: "idle" as const,
    pausedFraction: null,
  },
  playChapter: () => {},
  pauseChapter: () => {},
  stopChapter: () => {},
  readChapterProgress: () => null,
} as unknown as UseAudioSession;

async function mountRecorder() {
  const ref = createRef<RecorderHandle>();
  const onRequestBack = vi.fn();
  const onRequestBackToBooks = vi.fn();
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
        onExit: vi.fn(),
        onRequestBack,
        onRequestBackToBooks,
      })
    )
  );
  return { onRequestBack, onRequestBackToBooks };
}

/** The text span inside the header's `n`th crumb. */
const crumbText = (n: number) =>
  document
    .querySelector("header")!
    .querySelectorAll<HTMLElement>(".o4-crumb > span")[n]!;
const bubble = () => document.querySelector<HTMLElement>(".name-reveal");

/** The ellipsis, as layout would report it: more content than room. */
function cutOff(el: HTMLElement) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: 420 });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 60 });
}

function pointer(el: Element | Window, type: string) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    })
  );
}

describe("the recorder header crumbs (S14, #1284)", () => {
  it("a cut-off book crumb held 450 ms shows the whole name, and the release does not navigate", async () => {
    const { onRequestBack, onRequestBackToBooks } = await mountRecorder();
    const text = crumbText(0);
    expect(text.textContent).toBe(LONG_BOOK);
    cutOff(text);
    await act(async () => pointer(text, "pointerdown"));
    await act(async () => vi.advanceTimersByTime(449));
    expect(bubble()).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(bubble()?.textContent).toBe(LONG_BOOK);
    expect(bubble()!.getAttribute("aria-hidden")).toBe("true");
    await act(async () => pointer(window, "pointerup"));
    expect(bubble()).toBeNull();
    // The click a real release lands on the crumb's button is swallowed.
    await act(async () => text.click());
    expect(onRequestBackToBooks).not.toHaveBeenCalled();
    expect(onRequestBack).not.toHaveBeenCalled();
  });

  it("a cut-off chapter crumb held 450 ms shows the whole name, and the release does not navigate", async () => {
    const { onRequestBack } = await mountRecorder();
    const text = crumbText(1);
    expect(text.textContent).toBe(LONG_CHAPTER);
    cutOff(text);
    await act(async () => pointer(text, "pointerdown"));
    await act(async () => vi.advanceTimersByTime(450));
    expect(bubble()?.textContent).toBe(LONG_CHAPTER);
    await act(async () => pointer(window, "pointerup"));
    await act(async () => text.click());
    expect(onRequestBack).not.toHaveBeenCalled();
  });

  it("a crumb that fits shows nothing, and a tap on it still navigates", async () => {
    const { onRequestBackToBooks } = await mountRecorder();
    const text = crumbText(0);
    await act(async () => pointer(text, "pointerdown"));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(bubble()).toBeNull();
    await act(async () => pointer(window, "pointerup"));
    await act(async () => text.click());
    expect(onRequestBackToBooks).toHaveBeenCalledTimes(1);
  });

  it("the whole name is already the crumb's accessible name", async () => {
    await mountRecorder();
    const book = crumbText(0).closest("button")!;
    const chapter = crumbText(1).closest("button")!;
    expect(book.getAttribute("aria-label")).toBe(`Go to book ${LONG_BOOK}`);
    expect(chapter.getAttribute("aria-label")).toBe(`Go to ${LONG_CHAPTER}`);
  });
});

describe("a menu's sheet head stays decoration (#1269)", () => {
  it("a cut-off crumb in a sheet head claims no press: the menu shows the name whole already", async () => {
    await act(async () =>
      root.render(
        createElement(O4SheetHead, { book: LONG_BOOK, chapter: LONG_CHAPTER })
      )
    );
    const text = container.querySelector<HTMLElement>(".o4-crumb > span")!;
    cutOff(text);
    await act(async () => pointer(text, "pointerdown"));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(bubble()).toBeNull();
  });
});
