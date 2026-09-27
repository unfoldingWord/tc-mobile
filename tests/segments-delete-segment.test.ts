// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentsScreen } from "@/components/segments-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { ChapterId, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

// The app defaults to O4 (#951), so every case below exercises the O4 tile
// grid's Delete tile unless a case explicitly switches this to "current" —
// see the last case, which pins the CURRENT look's own Delete row wiring
// (`segment-row.tsx`'s non-O4 branch) does not silently share a mutation
// blind spot with the O4 tile above it.
const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

/**
 * Delete segment on the chapter view (#590, moved here from the recorder's ≡
 * menu by #1104 — the requirements owner's 2026-09-26 decision: "the menu
 * inside the segment editor (recorder) shows Erase only. Delete (removing the
 * whole segment) belongs to the chapter view.").
 *
 * This screen calls `useChapterSegments().deleteSegment` (PR1, #1059) rather
 * than the recorder-only `useDeleteSegment` hook the lane brief named: #1059's
 * own docblock built that op as "the Segments screen's own optimistic list
 * delete" and its test file (`tests/use-chapter-segments-delete.test.ts`)
 * says outright "the menu that would call this is a later PR; nothing here
 * mounts one" — this file is that later PR. Reusing it also avoids a second,
 * non-optimistic delete path now that the recorder no longer has one to
 * share a guard with (the standalone hook `hooks/use-delete-segment.ts` was
 * deleted in this same change, since #1104 left it with zero callers).
 *
 * Modelled on `tests/segments-erase-busy.test.ts` for the shared shape (a row
 * menu opening a confirm this screen owns), with `useChapterSegments` mocked
 * so `deleteSegment` can be made to resolve, reject its promise never (it
 * does not reject — see the hook's own docblock), or simply return `false`.
 */

const mocks = vi.hoisted(() => ({
  chapter: vi.fn(),
  deleteSegment: vi.fn(),
}));
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

let root: Root;
const row: SegmentRow = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
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
  design.current = "o4";
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
    renameSegment: vi.fn(),
    moveSegment: vi.fn(),
    eraseRow: vi.fn(),
    setFinished: vi.fn(),
    deleteSegment: mocks.deleteSegment,
  });
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Host() {
  const erase = useEraseSegment();
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
function queryButton(label: string) {
  return [...document.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === label
  );
}
async function openDeleteConfirm() {
  await act(async () => button(strings.segmentMenu(1)).click());
  await act(async () => button(strings.deleteSegment).click());
}
const failureNotice = () =>
  [...document.querySelectorAll(".notice")].some(
    (el) => el.textContent === strings.deleteSegmentFailed
  );
const dialogTitle = () =>
  document.querySelector(
    `[aria-label="${strings.deleteSegmentConfirmTitle(1)}"]`
  );

it("Cancel arms nothing — the row is untouched", async () => {
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  expect(dialogTitle()).not.toBeNull();
  await act(async () => button(strings.eraseCancel).click());
  expect(dialogTitle()).toBeNull();
  expect(mocks.deleteSegment).not.toHaveBeenCalled();
});

it("Confirm calls the store op and closes the dialog on success", async () => {
  mocks.deleteSegment.mockResolvedValueOnce(true);
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(mocks.deleteSegment).toHaveBeenCalledTimes(1);
  expect(mocks.deleteSegment).toHaveBeenCalledWith("segment");
  expect(dialogTitle()).toBeNull();
  expect(failureNotice()).toBe(false);
});

it("a failed delete keeps the row and reports through the screen's own Notice", async () => {
  // `useChapterSegments().deleteSegment` never rejects (its own docblock: a
  // real failure restores the row with its own `reload()` and reports to the
  // funnel, resolving `false`) — so this is the shape a real failure takes,
  // not a rejected promise.
  mocks.deleteSegment.mockResolvedValueOnce(false);
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(dialogTitle()).toBeNull();
  expect(failureNotice()).toBe(true);
  // The row survives: still in the mocked `rows`, so the store call above is
  // still reachable from a fresh menu open — a genuinely removed row would
  // have no menu button left to find.
  expect(queryButton(strings.segmentMenu(1))).toBeDefined();
});

it("one delete in flight at a time: Confirm disables while pending, and a second tap in the same turn does not call the store twice", async () => {
  let release!: (ok: boolean) => void;
  mocks.deleteSegment.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (release = resolve))
  );
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => {
    button(strings.deleteSegmentConfirm).click();
  });
  // Still open — the store call has not settled yet — and its own Confirm
  // button now refuses a second activation.
  expect(dialogTitle()).not.toBeNull();
  expect(button(strings.deleteSegmentConfirm).disabled).toBe(true);
  await act(async () => {
    release(true);
    await Promise.resolve();
  });
  expect(mocks.deleteSegment).toHaveBeenCalledTimes(1);
  expect(dialogTitle()).toBeNull();
});

it("Cancel hands focus back to the row it was armed for, not <body> (Frank r2 F2 on #1119)", async () => {
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => button(strings.eraseCancel).click());
  expect(dialogTitle()).toBeNull();
  const rowOpen = document.querySelector(".row-open");
  expect(rowOpen).not.toBeNull();
  expect(document.activeElement).toBe(rowOpen);
});

it("a landed delete hands focus to the row that takes its place, not <body> (Frank r3 on #1119)", async () => {
  const second: SegmentRow = {
    ...row,
    segmentId: "second" as SegmentId,
    ordinal: 2,
  };
  mocks.chapter.mockReturnValue({ ...mocks.chapter(), rows: [row, second] });
  mocks.deleteSegment.mockImplementationOnce(async () => {
    // The hook's own patch: the row goes, and the rest renumber.
    mocks.chapter.mockReturnValue({
      ...mocks.chapter(),
      rows: [{ ...second, ordinal: 1 }],
    });
    return true;
  });
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(dialogTitle()).toBeNull();
  const rowOpen = document.querySelector(".row-open");
  expect(rowOpen).not.toBeNull();
  expect(document.activeElement).toBe(rowOpen);
});

it("deleting the only segment hands focus to the empty chapter's invite (Frank r3 on #1119)", async () => {
  mocks.deleteSegment.mockImplementationOnce(async () => {
    mocks.chapter.mockReturnValue({ ...mocks.chapter(), rows: [] });
    return true;
  });
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(dialogTitle()).toBeNull();
  expect(document.activeElement).toBe(button(strings.addSegment));
});

it("the title keeps the armed ordinal while the optimistic patch has already removed the row (Frank r2 F3 on #1119)", async () => {
  let release!: (ok: boolean) => void;
  mocks.deleteSegment.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (release = resolve))
  );
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => {
    button(strings.deleteSegmentConfirm).click();
  });
  // The hook's optimistic patch: the row is gone from `rows` while the
  // store call is still pending and `busy` holds the dialog up.
  mocks.chapter.mockReturnValue({ ...mocks.chapter(), rows: [] });
  await act(async () => root.render(createElement(Host)));
  expect(dialogTitle()).not.toBeNull();
  expect(
    document.querySelector(
      `[aria-label="${strings.deleteSegmentConfirmTitle(0)}"]`
    )
  ).toBeNull();
  await act(async () => {
    release(true);
    await Promise.resolve();
  });
  expect(dialogTitle()).toBeNull();
});

it("wires the CURRENT look's own Delete row to the same confirm (not only the O4 tile above)", async () => {
  // Every case above runs O4 (the app's default, #951) end to end through
  // `strings.deleteSegment` — which is also the O4 tile's accessible name, so
  // a mutation in ONLY the current look's row (`segment-row.tsx`'s non-O4
  // branch) would pass every case above silently. This one forces the
  // current look and re-asks the one question that matters: does tapping
  // Delete there reach the same store call.
  design.current = "current";
  mocks.deleteSegment.mockResolvedValueOnce(true);
  await act(async () => root.render(createElement(Host)));
  await openDeleteConfirm();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(mocks.deleteSegment).toHaveBeenCalledTimes(1);
  expect(mocks.deleteSegment).toHaveBeenCalledWith("segment");
  expect(dialogTitle()).toBeNull();
});
