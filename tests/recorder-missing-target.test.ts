// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/components/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { performClearEditedSegment } from "@/hooks/use-save-take";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import { setSegmentFinished } from "@/lib/storage/takes";
import type { SegmentId } from "@/types/domain";

/**
 * The recorder's two no-capture close tails on a segment another live copy
 * deleted (#607): a cut-to-empty close (`clear`) and a Finished change
 * (`mark`).
 *
 * The store is real — fake-indexeddb with no row for `SEGMENT` — so the
 * `No such segment` rejection is the one `clearSegmentTake` and
 * `setSegmentFinished` actually throw, and the close plan, `failureExit` and
 * the component's effects run unchanged. What is replaced is the boundary:
 * `useRecorderSegment` (so the sheet has a loaded view to close), the editor
 * (so pending work can be supplied), and the App-level `saveEditedSegment`,
 * which is wired here straight to `performClearEditedSegment` — the function
 * `useSaveTake`'s empty-buffer branch returns. So this pins the sheet against
 * the real store outcome; it does not exercise `App`'s wrapper or the hook.
 */

const SEGMENT = "segment-deleted-by-another-copy" as SegmentId;

const boundary = vi.hoisted(() => ({
  setFinished: vi.fn(),
  editor: {} as SegmentEditor,
}));
const original = new Int16Array([1, 2, 3, 4]);
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: original.length,
  samples: original,
};
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn().mockResolvedValue(view),
    setFinished: boundary.setFinished,
  }),
}));
vi.mock("@/hooks/use-segment-editor", () => ({
  useSegmentEditor: () => boundary.editor,
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The real store write, against a database with no row for SEGMENT.
  boundary.setFinished.mockReset();
  boundary.setFinished.mockImplementation((finished: boolean) =>
    setSegmentFinished(SEGMENT, finished)
  );
  boundary.editor = {
    working: original,
    workingLength: original.length,
    peaks: null,
    hasEdits: false,
    selection: null,
    selectionActive: false,
    canCut: false,
    canPaste: false,
    canUndo: false,
    canRedo: false,
    error: false,
    openSelection: vi.fn(),
    closeSelection: vi.fn(),
    setSelection: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(
  saveEditedSegment: (
    segmentId: SegmentId,
    buffer: Int16Array,
    finished: boolean
  ) => Promise<boolean | "stale">
) {
  const ref = createRef<RecorderHandle>();
  const saveRecording = vi.fn().mockResolvedValue(true);
  const onExit = vi.fn();
  const onClipboardChange = vi.fn();
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
  const clipboard = new Int16Array([7, 8, 9]);
  await act(async () =>
    root.render(
      createElement(Recorder, {
        ref,
        segmentId: SEGMENT,
        audio,
        saveRecording,
        saveEditedSegment,
        clipboard,
        onClipboardChange,
        databaseUnreachable: false,
        onExit,
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  const click = async (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label
      );
      expect(button, label).toBeDefined();
      button!.click();
    });
  const close = async () => {
    let exited: boolean | undefined;
    await act(async () => {
      exited = await ref.current!.requestClose();
    });
    return exited;
  };
  return { click, close, onExit, onClipboardChange, saveRecording };
}

const cutToEmpty = () => {
  boundary.editor = {
    ...boundary.editor,
    hasEdits: true,
    working: new Int16Array(0),
    workingLength: 0,
  };
};

describe("recorder close on a segment another copy deleted (#607)", () => {
  it("leaves and asks for a re-read after a cut-to-empty close, with no retry copy", async () => {
    cutToEmpty();
    const s = await setup((id, buffer) =>
      buffer.length === 0
        ? performClearEditedSegment(id)
        : Promise.resolve(true)
    );

    expect(await s.close()).toBe(true);

    expect(s.onExit).toHaveBeenCalledExactlyOnceWith(true);
    expect(document.body.textContent).not.toContain(strings.clearFailed);
    // The cut phrase is App's, and leaving must not take it; nothing was
    // captured, so no take is handed to the never-lose slot either.
    expect(s.onClipboardChange).not.toHaveBeenCalled();
    expect(s.saveRecording).not.toHaveBeenCalled();
  });

  it("leaves and asks for a re-read after a Finished change, with no retry copy", async () => {
    const s = await setup(vi.fn().mockResolvedValue(true));
    await s.click(strings.recorderMenuOpen);
    await s.click(strings.markFinished(1));
    await s.click(strings.menuClose);

    expect(await s.close()).toBe(true);

    expect(boundary.setFinished).toHaveBeenCalledExactlyOnceWith(true);
    expect(s.onExit).toHaveBeenCalledExactlyOnceWith(true);
    expect(document.body.textContent).not.toContain(
      strings.finishedWriteFailed
    );
    expect(s.onClipboardChange).not.toHaveBeenCalled();
    expect(s.saveRecording).not.toHaveBeenCalled();
  });

  it("still stays with the retry copy when a clear fails for another reason", async () => {
    cutToEmpty();
    const s = await setup(vi.fn().mockResolvedValue(false));

    expect(await s.close()).toBe(false);

    expect(s.onExit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(strings.clearFailed);
  });

  it("still stays with the retry copy when a Finished write fails for another reason", async () => {
    boundary.setFinished.mockRejectedValue(new Error("QuotaExceededError"));
    const s = await setup(vi.fn().mockResolvedValue(true));
    await s.click(strings.recorderMenuOpen);
    await s.click(strings.markFinished(1));
    await s.click(strings.menuClose);

    expect(await s.close()).toBe(false);

    expect(s.onExit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(strings.finishedWriteFailed);
  });
});
