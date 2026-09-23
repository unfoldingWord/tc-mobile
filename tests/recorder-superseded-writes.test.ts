// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import type { SegmentId } from "@/types/domain";
import { strings } from "@/lib/i18n/strings";

const boundary = vi.hoisted(() => ({
  setFinished: vi.fn().mockResolvedValue(undefined),
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
// Supply pending editor work at the hook boundary; the component's event,
// capture classifier, close planner and persistence wiring all run unchanged.
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
  boundary.setFinished.mockClear();
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
  vi.unstubAllGlobals();
});

async function setup() {
  const ref = createRef<RecorderHandle>();
  const saveEditedSegment = vi.fn().mockResolvedValue(true);
  const saveRecording = vi.fn().mockResolvedValue(true);
  const onExit = vi.fn();
  const audio: { -readonly [K in keyof UseAudioSession]: UseAudioSession[K] } =
    {
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
      stopRecording: vi.fn(async () => {
        audio.recorderState = "idle";
        return { samples: null, blob: null, error: null };
      }),
      retryDecode: vi.fn(),
      leave: vi.fn(),
      primeAudioContext: vi.fn(),
      readLevel: () => 0,
      readMeterAvailable: () => true,
      readScope: () => null,
      peekScope: () => null,
    };
  const render = async () =>
    act(async () =>
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
  const click = async (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label
      );
      expect(button, label).toBeDefined();
      button!.click();
    });
  await render();
  return {
    ref,
    audio,
    render,
    click,
    saveEditedSegment,
    saveRecording,
    onExit,
  };
}

it.each(["edit", "clear", "finished"])(
  "withholds pending %s after Edit stops a superseded capture and idle Back follows",
  async (kind) => {
    const s = await setup();
    if (kind === "finished") {
      await s.click(strings.recorderMenuOpen);
      await s.click(strings.markFinished(1));
      await act(async () => {
        await s.ref.current!.requestClose();
      });
    } else {
      const working =
        kind === "clear" ? new Int16Array(0) : original.subarray(1);
      boundary.editor = {
        ...boundary.editor,
        hasEdits: true,
        working,
        workingLength: working.length,
      };
    }
    s.audio.recorderState = "recording";
    await s.render();
    await s.click(strings.enterEdit);
    expect(s.audio.stopRecording).toHaveBeenCalledOnce();
    await s.render();
    await act(async () => {
      await s.ref.current!.requestClose();
    });
    expect(s.onExit).toHaveBeenCalledOnce();
    expect(s.saveRecording).not.toHaveBeenCalled();
    expect(s.saveEditedSegment).not.toHaveBeenCalled();
    expect(boundary.setFinished).not.toHaveBeenCalled();
  }
);

it("still saves an ordinary idle edit", async () => {
  const s = await setup();
  boundary.editor = { ...boundary.editor, hasEdits: true };
  await s.render();
  await act(async () => {
    await s.ref.current!.requestClose();
  });
  expect(s.saveEditedSegment).toHaveBeenCalledWith("segment", original, false);
});

it("commits a fresh capture after supersession and restores later idle writes", async () => {
  const s = await setup();
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.enterEdit);
  await s.render();
  const fresh = new Int16Array([5, 6]);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: fresh, blob: null, error: null };
  });
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.enterEdit);
  expect(s.saveRecording).toHaveBeenCalledWith(
    "segment",
    original,
    fresh,
    0,
    false
  );
  boundary.editor = { ...boundary.editor, hasEdits: true };
  await s.render();
  await act(async () => {
    await s.ref.current!.requestClose();
  });
  expect(s.saveEditedSegment).toHaveBeenCalledOnce();
});

it("does not release withheld edits for a subsequent empty capture", async () => {
  const s = await setup();
  boundary.editor = { ...boundary.editor, hasEdits: true };
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.enterEdit);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return {
      samples: null,
      blob: null,
      error: "No sound was recorded. Try again.",
    };
  });
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.enterEdit);
  await s.render();
  await act(async () => {
    await s.ref.current!.requestClose();
  });
  expect(s.onExit).toHaveBeenCalledOnce();
  expect(s.saveEditedSegment).not.toHaveBeenCalled();
});

it.each(["discard", "retry"])(
  "keeps recovery ownership after supersession: %s",
  async (action) => {
    const s = await setup();
    boundary.editor = { ...boundary.editor, hasEdits: true };
    s.audio.recorderState = "recording";
    await s.render();
    await s.click(strings.enterEdit);
    s.audio.stopRecording = vi.fn(async () => {
      s.audio.recorderState = "idle";
      return { samples: null, blob: new Blob(["kept"]), error: null };
    });
    s.audio.recorderState = "recording";
    await s.render();
    await s.click(strings.enterEdit);
    await s.render();
    await act(async () => {
      expect(await s.ref.current!.requestClose()).toBe(false);
    });
    expect(s.onExit).not.toHaveBeenCalled();
    if (action === "discard") {
      await s.click(strings.takeRecoverDiscard);
      await s.click(strings.takeRecoverDiscardArmed);
      expect(s.saveEditedSegment).not.toHaveBeenCalled();
      expect(s.saveRecording).not.toHaveBeenCalled();
    } else {
      s.audio.retryDecode = vi
        .fn()
        .mockResolvedValue({ samples: new Int16Array([5, 6]), error: null });
      await s.click(strings.takeRecoverRetry);
      expect(s.saveRecording).toHaveBeenCalledOnce();
      await act(async () => {
        await s.ref.current!.requestClose();
      });
      expect(s.saveEditedSegment).toHaveBeenCalledOnce();
    }
    expect(s.onExit).toHaveBeenCalledOnce();
  }
);
