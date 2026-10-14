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
 * A capture track that goes MUTED mid-take ends the take the way a #59
 * interruption does (#1294).
 *
 * The recorder learns that capture ended through `onInterrupted`, bound to
 * the native recorder's `error` and to each track's `ended`. A track that
 * the platform mutes instead — the spec's "temporarily unable to provide
 * data", which an OS audio interruption such as an alarm can produce —
 * fires neither. Before this change nothing in the hook listened for `mute`,
 * so the state stayed `"recording"`: the wall-clock `setInterval` kept the
 * elapsed timer counting, and `readScope` kept folding the analyser's
 * all-zero frames into the live waveform as a scrolling flat line, until the
 * translator tapped Stop. The tester's report is exactly that screen.
 *
 * The harness is the one `tests/recorder-take-cap.test.ts` uses: the real
 * hook (and, for the commit cases, the real sheet over the real audio hooks),
 * with only the browser boundary faked — `getUserMedia`, `MediaRecorder`,
 * `./audio-io` and the failure funnel. The elapsed clock is Vitest's fake
 * `performance` and fake `setInterval`, so a stopped clock is observable.
 * Unlike that suite the faked level tap hands back a real frame, so the live
 * scope's pull is observable too: a non-null scope while recording, null once
 * the take is frozen.
 *
 * What it does NOT observe: that an alarm on any phone fires `mute` (or
 * anything at all) on the capture track, or what a real engine's
 * `MediaRecorder` writes while its track is muted. The report's build and
 * platform were not given, and this has not been run on a device.
 */

const mocks = vi.hoisted(() => ({
  reportFailure: vi.fn(),
  decodeToCanonical: vi.fn(),
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
  raceAudioResume: vi.fn().mockResolvedValue(false),
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
 * A capture track with the three feeds the hook can bind: `ended` (the #59
 * feed), `mute` (this suite's), and `stop()` as the observable release.
 */
class FakeTrack {
  stopped = false;
  muted = false;
  onended: ((event: Event) => void) | null = null;
  onmute: ((event: Event) => void) | null = null;
  stop() {
    this.stopped = true;
  }
  /** The platform muting the track: `muted` flips, then `mute` fires. */
  mute() {
    this.muted = true;
    this.onmute?.(new Event("mute"));
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

/** The rows written under the #478 still-active key. */
function interruptionRows(): unknown[][] {
  return mocks.reportFailure.mock.calls.filter(
    (call) => call[1] === "recorder-interrupted-active"
  );
}

describe("the recorder hook: a track that goes muted mid-take", () => {
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

  it("freezes at processing with the clock stopped and the scope frozen, leaving the native recorder for the commit's flush", async () => {
    const ref = await startATake();
    const recorder = FakeMediaRecorder.last!;

    // The control half: while recording, the clock moves and the scope pulls.
    await advance(1_000);
    expect(ref.current?.recorder.elapsedMs).toBe(1_000);
    expect(ref.current?.recorder.readScope()).not.toBeNull();

    await act(async () => {
      track.mute();
    });

    // The #59 freeze: Record is dead and the commit is on its way.
    expect(ref.current?.recorder.state).toBe("processing");
    // The scope's pull refuses, so `LiveScope` keeps its last frame rather
    // than scrolling a flat line (`live-scope.tsx`, the null-scope branch).
    expect(ref.current?.recorder.readScope()).toBeNull();
    // The native recorder is still live — its slices are not final, so the
    // seal must come from `stop()`'s flush, not from a track release here.
    expect(recorder.stopCalls).toBe(0);
    expect(track.stopped).toBe(false);

    // The timer stops where the take did: a minute later it still reads the
    // moment of the mute.
    await advance(60_000);
    expect(ref.current?.recorder.elapsedMs).toBe(1_000);
    expect(ref.current?.recorder.state).toBe("processing");
  });

  it("writes one still-active row naming the mute feed and the recorder's live state (#478)", async () => {
    await startATake();

    await act(async () => {
      track.mute();
    });

    const rows = interruptionRows();
    expect(rows).toHaveLength(1);
    const [error] = rows[0] as [Error];
    expect(error.message).toContain('"mute"');
    expect(error.message).toContain('"recording"');
    expect(mocks.reportFailure).toHaveBeenCalledOnce();
  });

  it("a Stop detaches the mute feed with the others, so a late mute cannot repaint a stopped recorder", async () => {
    const ref = await startATake();
    const recorder = FakeMediaRecorder.last!;
    expect(track.onmute).not.toBeNull();
    expect(track.onended).not.toBeNull();

    await act(async () => {
      const stopping = ref.current!.recorder.stop();
      // `stop()` owns teardown from its first line: every feed is unbound
      // before the flush await.
      expect(track.onmute).toBeNull();
      expect(track.onended).toBeNull();
      expect(recorder.onerror).toBeNull();
      recorder.deliverFinal();
      await stopping;
    });
    expect(ref.current?.recorder.state).toBe("idle");
  });

  it("a mute on a cancelled take changes nothing: the generation guard holds", async () => {
    const ref = await startATake();
    const onmute = track.onmute;
    expect(onmute).not.toBeNull();

    await act(async () => {
      ref.current!.recorder.cancel();
    });
    expect(ref.current?.recorder.state).toBe("idle");

    await act(async () => {
      onmute!(new Event("mute"));
    });
    expect(ref.current?.recorder.state).toBe("idle");
    expect(interruptionRows()).toEqual([]);
  });
});

describe("the sheet: a take whose track goes muted", () => {
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

  it("is committed in place through the interruption commit, like a Stop and like the #59 baseline", async () => {
    const { ref, recorder } = await recordATake();

    await act(async () => {
      track.mute();
      await settle();
    });

    // The freeze, then the sheet's layout effect asking the recorder to flush.
    expect(ref.current?.audio.recorderState).toBe("processing");
    expect(recorder.stopCalls).toBe(1);
    expect(saveRecording).not.toHaveBeenCalled();

    await act(async () => {
      recorder.deliverFinal();
      await settle();
    });
    await drain();

    // The same splice a Stop tap, an `ended` interruption and a pagehide
    // seal make: the slices before the mute plus the flushed final one.
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
    // The microphone is released once the flush is done, and the screen
    // shows the committed take rather than a recording that is not happening.
    expect(track.stopped).toBe(true);
    expect(ref.current?.audio.recorderState).toBe("idle");
    expect(interruptionRows()).toHaveLength(1);
  });
});
