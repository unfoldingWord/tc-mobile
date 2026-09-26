// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/lib/strings";
import type { Design } from "@/lib/design";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { ChapterId, SegmentId } from "@/types/domain";
import type { Peaks } from "@/types/audio";
import type { SegmentRow } from "@/types/view";

/**
 * The segment Erase confirm's "Play what will be lost" row (#979 remainder,
 * after #1022 built the badge/button half). The workbench draws it as a
 * waveform plus a Play/Pause transport between the title and the two
 * buttons, on the O4 "13" dialog only — with the switch off the dialog is
 * unchanged (#979's own Done-when, restated for this half).
 *
 * This is the wiring test: `EraseConfirm`'s own `preview` prop is covered in
 * `tests/erase-confirm-preview.test.ts` (a bare, portalled mount, the
 * `erase-confirm-glyph.test.ts` pattern). Here the real `SegmentsScreen` is
 * mounted, with `useChapterSegments` and `useDesign` replaced at their
 * boundary (the `recorder-rerecord-o4.test.ts` pattern) and a real
 * `useEraseSegment`, so the assertions below are about the ACTUAL call site
 * in `segments-screen.tsx` — that `o4` gates the prop, that the row handed
 * in is the one armed, and that Play calls the real `SegmentsAudio.playTake`
 * seam segments-screen.tsx already had — not a re-statement of the component
 * test.
 *
 * What this cannot see: the cascade (whether `o4/dialogs.css` wins on a real
 * page), the drawn waveform bars (`Waveform`'s own canvas draw, mocked out
 * below the same way `recorder-rerecord-o4.test.ts` mocks it — jsdom has no
 * canvas 2D context), or anything on a phone.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

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

const peaks: Peaks = {
  min: new Float32Array([-0.5, -0.4]),
  max: new Float32Array([0.5, 0.4]),
  samplesPerBucket: 100,
};
const row: SegmentRow = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  label: null,
  hasClip: true,
  finished: false,
  clipId: null,
  peaks,
  durationMs: 2000,
};

/**
 * A mutable stand-in for the slice of `UseAudioSession` this suite needs
 * (`SegmentsAudio`'s own fields are all `readonly` on the real type, so a
 * test that flips `playingId` between cases needs its own, assignable
 * shape — cast to `UseAudioSession` only at the `SegmentsScreen` prop).
 */
interface MockAudio {
  error: string | null;
  playingId: SegmentId | null;
  playingBuffer: boolean;
  playbackElapsedMs: number;
  playbackRanOut: boolean;
  playTake: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  stopBuffer: ReturnType<typeof vi.fn>;
}

let root: Root;
let playTake: ReturnType<typeof vi.fn>;
let audio: MockAudio;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  design.current = "o4";
  playTake = vi.fn();
  audio = {
    error: null,
    playingId: null,
    playingBuffer: false,
    playbackElapsedMs: 0,
    playbackRanOut: false,
    playTake,
    leave: vi.fn(),
    stopBuffer: vi.fn(),
  };
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
    setFinished: vi.fn(),
    eraseRow: vi.fn(),
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
    audio: audio as unknown as UseAudioSession,
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
  await act(async () => root.render(createElement(Host)));
  await act(async () => button(strings.segmentMenu(1)).click());
  await act(async () => button(strings.eraseSegment).click());
}
const previewRow = () => document.querySelector(".confirm-preview");

describe("segments-screen.tsx's confirm preview wiring (#979 remainder)", () => {
  it("does not render the preview row with the switch off (unchanged)", async () => {
    design.current = "current";
    await openConfirm();
    expect(document.querySelector(".confirm-panel")).not.toBeNull();
    expect(previewRow()).toBeNull();
  });

  it("renders the armed row's preview, idle, with the switch on", async () => {
    await openConfirm();
    expect(previewRow()).not.toBeNull();
    expect(button(strings.eraseConfirmPreviewPlay)).not.toBeUndefined();
  });

  it("labels the row Pause when this segment is the one sounding", async () => {
    audio.playingId = row.segmentId;
    await openConfirm();
    expect(button(strings.eraseConfirmPreviewPause)).not.toBeUndefined();
  });

  it("toggles playback of the armed row from its start through the real seam", async () => {
    await openConfirm();
    await act(async () => button(strings.eraseConfirmPreviewPlay).click());
    expect(playTake).toHaveBeenCalledTimes(1);
    expect(playTake).toHaveBeenCalledWith(row, 0);
  });
});
