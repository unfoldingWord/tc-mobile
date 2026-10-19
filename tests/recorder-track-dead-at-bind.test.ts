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
 * A capture track that is ALREADY ended when the recorder binds its listeners
 * seals the take the way a #59 interruption does (#1294).
 *
 * The track's `ended` listener is bound only after `raceAudioResume` (bounded
 * at 1000 ms) and, on Record again, `options.beforeCapture` have resolved. An
 * `ended` that fires in that window reaches nobody, and a track that is
 * already `readyState === "ended"` at bind never fires one: the state stayed
 * `"recording"` with the elapsed timer running over a take nothing was
 * filling.
 *
 * The harness is the one `tests/recorder-track-mute-seal.test.ts` uses: the
 * real hook (and, for the commit case, the real sheet over the real audio
 * hooks), with only the browser boundary faked. The elapsed clock is Vitest's
 * fake `performance` and fake `setInterval`, so a stopped clock is observable.
 *
 * What it does NOT observe: whether an alarm on any phone ends the capture
 * track, or whether a live track is ever already muted at bind. This has not
 * been run on a device.
 */

const mocks = vi.hoisted(() => ({
  reportFailure: vi.fn(),
  decodeToCanonical: vi.fn(),
  raceAudioResume: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({
  reportFailure: mocks.reportFailure,
}));

/** What the faked analyser reads: a frame with some level in it. */
const liveFrame = new Float32Array([0.2, -0.1, 0.3, -0.25]);

vi.mock("@/hooks/audio-io", () => ({
  createLevelTap: () => ({
    read: () => 0.2,
    readFrame: () => liveFrame,
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
  raceAudioResume: mocks.raceAudioResume,
  RESUME_TIMEOUT_MS: 1000,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  claimSharedContext: vi.fn(() => vi.fn()),
  setRecordAudioSession: vi.fn(),
  stopTracks: vi.fn((stream: { getTracks: () => { stop: () => void }[] }) => {
    stream.getTracks().forEach((track) => track.stop());
  }),
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: vi.fn(),
  danglingReason: vi.fn().mockReturnValue(null),
}));

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

/**
 * A capture track. `end()` is the platform ending it: `readyState` flips, and
 * `ended` reaches a listener only if one is bound by then.
 */
class FakeTrack {
  stopped = false;
  readyState: "live" | "ended" = "live";
  onended: ((event: Event) => void) | null = null;
  onmute: ((event: Event) => void) | null = null;
  stop() {
    this.stopped = true;
  }
  end() {
    this.readyState = "ended";
    this.onended?.(new Event("ended"));
  }
}

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
  mocks.raceAudioResume.mockReset();
  mocks.raceAudioResume.mockResolvedValue(false);
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

/** The rows written under the #478 still-active key. */
function interruptionRows(): unknown[][] {
  return mocks.reportFailure.mock.calls.filter(
    (call) => call[1] === "recorder-interrupted-active"
  );
}

/** A `raceAudioResume` that stays pending until the returned `release()`. */
function holdResume(): { release: () => void } {
  const held = { release: () => {} };
  mocks.raceAudioResume.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        held.release = () => resolve(false);
      })
  );
  return held;
}

describe("the recorder hook: a track already ended when the listeners bind", () => {
  type Harness = { recorder: UseRecorder };

  const Probe = forwardRef<Harness>((_props, ref) => {
    const recorder = useRecorder();
    useImperativeHandle(ref, () => ({ recorder }), [recorder]);
    return null;
  });

  async function mount() {
    const ref = createRef<Harness>();
    await act(async () => {
      root.render(createElement(Probe, { ref }));
    });
    return ref;
  }

  it("seals at processing when the track ends while the audio resume is pending", async () => {
    const ref = await mount();
    const held = holdResume();

    let starting!: Promise<boolean>;
    await act(async () => {
      starting = ref.current!.recorder.start();
      await settle();
    });
    // No listener is bound yet: this `ended` reaches nobody.
    track.end();
    expect(track.onended).toBeNull();
    await act(async () => {
      held.release();
      await starting;
      await settle();
    });

    expect(ref.current?.recorder.state).toBe("processing");
    expect(ref.current?.recorder.readScope()).toBeNull();
    const frozenAt = ref.current!.recorder.elapsedMs;
    await advance(60_000);
    expect(ref.current?.recorder.elapsedMs).toBe(frozenAt);
    expect(ref.current?.recorder.state).toBe("processing");

    const rows = interruptionRows();
    expect(rows).toHaveLength(1);
    const [error] = rows[0] as [Error];
    expect(error.message).toContain('"ended"');
    expect(error.message).toContain('"recording"');
    // Still-active arm: the native recorder and tracks stay up for the
    // commit's flush.
    expect(FakeMediaRecorder.last!.stopCalls).toBe(0);
    expect(track.stopped).toBe(false);
  });

  it("seals the same way when the track ends while beforeCapture is pending (Record again)", async () => {
    const ref = await mount();
    let proceed!: (value: boolean) => void;
    let starting!: Promise<boolean>;
    await act(async () => {
      starting = ref.current!.recorder.start({
        beforeCapture: () =>
          new Promise<boolean>((resolve) => {
            proceed = resolve;
          }),
      });
      await settle();
    });
    track.end();
    await act(async () => {
      proceed(true);
      await starting;
      await settle();
    });

    expect(ref.current?.recorder.state).toBe("processing");
    const frozenAt = ref.current!.recorder.elapsedMs;
    await advance(60_000);
    expect(ref.current?.recorder.elapsedMs).toBe(frozenAt);
    expect(interruptionRows()).toHaveLength(1);
  });

  it("control: a live track records, the clock moves, no row, and a later ended still seals once", async () => {
    const ref = await mount();
    await act(async () => {
      await ref.current!.recorder.start();
      await settle();
    });
    expect(ref.current?.recorder.state).toBe("recording");
    await advance(1_000);
    expect(ref.current?.recorder.elapsedMs).toBe(1_000);
    expect(interruptionRows()).toEqual([]);

    await act(async () => {
      track.end();
    });
    expect(ref.current?.recorder.state).toBe("processing");
    expect(interruptionRows()).toHaveLength(1);
    await advance(60_000);
    expect(ref.current?.recorder.elapsedMs).toBe(1_000);
  });
});

describe("the sheet: a take whose track is dead at bind", () => {
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

  it("commits through the interruption commit and releases the microphone", async () => {
    const held = holdResume();
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
    track.end();
    await act(async () => {
      held.release();
      await settle();
    });

    const recorder = FakeMediaRecorder.last;
    if (!recorder) throw new Error("start() opened no MediaRecorder");
    expect(ref.current?.audio.recorderState).toBe("processing");
    expect(recorder.stopCalls).toBe(1);

    await act(async () => {
      recorder.deliverFinal();
      await settle();
    });
    await drain();

    expect(saveRecording).toHaveBeenCalledOnce();
    expect(track.stopped).toBe(true);
    expect(ref.current?.audio.recorderState).toBe("idle");
    expect(interruptionRows()).toHaveLength(1);
  });
});
