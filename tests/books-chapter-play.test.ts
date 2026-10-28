// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { CHAPTER_IDLE, type ChapterPlayState } from "@/hooks/chapter-player";
import type { Layer } from "@/lib/nav/layer-stack";
import { strings } from "@/lib/strings";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

import { idleChapterAudio } from "./chapter-audio";
import {
  areaScope,
  areaSelector,
  fileRules,
  selectorDeclarations,
} from "./o4-area-css";
import { cssRule, declarationValue } from "./support";

/**
 * The Books screen's chapter play control (#1469), mounted whole: the
 * promises here are about the composition. Where the control sits in the
 * row, which row shows which state, what a tap calls, and what leaves chapter
 * play standing down. The markup per state is
 * `tests/chapter-play-control.test.ts`; the cascade and layout are not
 * covered by jsdom (see the CSS pins at the bottom, and
 * `e2e/books-chapter-play.spec.ts` against the build).
 */

const mocks = vi.hoisted(() => ({
  shelf: [] as BookCard[],
  deleteBook: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: mocks.shelf,
    newBookNumber: 1,
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: mocks.deleteBook,
    deleting: false,
    isDeleting: () => false,
  }),
}));
vi.mock("@/hooks/use-book-share", () => ({
  useBookShare: () => ({
    status: "idle",
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    partialSegments: 0,
    progress: { phase: "hidden" },
    prepare: mocks.prepare,
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const bookId = (n: number) =>
  `book-0000-4000-8000-${String(n).padStart(12, "0")}` as BookId;
const chapterId = (b: number, n: number) =>
  `chapter-${b}-4000-8000-${String(n).padStart(12, "0")}` as ChapterId;

function chapter(
  b: number,
  n: number,
  extra: Partial<ChapterRow> = {}
): ChapterRow {
  return {
    chapterId: chapterId(b, n),
    number: n,
    templateNumber: null,
    name: null,
    finishedCount: 0,
    totalCount: 4,
    recordedCount: 2,
    ...extra,
  };
}

const mark: BookCard = {
  bookId: bookId(1),
  name: "Mark",
  number: 1,
  coverColourKey: null,
  licence: "CC-BY-SA-4.0",
  chapters: [chapter(1, 1), chapter(1, 2, { totalCount: 0, recordedCount: 0 })],
};
const ruth: BookCard = {
  bookId: bookId(2),
  name: "Ruth",
  number: 2,
  coverColourKey: null,
  chapters: [chapter(2, 1)],
};

let root: Root;
const layers = new Map<string, Layer>();
const onOpenChapter = vi.fn();

beforeEach(() => {
  layers.clear();
  mocks.deleteBook.mockReset();
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue(null);
  onOpenChapter.mockReset();
  mocks.shelf = [mark, ruth];
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function mount(audio = idleChapterAudio()) {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio,
        onOpenChapter,
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    );
  });
  return audio;
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}
const click = (label: string) => act(async () => button(label).click());
const openMark = () => click(strings.bookRow("Mark", 2, false));
const openRuth = () => click(strings.bookRow("Ruth", 1, false));

const H1 = strings.chapterName(1);
const state = (
  status: ChapterPlayState["status"],
  id: ChapterId,
  pausedFraction: number | null = null
): ChapterPlayState => ({ chapterId: id, status, pausedFraction });

describe("the control's place in the row", () => {
  it("is a sibling of the row button inside the li, not inside it", async () => {
    await mount();
    await openMark();
    const play = button(strings.playChapter(H1));
    const row = button(strings.openChapter(H1));
    expect(row.contains(play)).toBe(false);
    expect(play.closest("li")).toBe(row.closest("li"));
    expect(play.closest(".books-play")!.parentElement).toBe(row.parentElement);
  });

  it("leaves the row button's name, hold handle and tap-to-open alone", async () => {
    await mount();
    await openMark();
    const row = button(strings.openChapter(H1));
    expect(row.hasAttribute("data-reorder-handle")).toBe(true);
    await act(async () => row.click());
    expect(onOpenChapter).toHaveBeenCalledWith(chapterId(1, 1));
  });

  it("does not open the chapter when the control is tapped", async () => {
    await mount();
    await openMark();
    await click(strings.playChapter(H1));
    expect(onOpenChapter).not.toHaveBeenCalled();
  });
});

describe("what a tap calls", () => {
  it("plays the chapter from rest", async () => {
    const audio = await mount();
    await openMark();
    await click(strings.playChapter(H1));
    expect(audio.playChapter).toHaveBeenCalledWith(chapterId(1, 1));
    expect(audio.pauseChapter).not.toHaveBeenCalled();
  });

  it("pauses a chapter that is playing, and while it loads", async () => {
    for (const status of ["playing", "loading"] as const) {
      const audio = await mount(
        idleChapterAudio({ chapterPlay: state(status, chapterId(1, 1)) })
      );
      await openMark();
      await click(strings.pauseChapter(H1));
      expect(audio.pauseChapter).toHaveBeenCalledTimes(1);
      expect(audio.playChapter).not.toHaveBeenCalled();
      await act(async () => root.unmount());
      root = createRoot(document.getElementById("root")!);
    }
  });

  it("resumes a paused chapter by playing it again, and names the percent", async () => {
    const audio = await mount(
      idleChapterAudio({ chapterPlay: state("paused", chapterId(1, 1), 0.42) })
    );
    await openMark();
    await click(strings.resumeChapter(H1, 42));
    expect(audio.playChapter).toHaveBeenCalledWith(chapterId(1, 1));
  });

  it("does nothing for a chapter with no recording, and says why in its name", async () => {
    const audio = await mount();
    await openMark();
    const empty = button(strings.chapterNothingToPlay(strings.chapterName(2)));
    expect(empty.getAttribute("aria-disabled")).toBe("true");
    await act(async () => empty.click());
    expect(audio.playChapter).not.toHaveBeenCalled();
  });
});

describe("one row at a time", () => {
  it("shows every other row at rest while a chapter plays", async () => {
    await mount(
      idleChapterAudio({ chapterPlay: state("playing", chapterId(1, 1)) })
    );
    await openMark();
    await openRuth();
    const status = (label: string) =>
      button(label).closest(".books-play")!.getAttribute("data-status");
    expect(status(strings.pauseChapter(H1))).toBe("playing");
    // Ruth's chapter 1 is a different chapter: Play, at rest.
    const rests = [...document.querySelectorAll(".books-play")].filter(
      (el) => el.getAttribute("data-status") === "rest"
    );
    expect(rests).toHaveLength(2);
  });
});

describe("what ends chapter play", () => {
  it("collapsing the book that holds the playing chapter stops it", async () => {
    const audio = await mount(
      idleChapterAudio({ chapterPlay: state("playing", chapterId(1, 1)) })
    );
    await openMark();
    await click(strings.bookRow("Mark", 2, true));
    expect(audio.stopChapter).toHaveBeenCalledTimes(1);
  });

  it("collapsing another book leaves it playing", async () => {
    const audio = await mount(
      idleChapterAudio({ chapterPlay: state("playing", chapterId(1, 1)) })
    );
    await openMark();
    await openRuth();
    await click(strings.bookRow("Ruth", 1, true));
    expect(audio.stopChapter).not.toHaveBeenCalled();
  });

  it("starting a book share stops it", async () => {
    const audio = await mount(
      idleChapterAudio({ chapterPlay: state("paused", chapterId(1, 1), 0.3) })
    );
    await click(strings.bookMenuOpen("Mark"));
    await click(strings.shareBook);
    expect(mocks.prepare).toHaveBeenCalled();
    expect(audio.stopChapter).toHaveBeenCalledTimes(1);
  });

  it("deleting the book stops it", async () => {
    mocks.deleteBook.mockResolvedValue("ok");
    const audio = await mount(
      idleChapterAudio({ chapterPlay: state("playing", chapterId(1, 1)) })
    );
    await click(strings.bookMenuOpen("Mark"));
    await click(strings.deleteBook);
    await click(strings.deleteBookYes);
    expect(mocks.deleteBook).toHaveBeenCalled();
    expect(audio.stopChapter).toHaveBeenCalledTimes(1);
  });
});

describe("what a chapter's play says (#1344)", () => {
  // The player's state is the screen's prop, so a state change is a render
  // with the new state, the way `useChapterPlay` hands it down.
  const playing = state("playing", chapterId(1, 1));
  const paused = state("paused", chapterId(1, 1), 0.4);
  const failed = state("failed", chapterId(1, 1));
  const loading = state("loading", chapterId(1, 1));
  let audio = idleChapterAudio();
  const render = (chapterPlay: ChapterPlayState) =>
    act(async () => {
      audio = { ...audio, chapterPlay };
      root.render(
        createElement(BooksScreen, {
          audio,
          onOpenChapter,
          pushLayer: (layer: Layer) => layers.set(layer.id, layer),
          popLayer: (id: string) => {
            layers.delete(id);
          },
        })
      );
    });
  const region = () => {
    const found = document.querySelectorAll("[data-chapter-play-status]");
    expect(found).toHaveLength(1);
    return found[0]!;
  };
  beforeEach(() => {
    audio = idleChapterAudio();
  });

  it("is a polite status region mounted for the screen's life, empty at rest", async () => {
    await mount(audio);
    const live = region();
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
    // Not the reorder region: a move's line and a play's line do not
    // overwrite each other.
    expect(live.hasAttribute("data-reorder-status")).toBe(false);
    await render(loading);
    await render(playing);
    expect(region()).toBe(live);
  });

  it("says the chapter started, paused, started again and finished", async () => {
    await mount(audio);
    await openMark();
    await render(loading);
    // Still reading its playlist: nothing has sounded yet.
    expect(region().textContent).toBe("");
    await render(playing);
    expect(region().textContent).toBe(strings.chapterPlayStarted(H1));
    await render(paused);
    expect(region().textContent).toBe(strings.chapterPlayPaused(H1));
    await render(loading);
    await render(playing);
    expect(region().textContent).toBe(strings.chapterPlayStarted(H1));
    // The run reached its end on its own.
    await render(CHAPTER_IDLE);
    expect(region().textContent).toBe(strings.chapterPlayFinished(H1));
  });

  it("says a failed play with the control's own failed sentence", async () => {
    await mount(audio);
    await render(loading);
    await render(failed);
    expect(region().textContent).toBe(strings.chapterPlayFailed(H1));
  });

  it("says the chapter paused when the page hides it mid-play", async () => {
    // The hide path calls the player's pause; the screen sees the same
    // paused state a tap gives.
    await mount(audio);
    await render(playing);
    await render(paused);
    expect(region().textContent).toBe(strings.chapterPlayPaused(H1));
  });

  it("does not call a stop the screen asked for a finish", async () => {
    await mount(audio);
    await openMark();
    await render(playing);
    // Collapsing the book stops its chapter (`stopChapter`), then the
    // player goes idle.
    await click(strings.bookRow("Mark", 2, true));
    expect(audio.stopChapter).toHaveBeenCalledTimes(1);
    await render(CHAPTER_IDLE);
    // Nothing new is said: the region keeps the line it last said.
    expect(region().textContent).toBe(strings.chapterPlayStarted(H1));
    // A later run that ends on its own is still said.
    await render(loading);
    await render(playing);
    await render(CHAPTER_IDLE);
    expect(region().textContent).toBe(strings.chapterPlayFinished(H1));
  });

  it("names the chapter by its heading, a typed name included", async () => {
    mocks.shelf = [
      {
        ...mark,
        chapters: [
          chapter(1, 1, { name: "The sower" }),
          ...mark.chapters.slice(1),
        ],
      },
      ruth,
    ];
    await mount(audio);
    await render(playing);
    expect(region().textContent).toBe(
      strings.chapterPlayStarted(strings.chapterHeading("The sower", 1))
    );
  });

  it("names an unnamed template chapter by its template's number, not its slot (#1272, Q1 (b))", async () => {
    mocks.shelf = [
      {
        ...mark,
        chapters: [
          chapter(1, 1, { templateNumber: 7 }),
          ...mark.chapters.slice(1),
        ],
      },
      ruth,
    ];
    await mount(audio);
    await render(playing);
    expect(region().textContent).toBe(
      strings.chapterPlayStarted(strings.chapterName(7))
    );
  });
});

describe("the ring's loop", () => {
  let frame: ((t: number) => void) | null;
  let cancelled: number;
  beforeEach(() => {
    frame = null;
    cancelled = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      cancelled += 1;
      frame = null;
    });
  });

  const ring = () =>
    document.querySelector<HTMLElement>(
      ".books-play[data-status='playing'] .books-play-ring"
    );

  it("writes the pulled progress to the playing row's ring each frame", async () => {
    let progress = 0.25;
    await mount(
      idleChapterAudio({
        chapterPlay: state("playing", chapterId(1, 1)),
        readChapterProgress: () => progress,
      })
    );
    await openMark();
    // The first value is written before paint, not a frame later.
    expect(ring()!.style.getPropertyValue("--play-progress")).toBe("0.25");
    progress = 0.5;
    await act(async () => frame!(16));
    expect(ring()!.style.getPropertyValue("--play-progress")).toBe("0.5");
  });

  it("runs no loop for a row that is not playing", async () => {
    await mount();
    await openMark();
    expect(frame).toBeNull();
  });

  it("stops the loop when the row stops playing, and holds the fill while paused", async () => {
    const readChapterProgress = vi.fn(() => 0.6);
    await mount(
      idleChapterAudio({
        chapterPlay: state("playing", chapterId(1, 1)),
        readChapterProgress,
      })
    );
    await openMark();
    await act(async () => {
      root.render(
        createElement(BooksScreen, {
          audio: idleChapterAudio({
            chapterPlay: state("paused", chapterId(1, 1), 0.6),
            readChapterProgress,
          }),
          onOpenChapter,
          pushLayer: () => {},
          popLayer: () => {},
        })
      );
    });
    expect(cancelled).toBeGreaterThan(0);
    const calls = readChapterProgress.mock.calls.length;
    const paused = document.querySelector<HTMLElement>(
      ".books-play[data-status='paused'] .books-play-ring"
    )!;
    expect(paused.style.getPropertyValue("--play-progress")).toBe("0.6");
    expect(frame).toBeNull();
    expect(readChapterProgress.mock.calls.length).toBe(calls);
  });
});

describe("the stylesheet's promises (#1469)", () => {
  const css = areaScope("books");
  const sel = (selector: string) => areaSelector("books", selector);
  const value = (selector: string, property: string) =>
    declarationValue(cssRule(css, selector), property);

  it("fills the ring in the voice role over the empty-mark track", () => {
    const ring = value(sel(".books-play-ring"), "background");
    expect(ring).toContain("var(--s-voice)");
    expect(ring).toContain("var(--s-mark-empty)");
  });

  it("marks a failed play in the warn role", () => {
    expect(
      value(
        sel('.books-play[data-status="failed"] .books-play-ring'),
        "background"
      )
    ).toBe("var(--s-warn)");
  });

  it("keeps the guide, hear and primitive colours out of the control's rules", () => {
    // Every rule in the whole file, every nested block included, so a colour
    // moved into any of them is still read.
    const rules = fileRules("books").filter((r) =>
      r.selectors.some((s) => s.includes(".books-play"))
    );
    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const { body } of rules) {
      expect(body).not.toMatch(
        /--s-guide|--s-hear|var\(--p-(amber|cool|green|red|warn)/
      );
    }
  });

  it("places the control with logical properties and gives it 44px", () => {
    const box = cssRule(css, sel(".books-play"));
    expect(declarationValue(box, "inset-inline-end")).toMatch(/px$/);
    expect(declarationValue(box, "width")).toBe("44px");
    expect(declarationValue(box, "height")).toBe("44px");
    expect(declarationValue(box, "position")).toBe("absolute");
    // No physical side on the control, in any block of the file.
    for (const [property] of selectorDeclarations("books", sel(".books-play")))
      expect(property).not.toMatch(/\b(left|right)$/);
  });
});
