// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { UseEraseSegment } from "@/hooks/use-erase-segment";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import type { SegmentId } from "@/types/domain";
import { strings } from "@/lib/strings";

/**
 * #586 item 2. #585 added a `supersededCapture` ref latch in
 * `components/recorder.tsx`: a superseded Edit-commit stop sets it, and a
 * later no-capture exit (idle Back, held-take discard) reads it in
 * `executeTail` to withhold a pending edit/clear/Finished write against the
 * OLD take. The latch is reset to `false` only where a fresh commit lands and
 * the sheet STAYS mounted — a `take`-verdict Edit-commit, or a successful
 * recovery retry. There is no reset on `close()`'s own successful save-take
 * path, and #586 review recorded why that is fine: that path always calls
 * `onExit` and unmounts the sheet, so the ref (and any staleness in it) is
 * discarded with the component instance rather than surviving to a later
 * write in the same mount.
 *
 * This file pins THAT invariant only — a fresh, successful capture reaching
 * `close()` still saves and still exits even with the latch left stale
 * `true` from an earlier superseded stop in the same mount. It is a
 * regression pin on "a successful close-path save always exits", not a claim
 * that the latch is otherwise safe in every state; the withhold behaviour
 * itself is covered by `tests/recorder-superseded-writes.test.ts`.
 */

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
  // Resting erase: this suite never opens the confirm, but the sheet reads
  // `erase.isErasing` during render, so the prop cannot be absent (#160 L-12).
  const erase: UseEraseSegment = {
    erase: vi.fn(async () => "ok" as const),
    erasing: false,
    isErasing: () => false,
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
          erase,
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

it("still saves and exits on a fresh close-path capture after an earlier superseded Stop-commit left the latch stale", async () => {
  const s = await setup();

  // Set the latch stale-true: a Stop that yields nothing (samples/bytes/error
  // all null) classifies as `superseded` (`classifyCapture` in
  // `lib/takes/close-plan.ts`) and `commitTake` sets
  // `supersededCapture.current = true`. That verdict does not exit or enter
  // edit mode, so the sheet stays mounted with the latch left true — the
  // same trigger `recorder-superseded-writes.test.ts` uses for its withhold
  // cases. Driven through Stop, the one UI route into `commitTake` since #857
  // disabled Edit-entry during a take (#134's commit-then-edit arm went with
  // #871).
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.stop);
  expect(s.audio.stopRecording).toHaveBeenCalledOnce();
  expect(s.onExit).not.toHaveBeenCalled();
  await s.render();

  // A real capture is now in progress again and this exit reaches `close()`
  // directly (a Back tap mid-recording) rather than the Edit-entry path that
  // resets the latch on a `take` verdict. If the stale latch ever gated
  // close()'s own successful save, this save would stay open instead of
  // committing and exiting.
  const fresh = new Int16Array([9, 9]);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: fresh, blob: null, error: null };
  });
  s.audio.recorderState = "recording";
  await s.render();

  let exited: boolean | undefined;
  await act(async () => {
    exited = await s.ref.current!.requestClose();
  });

  expect(s.saveRecording).toHaveBeenCalledWith(
    "segment",
    original,
    fresh,
    0,
    false
  );
  expect(exited).toBe(true);
  expect(s.onExit).toHaveBeenCalledOnce();
});
