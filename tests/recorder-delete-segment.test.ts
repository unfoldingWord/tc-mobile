// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

/**
 * The recorder ≡ menu's "Delete segment" entry (#590): opens the shared
 * confirm, and on confirm deletes the row and leaves the sheet to Segments —
 * unlike Erase (#592), which stays open over the emptied segment. This file
 * is the integration half of the three-part suite the coverage is spread
 * across: `tests/menu-row-state.test.ts` pins `deleteRowReason` in plain
 * Node, `tests/recorder-menu.test.ts` pins the row/props contract, and this
 * file mounts the real sheet against a mocked store call, the same shape
 * `tests/recorder-erase-back.test.ts` uses for Erase.
 *
 * `useDeleteSegment` is NOT mounted via a shared `Host` the way `erase` is in
 * that file — there is one entry point to this action today (see
 * `use-delete-segment.ts`'s own docblock), so the hook is called directly
 * inside `Recorder` and this file mocks the store call it wraps
 * (`@/lib/storage/books`'s `deleteSegment`) rather than standing up a second
 * caller to race against.
 */

const policy = vi.hoisted(() => ({ blocks: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/lib/nav/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nav/navigation")>();
  policy.blocks.mockImplementation(actual.overlayBlocksClose);
  policy.dismiss.mockImplementation(actual.overlayDismissal);
  return {
    ...actual,
    overlayBlocksClose: policy.blocks,
    overlayDismissal: policy.dismiss,
  };
});
const storage = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/books")>()),
  deleteSegment: storage.del,
}));
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 5,
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
// Paint/audio acquisition are outside this same-turn event regression, the
// same carve-out `recorder-erase-back.test.ts` makes.
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
  storage.del.mockReset();
  storage.del.mockResolvedValue([]);
  policy.blocks.mockClear();
  policy.dismiss.mockClear();
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
const dialog = () =>
  document.querySelector(
    `[aria-label="${strings.deleteSegmentConfirmTitle(5)}"]`
  );

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
    takeCap: { nearLimit: false, remainingMs: 20 * 60_000, reached: false },
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
  function Host() {
    const erase = useEraseSegment();
    return createElement(Recorder, {
      ref,
      segmentId: "segment" as SegmentId,
      audio,
      erase,
      saveRecording,
      saveEditedSegment,
      clipboard: null,
      onClipboardChange: vi.fn(),
      databaseUnreachable: false,
      onExit,
      onRequestBack: () => {
        void ref.current?.requestClose();
      },
    });
  }
  await act(async () => root.render(createElement(Host)));
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.deleteSegment).click());
  return { ref, onExit, saveRecording, saveEditedSegment };
}

it("opens the delete confirm, naming the segment, from the ≡ menu's Delete row", async () => {
  await setup();
  expect(dialog()).not.toBeNull();
  expect(storage.del).not.toHaveBeenCalled();
});

it("cancel closes the confirm and deletes nothing", async () => {
  const s = await setup();
  await act(async () => button(strings.eraseCancel).click());
  expect(dialog()).toBeNull();
  expect(storage.del).not.toHaveBeenCalled();
  expect(s.onExit).not.toHaveBeenCalled();
});

it("confirm deletes the segment and exits the sheet dirty, to Segments", async () => {
  const s = await setup();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(storage.del).toHaveBeenCalledWith("segment");
  // Unlike Erase (#592), which stays open over the emptied segment: there is
  // no row left to rebuild the sheet over, so the only correct
  // post-condition is leaving, dirty, so Segments reloads and shows the row
  // gone and the rest renumbered. `onExit(true)` is what App reads to unmount
  // this whole sheet — mirroring `onConfirmErase`'s own re-read-miss exit,
  // this component does not additionally clear `confirmOpen` on this path,
  // since the real caller (`App`) removes the entire tree on it.
  expect(s.onExit).toHaveBeenCalledWith(true);
});

it("a failed delete stays open, reports the failure, and does not exit", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  storage.del.mockRejectedValueOnce(new Error("boom"));
  const s = await setup();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  expect(storage.del).toHaveBeenCalledTimes(1);
  expect(s.onExit).not.toHaveBeenCalled();
  expect(dialog()).toBeNull();
  const notice = () =>
    [...document.querySelectorAll(".notice")].some(
      (el) => el.textContent === strings.deleteSegmentFailed
    );
  expect(notice()).toBe(true);
  consoleError.mockRestore();
});

it("maps a quota-exceeded rejection to the noRoom notice, not the generic one", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  storage.del.mockRejectedValueOnce(
    Object.assign(new Error("disk full"), { name: "QuotaExceededError" })
  );
  await setup();
  await act(async () => button(strings.deleteSegmentConfirm).click());
  const notice = (text: string) =>
    [...document.querySelectorAll(".notice")].some(
      (el) => el.textContent === text
    );
  expect(notice(strings.noRoom)).toBe(true);
  expect(notice(strings.deleteSegmentFailed)).toBe(false);
  consoleError.mockRestore();
});

it("keeps the confirm when Back arrives in the same turn as delete, before a render", async () => {
  let complete!: (value: unknown[]) => void;
  storage.del.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const s = await setup();
  await act(async () => {
    button(strings.deleteSegmentConfirm).click();
    // Deliberately no await/render between the delete event and the
    // imperative Back — the same regression shape
    // `recorder-erase-back.test.ts` pins for Erase.
    const closing = s.ref.current!.requestClose();
    expect(storage.del).toHaveBeenCalledOnce();
    expect(await closing).toBe(false);
    expect(policy.blocks).toHaveBeenLastCalledWith(false, true, true);
    expect(policy.dismiss).toHaveBeenLastCalledWith(false, true, true);
  });
  expect(dialog()).not.toBeNull();
  expect(s.onExit).not.toHaveBeenCalled();
  await act(async () => complete([]));
  // The delete's own completion is what exits the sheet.
  expect(s.onExit).toHaveBeenCalledWith(true);
});

it("dismisses a waiting confirm on Back, then permits ordinary idle Back", async () => {
  const s = await setup();
  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(false);
  });
  expect(dialog()).toBeNull();
  expect(storage.del).not.toHaveBeenCalled();
  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(true);
  });
  expect(s.onExit).toHaveBeenCalledOnce();
});
