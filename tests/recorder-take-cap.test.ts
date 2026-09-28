// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder } from "@/components/recorder";
import { strings } from "@/lib/strings";
import {
  useAudioSession,
  type UseAudioSession,
} from "@/hooks/use-audio-session";
import { useRecorder, type UseRecorder } from "@/hooks/use-recorder";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import type { SegmentId } from "@/types/domain";

import { restingErase } from "./support";

/**
 * The take-length cap (#1005, DRI decision 2026-09-25: "Warn at 15, seal at
 * 20").
 *
 * A live take that reaches 20:00 is sealed the way a `pagehide` seals it
 * (#807): the recorder freezes at `"processing"`, the sheet's interruption
 * commit runs `stop()` and saves the partial take, and one row goes to the
 * failure log under `"recorder-take-cap"`. From 15:00 the recorder's
 * `takeCap.nearLimit` is true, for the recorder screen to mark later.
 *
 * The harness is the one `tests/recorder-pagehide-seal.test.ts` uses: the
 * real sheet over the real audio hooks, with only the browser boundary faked
 * (`getUserMedia`, `MediaRecorder`, `./audio-io`, the failure funnel). The
 * elapsed clock is Vitest's fake `performance` and fake `setInterval`, so the
 * recorder's own 100 ms tick is what reaches the cap. Real `setTimeout` is
 * left alone, because the commit path's own yields use it.
 *
 * What it does NOT observe: a real engine recording for 20 minutes, the
 * memory that take costs on a phone, or how a backgrounded page's throttled
 * timers move the moment the seal lands. Those are device rows (#974).
 */

const mocks = vi.hoisted(() => ({
  reportFailure: vi.fn(),
  decodeToCanonical: vi.fn(),
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
  playSamples: vi.fn(),
  probeCaptureTrack: () => {},
  raceAudioResume: vi.fn().mockResolvedValue(false),
  RESUME_TIMEOUT_MS: 1000,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  // #1111: use-recorder.ts's start() calls this before getUserMedia. This
  // suite is about the take-cap seal, not the session-type call — see
  // tests/use-recorder-audio-session.test.ts for that wiring.
  setRecordAudioSession: vi.fn(),
  stopTracks: vi.fn((stream: { getTracks: () => { stop: () => void }[] }) => {
    stream.getTracks().forEach((track) => track.stop());
  }),
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: vi.fn(),
  danglingReason: vi.fn().mockReturnValue(null),
}));

const MINUTE = 60_000;

const original = new Int16Array([1, 2, 3, 4]);
const captured = new Int16Array([7, 8, 9]);

// Resting erase (#856 item 3): shared fixture, `tests/support.ts`.
const erase = restingErase();

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

class FakeTrack {
  stopped = false;
  onended: ((event: Event) => void) | null = null;
  stop() {
    this.stopped = true;
  }
}

/** See `tests/recorder-pagehide-seal.test.ts`: the final slice and `stop`
 *  event are delivered only when a case says so. */
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

let root: Root;
let container: HTMLDivElement;
let track: FakeTrack;
const saveRecording = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
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
  mocks.decodeToCanonical.mockReset();
  mocks.decodeToCanonical.mockImplementation(async (blob: Blob) =>
    blob.size > 0 ? captured : new Int16Array(0)
  );
  saveRecording.mockReset();
  saveRecording.mockResolvedValue(true);
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
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function drain(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await settle();
    });
  }
}

/** Move the fake clock (and the recorder's 100 ms tick with it). */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function capRows(): unknown[][] {
  return mocks.reportFailure.mock.calls.filter(
    (call) => call[1] === "recorder-take-cap"
  );
}

describe("the sheet: a take that reaches 20:00", () => {
  type Harness = { audio: UseAudioSession };

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

  it("is still recording one tick before 20:00, with nothing stopped or logged", async () => {
    const { ref, recorder } = await recordATake();

    await advance(20 * MINUTE - 100);

    expect(ref.current?.audio.recorderState).toBe("recording");
    expect(recorder.stopCalls).toBe(0);
    expect(capRows()).toEqual([]);
  });

  it("is sealed at 20:00 and saved through the interruption commit, never cancelled", async () => {
    const { ref, recorder } = await recordATake();

    await advance(20 * MINUTE);

    // The seal's freeze, then the sheet's commit asking the recorder to flush.
    expect(ref.current?.audio.recorderState).toBe("processing");
    expect(recorder.stopCalls).toBe(1);
    expect(saveRecording).not.toHaveBeenCalled();

    await act(async () => {
      recorder.deliverFinal();
      await settle();
    });
    await drain();

    // The same splice a Stop tap, an interruption and a pagehide seal make.
    expect(saveRecording).toHaveBeenCalledOnce();
    expect(saveRecording).toHaveBeenCalledWith(
      "segment",
      original,
      captured,
      original.length,
      false
    );
    // Every slice captured before the cap is in the decoded blob.
    const blob = mocks.decodeToCanonical.mock.calls[0]?.[0] as Blob;
    expect(blob.size).toBe("onetwofinal".length);
    expect(track.stopped).toBe(true);
    expect(ref.current?.audio.recorderState).toBe("idle");
    // Exactly one durable row says the take was cut.
    expect(capRows()).toHaveLength(1);
    expect(mocks.reportFailure).toHaveBeenCalledOnce();
  });
});

describe("the recorder hook: nearLimit and remaining time", () => {
  type Harness = { recorder: UseRecorder };

  const Probe = forwardRef<Harness>((_props, ref) => {
    const recorder = useRecorder();
    useImperativeHandle(ref, () => ({ recorder }), [recorder]);
    return null;
  });

  async function startATake() {
    const ref = createRef<Harness>();
    await act(async () => {
      root.render(createElement(Probe, { ref }));
    });
    await act(async () => {
      await ref.current?.recorder.start();
      await settle();
    });
    expect(ref.current?.recorder.state).toBe("recording");
    return ref;
  }

  it("is not near the limit at the start of a take, nor at idle", async () => {
    const ref = createRef<Harness>();
    await act(async () => {
      root.render(createElement(Probe, { ref }));
    });
    expect(ref.current?.recorder.state).toBe("idle");
    expect(ref.current?.recorder.takeCap.nearLimit).toBe(false);
    await act(async () => root.unmount());
    root = createRoot(container);

    const live = await startATake();
    expect(live.current?.recorder.takeCap.nearLimit).toBe(false);
    expect(live.current?.recorder.takeCap.remainingMs).toBe(20 * MINUTE);
  });

  it("turns nearLimit on at 15:00, not before, with five minutes remaining", async () => {
    const ref = await startATake();

    await advance(15 * MINUTE - 100);
    expect(ref.current?.recorder.takeCap.nearLimit).toBe(false);

    await advance(100);
    expect(ref.current?.recorder.takeCap.nearLimit).toBe(true);
    expect(ref.current?.recorder.takeCap.remainingMs).toBe(5 * MINUTE);
  });

  it("drops nearLimit once the take is no longer recording", async () => {
    const ref = await startATake();
    await advance(16 * MINUTE);
    expect(ref.current?.recorder.takeCap.nearLimit).toBe(true);

    // A plain Stop: `elapsedMs` keeps its last value at idle, so the marker
    // must key on the state, not on the clock alone.
    const recorder = FakeMediaRecorder.last!;
    await act(async () => {
      const stopping = ref.current!.recorder.stop();
      recorder.deliverFinal();
      await stopping;
    });
    expect(ref.current?.recorder.state).toBe("idle");
    expect(ref.current?.recorder.takeCap.nearLimit).toBe(false);
  });

  it("at 20:00 the hook freezes the take at processing, with its clock stopped and one row, even before anything commits it", async () => {
    // No sheet here, so no commit runs `stop()`: the seal alone has to stop
    // the tick, or the clock keeps moving and the row repeats every 100 ms.
    const ref = await startATake();

    await advance(20 * MINUTE);
    expect(ref.current?.recorder.state).toBe("processing");
    expect(ref.current?.recorder.elapsedMs).toBe(20 * MINUTE);
    expect(capRows()).toHaveLength(1);
    // The seal leaves the native recorder running for `stop()` to flush.
    expect(FakeMediaRecorder.last?.stopCalls).toBe(0);

    await advance(MINUTE);
    expect(ref.current?.recorder.elapsedMs).toBe(20 * MINUTE);
    expect(capRows()).toHaveLength(1);
  });

  it("a take stopped before the cap writes no cap row, however long the clock runs after", async () => {
    const ref = await startATake();
    await advance(10 * MINUTE);
    const recorder = FakeMediaRecorder.last!;
    await act(async () => {
      const stopping = ref.current!.recorder.stop();
      recorder.deliverFinal();
      await stopping;
    });

    await advance(30 * MINUTE);

    expect(capRows()).toEqual([]);
    expect(ref.current?.recorder.state).toBe("idle");
  });
});
