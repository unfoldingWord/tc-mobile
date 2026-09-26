// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Recorder } from "@/components/recorder";
import { strings } from "@/lib/strings";
import {
  useAudioSession,
  type UseAudioSession,
} from "@/hooks/use-audio-session";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import type { SegmentId } from "@/types/domain";

/**
 * A `pagehide` during a live take seals it the way a #59 interruption does
 * (#807, DRI decision 2026-09-24), instead of cancelling it.
 *
 * The harness is the real sheet over the real audio hooks: `Recorder`,
 * `useAudioSession` and `useRecorder` all run, and only the browser boundary is
 * faked — `getUserMedia`, `MediaRecorder`, `./audio-io` (decode, level tap,
 * context resume) and the failure funnel. The segment and editor hooks are
 * mocked at their boundary as in `tests/recorder-stop-commits.test.ts`, and
 * `saveRecording` is the spy that stands in for the IndexedDB write.
 *
 * What it observes: the recorder state after the event, which native
 * `MediaRecorder` calls were made, whether and with what `saveRecording` was
 * called, and whether anything was written to the failure log. The fake
 * `MediaRecorder` delivers its final slice and `stop` event only when a test
 * says so, which is how the cases separate "during the `pagehide` dispatch"
 * from "after it". What it does NOT observe: a real engine's `MediaRecorder`
 * across a `pagehide`, a bfcache freeze or restore, or React's scheduling of
 * the commit in a browser. Those are the device rows on #245 / #484.
 */

const mocks = vi.hoisted(() => ({
  reportFailure: vi.fn(),
  decodeToCanonical: vi.fn(),
  playSamples: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({
  reportFailure: mocks.reportFailure,
}));

vi.mock("@/hooks/audio-io", () => ({
  createLevelTap: () => ({
    read: () => 0,
    readFrame: () => null,
    available: () => true,
    disconnect: () => {},
    close: () => {},
  }),
  decodeToCanonical: mocks.decodeToCanonical,
  decodeMp3ToCanonical: vi.fn(),
  isRecordingSupported: () => true,
  pickMimeType: () => "audio/webm",
  playSamples: mocks.playSamples,
  probeCaptureTrack: () => {},
  raceAudioResume: vi.fn().mockResolvedValue(false),
  RESUME_TIMEOUT_MS: 1000,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: vi.fn(),
  danglingReason: vi.fn().mockReturnValue(null),
}));

const original = new Int16Array([1, 2, 3, 4]);
const captured = new Int16Array([7, 8, 9]);

/**
 * The erase surface `App` now owns and passes down (#160, L-12). This suite
 * never erases; a stub that answers "no erase in flight" is what the sheet's
 * Back and confirm gates read (matches `tests/recorder-stop-commits.test.ts`).
 */
const erase = {
  erase: vi.fn(async () => "ok" as const),
  erasing: false,
  isErasing: () => false,
};

const boundary = vi.hoisted(() => ({
  editor: {} as SegmentEditor,
  view: null as { samples: Int16Array } | null,
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn(async () => boundary.view),
    setFinished: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/use-segment-editor", () => ({
  useSegmentEditor: () => boundary.editor,
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

/** A capture track: `stop()` is observable, `onended` is the #59 feed. */
class FakeTrack {
  stopped = false;
  onended: ((event: Event) => void) | null = null;
  stop() {
    this.stopped = true;
  }
}

/**
 * The one `MediaRecorder` a take opens. `stop()` flips the state the way the
 * spec's stop algorithm does and queues nothing on its own: `deliverFinal()`
 * is the queued `dataavailable` + `stop` pair, run when a case says so.
 */
class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  stopCalls = 0;
  constructor() {
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.stopCalls++;
    this.state = "inactive";
  }
  slice(bytes: string) {
    this.ondataavailable?.({ data: new Blob([bytes]) });
  }
  deliverFinal() {
    this.slice("final");
    this.onstop?.();
  }
}

type Harness = { audio: UseAudioSession };

let root: Root;
let container: HTMLDivElement;
let track: FakeTrack;
const saveRecording = vi.fn();

/** True only while `window.dispatchEvent(pagehide)` is on the stack. */
let insidePageHide = false;
const writesInsidePageHide: string[] = [];

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
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.last = null;
  track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  mocks.reportFailure.mockReset();
  mocks.reportFailure.mockImplementation(() => {
    if (insidePageHide) writesInsidePageHide.push("reportFailure");
  });
  mocks.decodeToCanonical.mockReset();
  mocks.decodeToCanonical.mockImplementation(async (blob: Blob) =>
    blob.size > 0 ? captured : new Int16Array(0)
  );
  mocks.playSamples.mockReset();
  saveRecording.mockReset();
  saveRecording.mockImplementation(async () => {
    if (insidePageHide) writesInsidePageHide.push("saveRecording");
    return true;
  });
  writesInsidePageHide.length = 0;
  insidePageHide = false;
  boundary.view = {
    bookName: "Book",
    chapterNumber: 1,
    ordinal: 1,
    finished: false,
    hasClip: true,
    samples: original,
  } as unknown as { samples: Int16Array };
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
  } as unknown as SegmentEditor;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** The App-shaped owner: one `useAudioSession`, handed to the real sheet. */
const Screen = forwardRef<Harness>((_props, ref) => {
  const audio = useAudioSession();
  useImperativeHandle(ref, () => ({ audio }), [audio]);
  return createElement(Recorder, {
    segmentId: "segment" as SegmentId,
    audio,
    erase,
    saveRecording,
    saveEditedSegment: vi.fn().mockResolvedValue(true),
    clipboard: null,
    onClipboardChange: vi.fn(),
    databaseUnreachable: false,
    onExit: vi.fn(),
    onRequestBack: vi.fn(),
  });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Drain what an event started. `act` flushes the commit (and the sheet's
 * layout effect, which starts the commit) as it exits, so the commit's own
 * awaits need further turns inside a second `act`.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await settle();
    });
  }
}

/** Mount, tap Record, and land two captured slices in a live take. */
async function recordATake() {
  const ref = createRef<Harness>();
  await act(async () => {
    root.render(createElement(Screen, { ref }));
  });
  const record = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.record
  );
  expect(record, "Record").toBeDefined();
  await act(async () => {
    record!.click();
    await settle();
  });
  const recorder = FakeMediaRecorder.last;
  if (!recorder) throw new Error("start() opened no MediaRecorder");
  expect(ref.current?.audio.recorderState).toBe("recording");
  recorder.slice("one");
  recorder.slice("two");
  return { ref, recorder };
}

function firePageHide(persisted: boolean) {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  insidePageHide = true;
  try {
    window.dispatchEvent(event);
  } finally {
    insidePageHide = false;
  }
}

it.each([true, false])(
  "a pagehide (persisted: %s) mid-take freezes the take at processing, not idle, and does not cancel the recorder",
  async (persisted) => {
    const { ref, recorder } = await recordATake();

    await act(async () => {
      firePageHide(persisted);
    });

    // The interruption's freeze state (#59): the take is ended and awaiting
    // its commit. Cancelling would read "idle" here with the chunks dropped.
    expect(ref.current?.audio.recorderState).toBe("processing");
    // Nothing is saved yet: the commit is waiting on the native flush, which
    // the fake has not delivered. So nothing reached the save during the
    // dispatch or the microtasks after it.
    expect(saveRecording).not.toHaveBeenCalled();
    expect(writesInsidePageHide).toEqual([]);
    // The commit path's own `stop()` asked the recorder to flush, once.
    expect(recorder.stopCalls).toBe(1);

    // Let the flush land so the commit finishes inside this case.
    await act(async () => {
      recorder.deliverFinal();
      await settle();
    });
    await drain();
  }
);

it("the sealed take is saved once the recorder's final slice lands, as an interruption's is", async () => {
  const { recorder } = await recordATake();

  await act(async () => {
    firePageHide(true);
  });
  await act(async () => {
    recorder.deliverFinal();
    await settle();
  });
  await drain();

  // The same splice the Stop tap and the #59 interruption make: the captured
  // PCM into the working buffer at the locked offset, with the draft mark.
  expect(saveRecording).toHaveBeenCalledOnce();
  expect(saveRecording).toHaveBeenCalledWith(
    "segment",
    original,
    captured,
    original.length,
    false
  );
  // Every slice captured before the pagehide went into the decoded blob
  // (jsdom's Blob has no `text()`, so the byte count stands in for it).
  const blob = mocks.decodeToCanonical.mock.calls[0]?.[0] as Blob;
  expect(blob.size).toBe("onetwofinal".length);
  // The microphone is released once the flush is done.
  expect(track.stopped).toBe(true);
  // No failure-log row: a pagehide is not a failure, and the log's append is
  // an IndexedDB write (#478 constraint; #471 George R4 P2-2).
  expect(mocks.reportFailure).not.toHaveBeenCalled();
  expect(writesInsidePageHide).toEqual([]);
});

it("the #59 interruption baseline: the same take, ended by the track, is saved the same way", async () => {
  const { recorder } = await recordATake();

  await act(async () => {
    recorder.state = "inactive";
    recorder.slice("final");
    track.onended?.(new Event("ended"));
    await settle();
  });
  await drain();

  expect(saveRecording).toHaveBeenCalledOnce();
  expect(saveRecording).toHaveBeenCalledWith(
    "segment",
    original,
    captured,
    original.length,
    false
  );
  const blob = mocks.decodeToCanonical.mock.calls[0]?.[0] as Blob;
  expect(blob.size).toBe("onetwofinal".length);
});

it("a pagehide after an interruption froze the take, before its commit, does not cancel it", async () => {
  // The window #471's Frank R4 P1 named (then #481, folded into #173): the
  // interruption has set `processing` and the chunks are still in the
  // recorder's ref, but the sheet has not committed yet. A `cancel()` here
  // replaces that array and the take is lost.
  const { ref, recorder } = await recordATake();

  // Fire the interruption and the pagehide in ONE act, so React has not
  // committed the `processing` render (and the sheet's layout effect has not
  // run `stop()`) when the pagehide handler reads the recorder.
  await act(async () => {
    recorder.state = "inactive";
    recorder.slice("final");
    track.onended?.(new Event("ended"));
    firePageHide(true);
    await settle();
  });
  await drain();

  expect(ref.current?.audio.recorderState).not.toBe("recording");
  expect(saveRecording).toHaveBeenCalledOnce();
  const blob = mocks.decodeToCanonical.mock.calls[0]?.[0] as Blob;
  expect(blob.size).toBe("onetwofinal".length);
  expect(writesInsidePageHide).toEqual([]);
});

/**
 * Sound the working buffer through the real session and hand back the handle,
 * so a case can see whether a `pagehide` silenced it.
 */
async function playSomething(ref: { current: Harness | null }) {
  const handle = { stop: vi.fn(), elapsed: () => 0, duration: 1 };
  mocks.playSamples.mockResolvedValueOnce(handle);
  await act(async () => {
    ref.current?.audio.playBuffer(new Int16Array([1, 2, 3]));
    await settle();
  });
  expect(ref.current?.audio.playingBuffer).toBe(true);
  return handle;
}

it("a pagehide with no take open still silences playback, as before", async () => {
  const ref = createRef<Harness>();
  await act(async () => {
    root.render(createElement(Screen, { ref }));
  });
  const handle = await playSomething(ref);

  await act(async () => {
    firePageHide(false);
  });

  expect(handle.stop).toHaveBeenCalled();
  expect(ref.current?.audio.playingBuffer).toBe(false);
});

it.each(["committed", "cancelled"] as const)(
  "once a take has been %s, a later pagehide releases as before, not as a seal",
  async (ending) => {
    const { ref, recorder } = await recordATake();
    if (ending === "committed") {
      // Ended by a first pagehide's seal and committed through the sheet.
      await act(async () => {
        firePageHide(true);
      });
      await act(async () => {
        recorder.deliverFinal();
        await settle();
      });
      await drain();
      expect(saveRecording).toHaveBeenCalledOnce();
    } else {
      // Ended by a navigation, which abandons the take (`leave()`).
      await act(async () => {
        ref.current?.audio.leave();
      });
    }
    expect(ref.current?.audio.recorderState).toBe("idle");
    const handle = await playSomething(ref);

    await act(async () => {
      firePageHide(true);
    });

    expect(handle.stop).toHaveBeenCalled();
    expect(ref.current?.audio.playingBuffer).toBe(false);
  }
);
