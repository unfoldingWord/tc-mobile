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
import type { SegmentId } from "@/types/domain";

/**
 * Record again's arming is released on every exit, including a synchronous
 * throw out of the start (#1421, from #1429's review).
 *
 * The arming (`recordAgainRef`, `recordAgainPending`) is set in the confirm
 * tap, before `startTake`. `startTake` can throw synchronously
 * (`buildCaptureContext` here; `closeSelection` and the floor claim are the
 * other sites), and a `.finally` on the promise never runs for that, so the
 * ref once stayed set and refused the preview Play row for the rest of the
 * sheet's life. Same harness as `recorder-record-again-mic-order.test.ts`:
 * the real sheet over the real hooks, with the capture context's builder made
 * to throw. jsdom, no device: a phone run is still owed.
 */

const mocks = vi.hoisted(() => ({
  decodeToCanonical: vi.fn(),
  playSamples: vi.fn(),
  clear: vi.fn(),
  scopeContext: { seen: undefined as unknown },
  captureThrows: { error: null as Error | null },
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
vi.mock("@/lib/audio/capture-context", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/audio/capture-context")>();
  return {
    ...real,
    buildCaptureContext: (
      ...args: Parameters<typeof real.buildCaptureContext>
    ) => {
      if (mocks.captureThrows.error) throw mocks.captureThrows.error;
      return real.buildCaptureContext(...args);
    },
  };
});
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
    return new Promise(() => {
      // Never settles: this file asks only what a throw before the request
      // leaves behind.
      void stream;
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

/** Mount over a recorded segment and open the Record again confirm. */
async function openConfirm() {
  await act(async () => {
    root.render(createElement(Screen, { ref: harness }));
  });
  await act(async () => barRerecord().click());
  expect(confirmUp()).toBe(true);
}
describe("Record again: a start that throws synchronously leaves nothing armed", () => {
  it("startTake throws in the tap: the confirm closes, Play is not refused, nothing is erased", async () => {
    await openConfirm();
    mocks.captureThrows.error = new Error("capture context");
    const uncaught: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      // The throw is the point of the case; React reports a handler's throw
      // to the window, which is where the app's failure funnel listens.
      uncaught.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    await act(async () => button(strings.recordAgainConfirm).click());
    await drain();
    window.removeEventListener("error", onError);
    mocks.captureThrows.error = null;

    // Not swallowed: it reached the window's error channel.
    expect(uncaught).toHaveLength(1);
    expect((uncaught[0] as Error).message).toBe("capture context");
    // No microphone request, no erase.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    // The confirm is closed.
    expect(confirmUp()).toBe(false);
    // The arming was released: the same confirm again is not left busy, and
    // its Play row (refused while a Record again is armed) is not refused.
    await act(async () => barRerecord().click());
    expect(button(strings.recordAgainConfirm).disabled).toBe(false);
    mocks.playSamples.mockClear();
    await act(async () => button(strings.eraseConfirmPreviewPlay).click());
    await drain();
    expect(mocks.playSamples).toHaveBeenCalled();
  });
});
