// @vitest-environment jsdom
import { act, createElement, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import type { SegmentId } from "@/types/domain";

import { restingErase } from "./support";

/**
 * The recorder sheet's console-only sinks (the second set AGENTS.md named
 * under "What still ends at console.error") each write ONE failure-log row
 * under their own context, with the console line kept beside it.
 *
 * The sheet is mounted for real and only the boundary is replaced: the
 * segment loader, the editor, the audio session and `saveRecording` /
 * `saveEditedSegment`. `reportFailure` is the spy, so each case asserts the
 * context and the cause the funnel would receive.
 */

const SEGMENT = "segment" as SegmentId;

const boundary = vi.hoisted(() => ({
  setFinished: vi.fn(),
  report: vi.fn(),
  editor: {} as SegmentEditor,
}));
vi.mock("@/hooks/report-failure", () => ({
  reportFailure: boundary.report,
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
  boundary.report.mockReset();
  boundary.setFinished.mockReset();
  boundary.setFinished.mockResolvedValue(undefined);
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
    rollBackClipboard: vi.fn(),
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
  overrides: {
    stopRecording?: UseAudioSession["stopRecording"];
    retryDecode?: UseAudioSession["retryDecode"];
    saveRecording?: ComponentProps<typeof Recorder>["saveRecording"];
    saveEditedSegment?: ComponentProps<typeof Recorder>["saveEditedSegment"];
    recorderState?: UseAudioSession["recorderState"];
  } = {}
) {
  const ref = createRef<RecorderHandle>();
  const saveRecording =
    overrides.saveRecording ?? vi.fn().mockResolvedValue(true);
  const saveEditedSegment =
    overrides.saveEditedSegment ?? vi.fn().mockResolvedValue(true);
  const onExit = vi.fn();
  const audio: UseAudioSession = {
    playingId: null,
    playingBuffer: false,
    playbackElapsedMs: 0,
    playbackRanOut: false,
    recorderState: overrides.recorderState ?? "idle",
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
    stopRecording: overrides.stopRecording ?? vi.fn(),
    retryDecode: overrides.retryDecode ?? vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
    chapterPlay: {
      chapterId: null,
      status: "idle" as const,
      pausedFraction: null,
    },
    playChapter: () => {},
    pauseChapter: () => {},
    stopChapter: () => {},
    readChapterProgress: () => null,
  };
  await act(async () =>
    root.render(
      createElement(Recorder, {
        ref,
        segmentId: SEGMENT,
        audio,
        erase: restingErase(),
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
  const close = async () => {
    let exited: boolean | undefined;
    await act(async () => {
      exited = await ref.current!.requestClose();
    });
    return exited;
  };
  return { click, close, onExit, saveRecording, audio };
}

/** The one report this context wrote, or undefined; a second would fail `toHaveBeenCalledTimes`. */
const reportsFor = (context: string) =>
  boundary.report.mock.calls.filter((call) => call[1] === context);

describe("recorder commit nets report under their own context", () => {
  it('the Stop-commit net reports "recorder-commit-stop" and still exits', async () => {
    const cause = new Error("stop rejected");
    const s = await setup({
      recorderState: "recording",
      stopRecording: vi.fn().mockRejectedValue(cause),
    });
    await s.click(strings.stop);

    expect(reportsFor("recorder-commit-stop")).toEqual([
      [cause, "recorder-commit-stop"],
    ]);
    expect(s.onExit).toHaveBeenCalledOnce();
  });

  it('the close-commit net reports "recorder-commit-close" and still exits', async () => {
    const cause = new Error("stop rejected on close");
    const s = await setup({
      recorderState: "recording",
      stopRecording: vi.fn().mockRejectedValue(cause),
    });

    expect(await s.close()).toBe(true);

    expect(reportsFor("recorder-commit-close")).toEqual([
      [cause, "recorder-commit-close"],
    ]);
    expect(s.onExit).toHaveBeenCalledOnce();
  });

  it('the no-capture tail net reports "recorder-close-tail" and still exits', async () => {
    const cause = new Error("edit save rejected");
    boundary.editor = {
      ...boundary.editor,
      hasEdits: true,
      working: new Int16Array([5, 6]),
    };
    const s = await setup({
      saveEditedSegment: vi.fn().mockRejectedValue(cause),
    });

    expect(await s.close()).toBe(true);

    expect(reportsFor("recorder-close-tail")).toEqual([
      [cause, "recorder-close-tail"],
    ]);
    expect(s.onExit).toHaveBeenCalledOnce();
  });

  it('a refused Finished change reports "recorder-finished-flag" and stays open', async () => {
    const cause = new Error("QuotaExceededError");
    boundary.setFinished.mockRejectedValue(cause);
    const s = await setup();
    await s.click(strings.recorderMenuOpen);
    await s.click(strings.markFinished(1));
    await s.click(strings.menuClose);

    expect(await s.close()).toBe(false);

    expect(reportsFor("recorder-finished-flag")).toEqual([
      [cause, "recorder-finished-flag"],
    ]);
    expect(s.onExit).not.toHaveBeenCalled();
  });
});

describe("the recovery panel reports under its own contexts", () => {
  /** A Stop whose decode failed but whose bytes survive: the panel opens. */
  const held = () => ({
    stopRecording: vi.fn(async () => ({
      samples: null,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" }),
      error: null,
    })) as unknown as UseAudioSession["stopRecording"],
  });

  it('a thrown save on a recovered take reports "recorder-recovered-save" and keeps the take held', async () => {
    const cause = new Error("save rejected");
    const s = await setup({
      recorderState: "recording",
      ...held(),
      retryDecode: vi.fn().mockResolvedValue({
        samples: new Int16Array([9, 9]),
        error: null,
      }),
      saveRecording: vi.fn().mockRejectedValue(cause),
    });
    await s.click(strings.stop);
    await s.click(strings.takeRecoverRetry);

    expect(reportsFor("recorder-recovered-save")).toEqual([
      [cause, "recorder-recovered-save"],
    ]);
    expect(document.body.textContent).toContain(strings.takeRetryFailed);
    expect(s.onExit).not.toHaveBeenCalled();
  });

  it('a standing share refusal reports "recorder-recovered-share", a dismissal does not', async () => {
    const cause = new Error("share refused");
    const share = vi.fn().mockRejectedValueOnce(cause);
    vi.stubGlobal("navigator", {
      ...navigator,
      share,
      canShare: () => true,
    });
    const s = await setup({ recorderState: "recording", ...held() });
    await s.click(strings.stop);
    await s.click(strings.takeRecoverShare);

    expect(reportsFor("recorder-recovered-share")).toEqual([
      [cause, "recorder-recovered-share"],
    ]);
    expect(document.body.textContent).toContain(strings.takeShareFailed);

    // A dismissed sheet is not a failure and writes nothing.
    boundary.report.mockReset();
    share.mockRejectedValueOnce(new DOMException("dismissed", "AbortError"));
    await s.click(strings.takeRecoverShare);
    expect(boundary.report).not.toHaveBeenCalled();
  });
});
