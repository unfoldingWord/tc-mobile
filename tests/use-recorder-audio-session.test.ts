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

import { useRecorder, type UseRecorder } from "@/hooks/use-recorder";

/**
 * #1111: playback must stay audible with the phone on silent, and recording
 * must not regress. The fix asks WebKit for a record-capable audio session
 * (`navigator.audioSession.type = "play-and-record"`, `setRecordAudioSession`
 * in `hooks/audio-io.ts`) BEFORE the microphone opens, so a session an
 * earlier Play left declared `"playback"` (playback-only, per WebKit's own
 * docs) cannot fight `getUserMedia`.
 *
 * This proves the WIRING — that `start()` actually calls the setter, and
 * calls it before `getUserMedia`, not after — mirroring
 * `tests/use-recorder-release-refs.test.ts`'s mount-the-real-hook style with
 * `@/hooks/audio-io` mocked. `tests/audio-io-session-type.test.ts` proves the
 * setter itself writes the right `navigator.audioSession.type` value, in
 * Node; a fake `navigator.audioSession` is not needed here because the
 * setter is mocked away entirely — only the CALL, and its order relative to
 * `getUserMedia`, is under test.
 */

const callOrder: string[] = [];

class FakeTrack {
  readonly kind = "audio";
  onended: (() => void) | null = null;
  stop(): void {}
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(public readonly stream: FakeStream) {}
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
  }
}

const fakeTap = {
  read: () => 0,
  readFrame: () => null,
  available: () => true,
  disconnect: vi.fn(),
  close: vi.fn(),
};

vi.mock("@/hooks/audio-io", () => ({
  isRecordingSupported: () => true,
  pickMimeType: () => undefined,
  createLevelTap: vi.fn(() => fakeTap),
  probeCaptureTrack: vi.fn(),
  raceAudioResume: vi.fn().mockResolvedValue(false),
  RESUME_TIMEOUT_MS: 1000,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  stopTracks: vi.fn((stream: FakeStream) => {
    stream.getTracks().forEach((track) => track.stop());
  }),
  decodeToCanonical: vi.fn(),
  setRecordAudioSession: vi.fn(() => {
    callOrder.push("setRecordAudioSession");
  }),
}));

const Harness = forwardRef<UseRecorder>((_props, ref) => {
  const api = useRecorder();
  useImperativeHandle(ref, () => api, [api]);
  return null;
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  callOrder.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  const stream = new FakeStream([new FakeTrack()]);
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn().mockImplementation(async () => {
        callOrder.push("getUserMedia");
        return stream;
      }),
    },
    configurable: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
});

async function mountedRecorder(): Promise<UseRecorder> {
  const ref = createRef<UseRecorder>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  if (!ref.current) throw new Error("Harness did not mount useRecorder");
  return ref.current;
}

describe("start() declares a record-capable audio session before opening the microphone (#1111)", () => {
  it("calls setRecordAudioSession, then getUserMedia — never the other order", async () => {
    const api = await mountedRecorder();

    await act(async () => {
      await api.start();
    });

    expect(callOrder).toEqual(["setRecordAudioSession", "getUserMedia"]);
  });

  it("calls setRecordAudioSession exactly once per start()", async () => {
    const api = await mountedRecorder();

    await act(async () => {
      await api.start();
    });

    expect(
      callOrder.filter((call) => call === "setRecordAudioSession")
    ).toHaveLength(1);
  });
});
