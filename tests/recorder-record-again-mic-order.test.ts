// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import {
  useAudioSession,
  type UseAudioSession,
} from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import type { SegmentId } from "@/types/domain";

/**
 * Record again asks for the microphone in the confirm tap and erases only once
 * it is granted (#1028).
 *
 * The harness is the real sheet over the real hooks: `Recorder`,
 * `useAudioSession`, `useRecorder`, `useEraseSegment` and the editor all run.
 * Faked at the boundary: `getUserMedia` (settled by each case), `MediaRecorder`,
 * `./audio-io`, the store's `clearSegmentTake` and the segment loader.
 *
 * What it observes: the ORDER of the microphone request, the erase, the
 * re-read and the capture start; that the request is made before the click
 * handler returns; and what each exit leaves behind (the stored take, the
 * capture track, the recorder state, the floor).
 *
 * What it cannot observe: whether a browser honours a `getUserMedia` made at
 * that point, a real permission prompt, a real `MediaRecorder`, or anything on
 * a phone. Those are device rows (#974).
 */

const mocks = vi.hoisted(() => ({
  decodeToCanonical: vi.fn(),
  playSamples: vi.fn(),
  clear: vi.fn(),
  scopeContext: { seen: undefined as unknown },
}));

vi.mock("@/hooks/audio-io", () => ({
  checkSharedClockOnReturn: vi.fn().mockResolvedValue(undefined),
  dropSharedContextWhenIdle: vi.fn(),
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
  claimSharedContext: vi.fn(() => vi.fn()),
  setRecordAudioSession: vi.fn(),
  stopTracks: vi.fn((stream: { getTracks: () => { stop: () => void }[] }) => {
    stream.getTracks().forEach((track) => track.stop());
  }),
}));

vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: mocks.clear,
}));
vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: vi.fn(),
  danglingReason: vi.fn().mockReturnValue(null),
}));

const recorded = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  segmentLabel: null,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: 1000,
  samples: new Int16Array(1000).fill(5),
};
const erased = { ...recorded, hasClip: false, lengthSamples: 0, samples: null };
const captured = new Int16Array([7, 8, 9]);

const boundary = vi.hoisted(() => ({
  view: null as unknown,
  reloads: [] as unknown[],
  reload: vi.fn(),
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: boundary.reload,
    setFinished: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({
  LiveScope: (props: { context: unknown }) => {
    mocks.scopeContext.seen = props.context;
    return null;
  },
}));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

/** What happened, in the order it happened. */
let order: string[] = [];

class FakeTrack {
  stopped = false;
  onended: ((event: Event) => void) | null = null;
  onmute: ((event: Event) => void) | null = null;
  stop() {
    this.stopped = true;
  }
}

class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor() {
    FakeMediaRecorder.last = this;
  }
  start() {
    order.push("capture");
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["take"]) });
      this.onstop?.();
    });
  }
}

type Harness = { audio: UseAudioSession };

let root: Root;
let container: HTMLDivElement;
let track: FakeTrack;
let getUserMedia: ReturnType<typeof vi.fn>;
let grant: () => void;
let refuse: () => void;
let visibility: DocumentVisibilityState = "visible";
let harness: RefObject<Harness | null>;
let sheet: RefObject<RecorderHandle | null>;
const saveRecording = vi.fn();

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
  vi.spyOn(console, "error").mockImplementation(() => {});
  FakeMediaRecorder.last = null;
  order = [];
  track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  getUserMedia = vi.fn(() => {
    order.push("microphone");
    return new Promise((resolve, reject) => {
      grant = () => resolve(stream);
      refuse = () => reject(new DOMException("refused", "NotAllowedError"));
    });
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  mocks.decodeToCanonical.mockReset();
  mocks.decodeToCanonical.mockResolvedValue(captured);
  mocks.playSamples.mockReset();
  mocks.playSamples.mockResolvedValue({
    stop: vi.fn(),
    elapsed: () => 0,
    duration: 1,
  });
  mocks.scopeContext.seen = undefined;
  mocks.clear.mockReset();
  mocks.clear.mockImplementation(async () => {
    order.push("erase");
  });
  boundary.view = recorded;
  boundary.reloads = [erased];
  boundary.reload.mockReset();
  boundary.reload.mockImplementation(async () => {
    order.push("re-read");
    boundary.view = boundary.reloads.shift() ?? boundary.view;
    return boundary.view;
  });
  saveRecording.mockReset();
  saveRecording.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  harness = createRef<Harness>();
  sheet = createRef<RecorderHandle>();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The App-shaped owner: one audio session and one erase hook, as App has. */
const Screen = forwardRef<Harness>((_props, ref) => {
  const audio = useAudioSession();
  useImperativeHandle(ref, () => ({ audio }), [audio]);
  return createElement(Recorder, {
    ref: sheet,
    segmentId: "segment" as SegmentId,
    audio,
    erase: useEraseSegment(),
    saveRecording,
    saveEditedSegment: vi.fn().mockResolvedValue(true),
    clipboard: null,
    onClipboardChange: vi.fn(),
    databaseUnreachable: false,
    onExit: vi.fn(),
    onRequestBack: vi.fn(),
  });
});

async function drain(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      for (let turn = 0; turn < 10; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (b) =>
      b.getAttribute("aria-label") === label ||
      b.getAttribute("aria-label")?.startsWith(`${label}. `)
  );
  expect(found, label).toHaveLength(1);
  return found[0]!;
}
function barRerecord(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `.recorder-toolbar.pair button[aria-label^="${strings.rerecord}"]`
  );
  expect(found, "the bar's re-record control").not.toBeNull();
  return found!;
}
const confirmUp = () => document.querySelector(".confirm-panel") !== null;
const state = () => harness.current!.audio.recorderState;

/** Mount over a recorded segment and open the Record again confirm. */
async function openConfirm() {
  await act(async () => {
    root.render(createElement(Screen, { ref: harness }));
  });
  await act(async () => barRerecord().click());
  expect(confirmUp()).toBe(true);
}
/** Tap the confirm and let everything that needs no microphone answer run. */
async function confirm() {
  await act(async () => button(strings.recordAgainConfirm).click());
  await drain();
}
/** Whether the session will let playback have the floor right now. */
async function floorIsFree(): Promise<boolean> {
  mocks.playSamples.mockClear();
  await act(async () => harness.current!.audio.playBuffer(new Int16Array(4)));
  await drain();
  const played = mocks.playSamples.mock.calls.length > 0;
  await act(async () => harness.current!.audio.stopBuffer());
  return played;
}

describe("Record again: the microphone request comes first (#1028)", () => {
  it("asks for the microphone before the confirm's click handler returns, and erases nothing yet", async () => {
    await openConfirm();
    const target = button(strings.recordAgainConfirm);
    let askedInsideTheClick = false;
    act(() => {
      target.click();
      // Still inside the same synchronous turn as the click.
      askedInsideTheClick = getUserMedia.mock.calls.length === 1;
    });
    expect(askedInsideTheClick).toBe(true);
    await drain();
    // The request is still open: nothing is erased while it is.
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(boundary.reload).not.toHaveBeenCalled();
    expect(order).toEqual(["microphone"]);
    // ...and the confirm is busy, not gone.
    expect(confirmUp()).toBe(true);
    expect(button(strings.recordAgainConfirm).disabled).toBe(true);
  });

  it("granted: erases, re-reads, then starts capture, in that order, into the empty segment", async () => {
    await openConfirm();
    await confirm();
    await act(async () => grant());
    await drain();

    expect(order).toEqual(["microphone", "erase", "re-read", "capture"]);
    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith("segment");
    expect(state()).toBe("recording");
    expect(confirmUp()).toBe(false);
    // The live scope is not flanked by the erased recording.
    expect(mocks.scopeContext.seen).toBeNull();

    await act(async () => button(strings.stop).click());
    await drain();
    expect(saveRecording).toHaveBeenCalledOnce();
    // (segmentId, existing, recorded, insertionOffset, finished)
    const [, existing, samples, offset] = saveRecording.mock.calls[0]!;
    expect((existing as Int16Array).length).toBe(0);
    expect(samples).toBe(captured);
    expect(offset).toBe(0);
  });
});

describe("Record again: every exit that is not a granted start keeps the old recording (#1028)", () => {
  it("microphone refused: nothing is erased, and the refusal shows where a refused Record shows it", async () => {
    await openConfirm();
    await confirm();
    await act(async () => refuse());
    await drain();

    expect(mocks.clear).not.toHaveBeenCalled();
    expect(boundary.reload).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.last).toBeNull();
    expect(state()).toBe("idle");
    expect(confirmUp()).toBe(false);
    // The take is still there: the bin still offers to replace it.
    expect(barRerecord().getAttribute("aria-label")).toBe(strings.rerecord);
    const afterRecordAgain = harness.current!.audio.recorderError;
    expect(afterRecordAgain).not.toBeNull();
    expect(container.textContent).toContain(afterRecordAgain);
    expect(await floorIsFree()).toBe(true);

    // The same sentence, in the same place, as a refused Record tap.
    await act(async () => button(strings.record).click());
    await act(async () => refuse());
    await drain();
    expect(harness.current!.audio.recorderError).toBe(afterRecordAgain);
    expect(container.textContent).toContain(afterRecordAgain);
  });

  it("granted, then the erase fails: the microphone is released, the take is kept, and the failure is reported", async () => {
    mocks.clear.mockRejectedValue(new Error("quota"));
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));
    await openConfirm();
    await confirm();
    await act(async () => grant());
    await drain();
    off();

    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(reports.map((r) => r.context)).toEqual(["erase-segment"]);
    // No hot microphone, no recorder, no take.
    expect(track.stopped).toBe(true);
    expect(FakeMediaRecorder.last).toBeNull();
    expect(state()).toBe("idle");
    // Not a microphone failure, so no microphone message.
    expect(harness.current!.audio.recorderError).toBeNull();
    expect(boundary.reload).not.toHaveBeenCalled();
    expect(confirmUp()).toBe(false);
    expect(barRerecord().getAttribute("aria-label")).toBe(strings.rerecord);
    expect(await floorIsFree()).toBe(true);
  });

  it("the erase lands but the segment still holds audio: no take is started over it", async () => {
    boundary.reloads = [recorded];
    await openConfirm();
    await confirm();
    await act(async () => grant());
    await drain();

    expect(order).toEqual(["microphone", "erase", "re-read"]);
    expect(track.stopped).toBe(true);
    expect(FakeMediaRecorder.last).toBeNull();
    expect(state()).toBe("idle");
  });

  it("a second confirm tap while the first is waiting asks once and erases once", async () => {
    await openConfirm();
    const target = button(strings.recordAgainConfirm);
    await act(async () => {
      target.click();
      target.click();
    });
    await drain();
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => grant());
    await drain();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(order).toEqual(["microphone", "erase", "re-read", "capture"]);
  });

  it("Back while the microphone is being asked for keeps the recording, even when the grant arrives afterwards", async () => {
    await openConfirm();
    await confirm();
    await act(async () => {
      expect(await sheet.current!.requestClose()).toBe(false);
    });
    expect(confirmUp()).toBe(false);

    await act(async () => grant());
    await drain();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(track.stopped).toBe(true);
    expect(FakeMediaRecorder.last).toBeNull();
    expect(state()).toBe("idle");
    expect(await floorIsFree()).toBe(true);
  });

  it("Back once the erase has begun is refused, and the take starts", async () => {
    let landed!: () => void;
    mocks.clear.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          order.push("erase");
          landed = resolve;
        })
    );
    await openConfirm();
    await confirm();
    await act(async () => grant());
    await drain();
    expect(order).toEqual(["microphone", "erase"]);

    await act(async () => {
      expect(await sheet.current!.requestClose()).toBe(false);
    });
    expect(confirmUp()).toBe(true);

    await act(async () => landed());
    await drain();
    expect(order).toEqual(["microphone", "erase", "re-read", "capture"]);
    expect(state()).toBe("recording");
  });

  it("the page is hidden when the grant arrives: nothing is erased and nothing starts (#836)", async () => {
    await openConfirm();
    await confirm();
    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => grant());
    await drain();

    expect(mocks.clear).not.toHaveBeenCalled();
    expect(track.stopped).toBe(true);
    expect(FakeMediaRecorder.last).toBeNull();
    expect(state()).toBe("idle");
    expect(confirmUp()).toBe(false);
  });

  it("the page goes away while the microphone is being asked for: a later grant erases nothing", async () => {
    await openConfirm();
    await confirm();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await act(async () => grant());
    await drain();

    expect(mocks.clear).not.toHaveBeenCalled();
    expect(track.stopped).toBe(true);
    expect(FakeMediaRecorder.last).toBeNull();
  });

  it("the page goes away during the erase: the microphone is released and no recorder opens", async () => {
    let landed!: () => void;
    mocks.clear.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          landed = resolve;
        })
    );
    await openConfirm();
    await confirm();
    await act(async () => grant());
    await drain();
    expect(mocks.clear).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(track.stopped).toBe(true);
    await act(async () => landed());
    await drain();
    expect(FakeMediaRecorder.last).toBeNull();
    expect(state()).toBe("idle");
  });
});
