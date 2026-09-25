// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

/**
 * #172 part 2: the in-sheet erase Notice must render `strings[erase.error]`,
 * never the fixed `strings.eraseFailed` for every key — a full disk gets the
 * `noRoom` sentence instead of the generic erase-failure copy (Frank's
 * advisory on #886, and the issue's own "the shared hook now emits `noRoom`
 * ... but the existing Recorder consumer still renders `strings.eraseFailed`
 * for every key" finding).
 *
 * Drives a REAL `useEraseSegment` (unmocked) through the actual confirm flow,
 * with only the underlying store call (`clearSegmentTake`) made to reject —
 * the same harness `tests/recorder-erase-back.test.ts` uses — so this proves
 * the mapping `recorder.tsx` itself does at render, not `performErase`'s
 * classification (that is `tests/use-erase-segment.test.ts`'s claim).
 */

const storage = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: storage.clear,
}));
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  samples: new Int16Array([1, 2, 3, 4]),
};
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn().mockResolvedValue(view),
    setFinished: vi.fn(),
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

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
  storage.clear.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
  expect(found, label).toBeDefined();
  return found!;
}

async function setup() {
  const ref = createRef<RecorderHandle>();
  const onExit = vi.fn();
  const saveRecording = vi.fn();
  const saveEditedSegment = vi.fn();
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
        saveRecording,
        saveEditedSegment,
        clipboard: null,
        onClipboardChange: vi.fn(),
        databaseUnreachable: false,
        onExit,
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.eraseSegment).click());
  return { ref, onExit, saveRecording, saveEditedSegment };
}

function noticeText(): string {
  return [...document.querySelectorAll(".notice")]
    .map((n) => n.textContent ?? "")
    .join(" ");
}

it("shows the no-room sentence for a quota-shaped erase failure, not the generic erase-failed copy", async () => {
  storage.clear.mockRejectedValue(
    Object.assign(new Error("the disk is full"), { name: "QuotaExceededError" })
  );
  await setup();

  await act(async () => button(strings.eraseConfirm).click());

  // The confirm drops on a "stay" failure (databaseUnreachable: false), so the
  // sheet's own Notice is what's left to read.
  expect(
    document.querySelector(`[aria-label="${strings.eraseConfirmTitle}"]`)
  ).toBeNull();
  const text = noticeText();
  expect(text).toContain(strings.noRoom);
  expect(text).not.toContain(strings.eraseFailed);
});

it("keeps the generic erase-failed copy for a non-quota erase failure", async () => {
  storage.clear.mockRejectedValue(
    new Error("UnknownError: Internal error opening backing store")
  );
  await setup();

  await act(async () => button(strings.eraseConfirm).click());

  const text = noticeText();
  expect(text).toContain(strings.eraseFailed);
  expect(text).not.toContain(strings.noRoom);
  expect(text).not.toContain("UnknownError");
});
