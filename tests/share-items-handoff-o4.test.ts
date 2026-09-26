// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { SegmentsScreen } from "@/components/segments-screen";
import { bookShareItems, chapterShareItems } from "@/components/share-o4-view";
import { strings } from "@/lib/strings";
import type { Design } from "@/lib/design";
import type { ShareProgress } from "@/hooks/share-progress";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { BookCard, ChapterRow, SegmentRow } from "@/types/view";

/**
 * #1031 item 3: "the screens' `items` hand-off into ShareProgress isn't
 * covered by a test." `bookShareItems`/`chapterShareItems` themselves are
 * covered directly (`tests/share-o4-view.test.ts`, `tests/share-carry-keys.test.ts`),
 * and `shareO4View`'s chip logic given a manufactured `items` array is
 * covered too (`tests/share-progress-o4-render.test.ts`). What none of those
 * cover is the WIRING at the two call sites — `books-screen.tsx`'s
 * `items={shareMenuBook ? bookShareItems(shareMenuBook.chapters) : []}` and
 * `segments-screen.tsx`'s `items={chapterShareItems(rows)}` — that the real
 * screen hands the ACTUAL book's chapters, or the ACTUAL chapter's rows, in
 * order, into the chips a translator sees. This file mounts each real screen
 * (the `tests/books-share-overlay-delete-guard.test.ts` /
 * `tests/o4-menus-chapter-segment.test.ts` pattern), forces an "outcome:
 * sent" progress so `shareO4View`'s hand-off branch draws every chip with no
 * carried snapshot (share-o4-view.ts's `handedOver`), and reads the chips
 * straight out of the DOM (`.share-o4-chip`, `share-progress-panel.tsx`'s
 * `O4Chips`) rather than calling any helper directly — so a screen that wired
 * the wrong book, the wrong rows, or dropped `items` back to `[]` fails here
 * even though every other suite in the tree stays green.
 *
 * What this does NOT cover: the cascade, layout, or anything on a phone —
 * jsdom renders no boxes and no device has run this file.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const bookName = "Mark";
const bookChapterId = (n: number) =>
  `chapter-0000-4000-8000-00000000000${n}` as ChapterId;
// Three chapters, deliberately not all the same shape: 1 and 3 have a
// recorded take (goesOut), 2 does not (stays) — so the order AND the
// finished/stays split both have to survive the hand-off for this to pass.
const chapters: ChapterRow[] = [
  {
    chapterId: bookChapterId(1),
    number: 1,
    name: null,
    finishedCount: 1,
    totalCount: 1,
    recordedCount: 2,
  },
  {
    chapterId: bookChapterId(2),
    number: 2,
    name: null,
    finishedCount: 0,
    totalCount: 1,
    recordedCount: 0,
  },
  {
    chapterId: bookChapterId(3),
    number: 3,
    name: null,
    finishedCount: 1,
    totalCount: 1,
    recordedCount: 1,
  },
];
const shelf: BookCard[] = [{ bookId, name: bookName, chapters }];

const bookMocks = vi.hoisted(() => ({
  progress: { phase: "hidden" as const } as ShareProgress,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf,
    newBookPlaceholder: "Book 001",
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: vi.fn(),
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
    partialChapters: 0,
    progress: bookMocks.progress,
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/failure-log", () => ({ useFailureCount: () => 0 }));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

const segmentRow = (ordinal: number, hasClip: boolean): SegmentRow => ({
  segmentId: `segment-${ordinal}` as SegmentId,
  ordinal,
  label: null,
  hasClip,
  finished: false,
  clipId: hasClip ? (`clip-${ordinal}` as ClipId) : null,
  peaks: null,
  durationMs: hasClip ? 1000 : null,
});
// Same asymmetric shape as the Books case: segment 2 has no clip.
const rows: SegmentRow[] = [
  segmentRow(1, true),
  segmentRow(2, false),
  segmentRow(3, true),
];

const chapterMocks = vi.hoisted(() => ({
  progress: { phase: "hidden" as const } as ShareProgress,
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Mark",
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
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
    renameChapter: vi.fn(),
    renameSegment: vi.fn(async () => true),
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    progress: chapterMocks.progress,
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));

function chipShape(state: string, label: string | number) {
  return { state, label };
}

function readChips(): { state: string | null; label: string }[] {
  return [...document.querySelectorAll<HTMLElement>(".share-o4-chip")].map(
    (el) => ({
      state: el.getAttribute("data-chip"),
      label: el.textContent ?? "",
    })
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `expected exactly one button labelled "${label}"`).toHaveLength(
    1
  );
  return found[0]!;
}

describe("Books screen's Share Book items hand-off into ShareProgress (O4, #1031 item 3)", () => {
  let root: Root;
  const layers = new Map<string, Layer>();

  beforeEach(() => {
    bookMocks.progress = { phase: "outcome", settled: "sent", since: 0 };
    layers.clear();
    document.body.innerHTML = "<div id='root'></div>";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("draws one chip per chapter, in order, split finished/stays by that chapter's own recordedCount", async () => {
    await act(async () => {
      root.render(
        createElement(BooksScreen, {
          onOpenChapter: vi.fn(),
          pushLayer: (layer: Layer) => layers.set(layer.id, layer),
          popLayer: (id: string) => {
            layers.delete(id);
          },
        })
      );
    });
    // `shareMenuBook` (and so the `items` the overlay is handed) is resolved
    // from `shareMenuBookId`, set only once this book's ⋮ has been opened —
    // mirrors `tests/books-share-overlay-delete-guard.test.ts`.
    await act(async () => button(strings.bookMenuOpen(bookName)).click());

    const expected = bookShareItems(chapters).map((item) =>
      chipShape(item.goesOut ? "finished" : "stays", item.label)
    );
    const chips = readChips();
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.state)).toEqual(expected.map((c) => c.state));
    // A "finished" chip shows a check icon, not its number
    // (share-progress-panel.tsx); only the "stays" chip's own textContent
    // carries its label, chapter 2's.
    expect(chips[1]!.label).toBe("2");
    expect(
      document.querySelector(".share-o4-chips")?.getAttribute("aria-label")
    ).toBe(strings.shareItemsGoOut(2, 3));
  });
});

describe("Segments screen's Share Chapter items hand-off into ShareProgress (O4, #1031 item 3)", () => {
  const audio = {
    error: null,
    playingId: null,
    playingBuffer: false,
    playbackElapsedMs: 0,
  } as UseAudioSession;
  const erase = {
    erase: vi.fn(async () => "ok" as const),
    erasing: false,
    isErasing: () => false,
  };

  let root: Root;
  const layers = new Map<string, Layer>();

  beforeEach(() => {
    chapterMocks.progress = { phase: "outcome", settled: "sent", since: 0 };
    layers.clear();
    document.body.innerHTML = "<div id='root'></div>";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws one chip per segment, in order, split finished/stays by that segment's own hasClip", async () => {
    await act(async () => {
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
      );
    });

    const expected = chapterShareItems(rows).map((item) =>
      chipShape(item.goesOut ? "finished" : "stays", item.label)
    );
    const chips = readChips();
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.state)).toEqual(expected.map((c) => c.state));
    expect(chips[1]!.label).toBe("2");
    expect(
      document.querySelector(".share-o4-chips")?.getAttribute("aria-label")
    ).toBe(strings.shareItemsGoOut(2, 3));
  });
});
