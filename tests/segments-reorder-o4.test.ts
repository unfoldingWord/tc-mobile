// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentRow } from "@/components/segment-row";
import { SegmentsScreen } from "@/components/segments-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { UseEraseSegment } from "@/hooks/use-erase-segment";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { render } from "./render";

/**
 * Press-and-hold reorder on the Segments list (#953 PR2a), wired: the real
 * `SegmentsScreen` and `SegmentRow`, with `useChapterSegments` and
 * `useDesign` replaced at their boundary (the `segments-erase-preview-o4`
 * pattern), so these cases are about the call sites — that the hold starts
 * only on the badge and title, that the O4 switch gates it, and that the one
 * `moveSegment` call happens on the drop and nowhere else.
 *
 * Layout is faked: jsdom has none, so each `<li>` reports a 90px row at a
 * 100px pitch and the list reports a 700px viewport. What this cannot see:
 * real touch panning (whether `preventDefault` on `touchmove` holds a lifted
 * row on a phone), the cascade (whether `o4/segments.css` paints the lift),
 * and anything on a device.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

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
let moveSegment: ReturnType<typeof vi.fn>;
let onOpenRecorder: ReturnType<
  typeof vi.fn<(segmentId: SegmentId, ordinal: number) => void>
>;

const erase = {
  erasing: false,
  isErasing: () => false,
  erase: vi.fn(),
} as unknown as UseEraseSegment;
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
  design.current = "o4";
  rows = [makeRow(0), makeRow(1), makeRow(2, { label: "verses 5-6" })];
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

// Both looks: the O4 list's class is itself O4-only.
const items = () =>
  [...document.querySelectorAll("ul > li")].filter(
    (li) => li.querySelector(".row") !== null
  );
const badge = (i: number) =>
  items()[i]!.querySelector<HTMLButtonElement>(".row-open")!;
const liveText = () =>
  document.querySelector('[data-reorder-status][role="status"]')?.textContent ??
  null;

function pointer(
  el: Element,
  type: string,
  y: number,
  init: PointerEventInit = {}
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: y,
      ...init,
    })
  );
}

async function hold(el: Element, y: number) {
  await act(async () => pointer(el, "pointerdown", y));
  await act(async () => vi.advanceTimersByTime(450));
}

describe("the O4 hold area (#953 PR2a, DRI pick: badge and title)", () => {
  it("lifts a row held 450 ms on its badge, and announces it", async () => {
    await mount();
    await act(async () => pointer(badge(0), "pointerdown", 45));
    await act(async () => vi.advanceTimersByTime(449));
    expect(items()[0]!.classList.contains("segments-item--lifted")).toBe(false);
    await act(async () => vi.advanceTimersByTime(1));
    expect(items()[0]!.classList.contains("segments-item--lifted")).toBe(true);
    expect(liveText()).toBe(strings.reorderLifted(1));
    expect(moveSegment).not.toHaveBeenCalled();
  });

  it("lifts a row held on its title line", async () => {
    await mount();
    const title = items()[2]!.querySelector(".row-title")!;
    await hold(title, 245);
    expect(items()[2]!.classList.contains("segments-item--lifted")).toBe(true);
  });

  it("never starts on the waveform or the row's buttons", async () => {
    await mount();
    const row = items()[0]!;
    const targets = [
      row.querySelector(".scrub")!,
      row.querySelector(".control--play")!,
      [...row.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === strings.segmentMenu(1)
      )!,
    ];
    for (const target of targets) {
      await hold(target, 45);
      await act(async () => pointer(target, "pointerup", 45));
      expect(document.querySelector(".segments-item--lifted")).toBeNull();
    }
    expect(moveSegment).not.toHaveBeenCalled();
  });

  it("leaves a plain tap on the badge opening the recorder", async () => {
    await mount();
    await act(async () => pointer(badge(1), "pointerdown", 145));
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => pointer(badge(1), "pointerup", 145));
    await act(async () => badge(1).click());
    expect(onOpenRecorder).toHaveBeenCalledWith("s1", 2);
    expect(moveSegment).not.toHaveBeenCalled();
  });
});

describe("the drag and the one write", () => {
  it("shifts the neighbours while dragging, writes nothing until the drop, then writes once", async () => {
    await mount();
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    const list = document.querySelector(".segments-list")!;
    expect(list.hasAttribute("data-reordering")).toBe(true);
    const shift = items().map((li) =>
      (li as HTMLElement).style.getPropertyValue("--reorder-y")
    );
    expect(shift).toEqual(["215px", "-100px", "-100px"]);
    expect(moveSegment).not.toHaveBeenCalled();

    await act(async () => pointer(badge(0), "pointerup", 260));
    expect(moveSegment).toHaveBeenCalledTimes(1);
    expect(moveSegment).toHaveBeenCalledWith("s0", 2);
    expect(liveText()).toBe(strings.reorderMoved(1, 3));
    expect(list.hasAttribute("data-reordering")).toBe(false);
  });

  it("swallows the release's click so a drop does not open the recorder", async () => {
    await mount();
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    await act(async () => pointer(badge(0), "pointerup", 260));
    await act(async () => badge(0).click());
    expect(onOpenRecorder).not.toHaveBeenCalled();
    // Only that one click, and only for a while: the badge taps again later.
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => badge(0).click());
    expect(onOpenRecorder).toHaveBeenCalledTimes(1);
  });

  it("holds the page still only once a row is lifted, and refuses a long press's context menu", async () => {
    await mount();
    const touchMove = () => {
      const ev = new Event("touchmove", { bubbles: true, cancelable: true });
      badge(0).dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const contextMenu = () => {
      const ev = new Event("contextmenu", { bubbles: true, cancelable: true });
      badge(0).dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    await act(async () => pointer(badge(0), "pointerdown", 45));
    // Before the lift a vertical move must stay a scroll.
    expect(touchMove()).toBe(false);
    expect(contextMenu()).toBe(true);
    await act(async () => vi.advanceTimersByTime(450));
    expect(touchMove()).toBe(true);
    await act(async () => pointer(badge(0), "pointerup", 45));
    // Once the gesture is over, nothing is held any more.
    expect(touchMove()).toBe(false);
    expect(contextMenu()).toBe(false);
  });

  it("writes nothing when dropped back in place", async () => {
    await mount();
    await hold(badge(1), 145);
    await act(async () => pointer(badge(1), "pointermove", 250));
    await act(async () => pointer(badge(1), "pointermove", 150));
    await act(async () => pointer(badge(1), "pointerup", 150));
    expect(moveSegment).not.toHaveBeenCalled();
    expect(liveText()).toBe(strings.reorderStayed(2));
    expect(document.querySelector(".segments-item--lifted")).toBeNull();
  });

  it("writes nothing on pointercancel, and puts the row back", async () => {
    await mount();
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    await act(async () => pointer(badge(0), "pointercancel", 260));
    await act(async () => pointer(badge(0), "pointerup", 260));
    expect(moveSegment).not.toHaveBeenCalled();
    expect(document.querySelector(".segments-item--lifted")).toBeNull();
    expect(
      items().map((li) =>
        (li as HTMLElement).style.getPropertyValue("--reorder-y")
      )
    ).toEqual(["", "", ""]);
  });

  it("cancels at 8px before the hold ends", async () => {
    await mount();
    await act(async () => pointer(badge(0), "pointerdown", 45));
    await act(async () => pointer(badge(0), "pointermove", 53));
    await act(async () => vi.advanceTimersByTime(450));
    expect(document.querySelector(".segments-item--lifted")).toBeNull();
  });

  it("cancels when the list scrolls before the lift", async () => {
    await mount();
    await act(async () => pointer(badge(0), "pointerdown", 45));
    await act(async () => {
      document
        .querySelector(".segments-body")!
        .dispatchEvent(new Event("scroll"));
    });
    await act(async () => vi.advanceTimersByTime(450));
    expect(document.querySelector(".segments-item--lifted")).toBeNull();
  });

  it("writes nothing when the screen goes away mid-drag", async () => {
    await mount();
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    await act(async () => root.unmount());
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, isPrimary: true })
    );
    expect(moveSegment).not.toHaveBeenCalled();
    root = createRoot(document.getElementById("root")!);
  });

  it("lets go without a write when the rows change under the finger", async () => {
    await mount();
    await hold(badge(0), 45);
    rows = [...rows, makeRow(3)];
    await mount();
    expect(document.querySelector(".segments-item--lifted")).toBeNull();
    await act(async () => pointer(badge(0), "pointerup", 260));
    expect(moveSegment).not.toHaveBeenCalled();
  });

  // Frank round 1 on #1057: a second pointer's position reached the cached
  // coordinates the scroll path re-submits as the first pointer's.
  it("ignores another pointer's moves, even when the list scrolls after them", async () => {
    await mount();
    await hold(badge(0), 45);
    await act(async () =>
      pointer(badge(0), "pointermove", 690, {
        pointerId: 2,
        isPrimary: false,
      })
    );
    await act(async () => {
      document
        .querySelector(".segments-body")!
        .dispatchEvent(new Event("scroll"));
    });
    await act(async () => pointer(badge(0), "pointerup", 45));
    expect(moveSegment).not.toHaveBeenCalled();
    expect(liveText()).toBe(strings.reorderStayed(1));
  });

  // Frank round 1 on #1057: the lifted row's transform grows the overflow,
  // so an unbounded auto-scroll ran on into blank space.
  it("stops the auto-scroll at the list's extent measured at the lift", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((run: FrameRequestCallback) => frames.push(run))
    );
    await mount();
    const body = document.querySelector<HTMLElement>(".segments-body")!;
    let scrollTop = 0;
    let scrollHeight = 1000;
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    Object.defineProperty(body, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(body, "clientHeight", {
      configurable: true,
      get: () => 700,
    });
    await hold(badge(2), 245);
    // Held within the bottom edge band, while the overflow grows under it.
    await act(async () => pointer(badge(2), "pointermove", 690));
    scrollHeight = 5000;
    for (let i = 0; i < 200 && frames.length > 0; i++) frames.shift()!(0);
    expect(scrollTop).toBeGreaterThan(0);
    expect(scrollTop).toBe(300);
  });

  // George round 1 on #1057: the live region kept "moved" after a write that
  // did not land and put the row back.
  it("says the row stayed when the write does not land", async () => {
    moveSegment = vi.fn(() => Promise.resolve(false));
    await mount();
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    await act(async () => pointer(badge(0), "pointerup", 260));
    expect(moveSegment).toHaveBeenCalledWith("s0", 2);
    expect(liveText()).toBe(strings.reorderStayed(1));
  });

  /** Drag row 0 to the end, then apply the hook's optimistic patch. */
  async function dragFirstToLast() {
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    await act(async () => pointer(badge(0), "pointerup", 260));
    rows = [
      { ...rows[1]!, ordinal: 1 },
      { ...rows[2]!, ordinal: 2 },
      { ...rows[0]!, ordinal: 3 },
    ];
    await mount();
  }

  it("hands focus to the moved row's open button when focus was nowhere (a touch drag)", async () => {
    await mount();
    expect(document.activeElement).toBe(document.body);
    await dragFirstToLast();
    expect(document.activeElement).toBe(badge(2));
    expect(badge(2).getAttribute("aria-label")).toBe(
      strings.editSegment(3, null)
    );
  });

  it("keeps focus that was on the moved row with that row", async () => {
    await mount();
    badge(0).focus();
    await dragFirstToLast();
    expect(document.activeElement).toBe(badge(2));
  });

  it("does not pull focus off another row", async () => {
    await mount();
    const play =
      items()[1]!.querySelector<HTMLButtonElement>(".control--play")!;
    play.focus();
    await dragFirstToLast();
    expect(document.activeElement).toBe(play);
  });
});

describe("the switch-off look does not gain the gesture", () => {
  it("renders no hold area and no live region, and a held badge lifts nothing", async () => {
    design.current = "current";
    await mount();
    expect(document.querySelector("[data-reorder-handle]")).toBeNull();
    expect(document.querySelector("[data-reorder-status]")).toBeNull();
    await hold(badge(0), 45);
    await act(async () => pointer(badge(0), "pointermove", 260));
    await act(async () => pointer(badge(0), "pointerup", 260));
    expect(document.querySelector(".segments-item--lifted")).toBeNull();
    expect(document.querySelector("[data-reordering]")).toBeNull();
    expect(moveSegment).not.toHaveBeenCalled();
  });

  it("marks only the badge and the title as the hold area in O4, and nothing in the current look", () => {
    const props = {
      row: makeRow(2, { label: "verses 5-6" }),
      playing: false,
      playbackElapsedMs: 0,
      onPlay: () => {},
      onOpenRecorder: () => {},
      onSetFinished: () => {},
      onErase: () => {},
      onRename: () => Promise.resolve(true),
      onHoldStart: () => {},
    };
    design.current = "o4";
    const o4 = render(createElement(SegmentRow, props));
    expect(
      [...o4.querySelectorAll("[data-reorder-handle]")].map(
        (el) => el.className
      )
    ).toEqual(["row-open", "row-title"]);
    expect(o4.querySelector(".scrub[data-reorder-handle]")).toBeNull();

    design.current = "current";
    const current = render(createElement(SegmentRow, props));
    expect(current.querySelector("[data-reorder-handle]")).toBeNull();
  });
});

describe("o4/segments.css: the lift (§3, §4)", () => {
  const code = readFileSync(
    path.resolve(import.meta.dirname, "../src/app/styles/o4/segments.css"),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const reduced = code.indexOf("@media (prefers-reduced-motion: reduce)");
  const main = code.slice(0, reduced === -1 ? code.length : reduced);
  const motion = reduced === -1 ? "" : code.slice(reduced);
  function decls(source: string, selector: string): string[] {
    const hits = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      m[1]!
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .includes(selector)
    );
    expect(hits, selector).toHaveLength(1);
    return hits[0]![2]!
      .split(";")
      .map((d) => d.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
  const O4 = '[data-design="o4"]';

  it("lifts the row at scale 1.03 on z 8 and slides the neighbours over 160 ms", () => {
    expect(
      decls(
        main,
        `${O4} .segments-list[data-reordering] > .segments-item--lifted`
      )
    ).toEqual(
      expect.arrayContaining([
        "z-index: 8",
        "transform: translateY(var(--reorder-y, 0px)) scale(1.03)",
        "transition: none",
      ])
    );
    expect(decls(main, `${O4} .segments-list[data-reordering] > li`)).toEqual(
      expect.arrayContaining([
        "transform: translateY(var(--reorder-y, 0px))",
        "transition: transform 160ms ease",
      ])
    );
  });

  it("drops the slide under reduced motion", () => {
    expect(reduced).toBeGreaterThan(0);
    expect(
      decls(motion, `${O4} .segments-list[data-reordering] > li`)
    ).toContain("transition: none");
  });
});
