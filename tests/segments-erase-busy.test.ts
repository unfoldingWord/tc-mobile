// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import {
  useEraseSegment,
  type UseEraseSegment,
} from "@/hooks/use-erase-segment";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { ChapterId, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

/**
 * The Segments list's half of George's #660 finding: its erase-failed flag
 * must survive a retry the ONE shared hook refuses as "busy". The recorder's
 * half is in `tests/recorder-erase-back.test.ts`.
 */

const mocks = vi.hoisted(() => ({ chapter: vi.fn(), clear: vi.fn() }));
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
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: mocks.clear,
}));

let root: Root;
let shared: UseEraseSegment;
const row: SegmentRow = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  // No facilitator label (#591); the row reads as its ordinal alone, which is
  // all this suite's Erase gate cares about.
  label: null,
  hasClip: true,
  finished: false,
  clipId: null,
  peaks: null,
  durationMs: 1000,
};
const audio = {
  error: null,
  playingId: null,
  playingBuffer: false,
  playbackElapsedMs: 0,
} as UseAudioSession;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.chapter.mockReturnValue({
    bookName: "Book",
    chapterNumber: 1,
    chapterName: null,
    rows: [row],
    loading: false,
    loaded: true,
    refreshing: false,
    error: null,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: vi.fn(),
  });
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Host({ onErase }: { onErase: (erase: UseEraseSegment) => void }) {
  const erase = useEraseSegment();
  onErase(erase);
  return createElement(SegmentsScreen, {
    chapterId: "chapter" as ChapterId,
    audio,
    erase,
    onBack: vi.fn(),
    onOpenRecorder: vi.fn(),
    pushLayer: vi.fn(),
    popLayer: vi.fn(),
  });
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
async function openConfirm() {
  await act(async () => button(strings.segmentMenu(1)).click());
  await act(async () => button(strings.eraseSegment).click());
}
const notice = () =>
  [...document.querySelectorAll(".notice")].some(
    (el) => el.textContent === strings.eraseFailed
  );

it("keeps its own erase-failed Notice when a retry is refused as busy", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.clear.mockRejectedValueOnce(new Error("no space"));
  await act(async () =>
    root.render(createElement(Host, { onErase: (e) => (shared = e) }))
  );
  await openConfirm();
  await act(async () => button(strings.eraseConfirm).click());
  expect(notice()).toBe(true);

  await openConfirm();
  let release!: () => void;
  mocks.clear.mockImplementationOnce(
    () => new Promise<void>((resolve) => (release = resolve))
  );
  let held!: Promise<string>;
  await act(async () => {
    // Another caller takes the shared guard and this screen's retry lands in
    // the same turn, before a render passes `erasing` down to the confirm —
    // the window in which the hook itself answers "busy".
    held = shared.erase("other" as SegmentId);
    button(strings.eraseConfirm).click();
  });
  expect(mocks.clear).toHaveBeenCalledTimes(2);
  expect(mocks.clear).toHaveBeenLastCalledWith("other");
  expect(notice()).toBe(true);

  await act(async () => {
    release();
    await held;
  });
});
