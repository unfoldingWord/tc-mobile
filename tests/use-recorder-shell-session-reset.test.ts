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

import { setPlaybackAudioSession } from "@/hooks/audio-io";
import { useRecorder, type UseRecorder } from "@/hooks/use-recorder";

/**
 * #1518, inside the native iOS shell: a Play declares `"playback"`, and the
 * next Record must hand the type back to WebKit (`"auto"`) BEFORE the
 * microphone opens, so a take is never captured under a type documented for
 * playback only. The coordinator's decision on #1518; not run on a device.
 *
 * Unlike `tests/use-recorder-audio-session.test.ts`, which mocks the setter
 * and pins only the call order, this keeps the REAL session setters and
 * reads `navigator.audioSession.type` at the moment `getUserMedia` is
 * called. So it dies if the reset is missing, writes the wrong value, or
 * runs after `getUserMedia`. The rest of `audio-io` that touches an
 * `AudioContext` is stubbed, the same as that file does.
 */

const audioSession = { type: "auto" };
let typeAtGetUserMedia: string | undefined;

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

vi.mock("@/hooks/audio-io", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/audio-io")>()),
  isRecordingSupported: () => true,
  pickMimeType: () => undefined,
  createLevelTap: vi.fn(() => fakeTap),
  probeCaptureTrack: vi.fn(),
  raceAudioResume: vi.fn(async () => false),
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  claimSharedContext: vi.fn(() => () => {}),
  stopTracks: vi.fn((stream: FakeStream) => {
    stream.getTracks().forEach((track) => track.stop());
  }),
  decodeToCanonical: vi.fn(),
}));

const Harness = forwardRef<UseRecorder>((_props, ref) => {
  const api = useRecorder();
  useImperativeHandle(ref, () => api, [api]);
  return null;
});

let root: Root;
let container: HTMLDivElement;

async function mountedRecorder(): Promise<UseRecorder> {
  const ref = createRef<UseRecorder>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  if (!ref.current) throw new Error("Harness did not mount useRecorder");
  return ref.current;
}

async function onPlatform(platform: string): Promise<void> {
  const { Capacitor } = await import("@capacitor/core");
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue(platform);
}

beforeEach(() => {
  audioSession.type = "auto";
  typeAtGetUserMedia = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  const stream = new FakeStream([new FakeTrack()]);
  Object.defineProperty(navigator, "audioSession", {
    value: audioSession,
    configurable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn().mockImplementation(async () => {
        typeAtGetUserMedia = audioSession.type;
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
  vi.restoreAllMocks();
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  delete (navigator as unknown as { audioSession?: unknown }).audioSession;
});

describe("Record after Play inside the iOS shell (#1518)", () => {
  it("hands the type back to auto before the microphone opens", async () => {
    await onPlatform("ios");
    setPlaybackAudioSession();
    expect(audioSession.type).toBe("playback");
    const api = await mountedRecorder();

    await act(async () => {
      await api.start();
    });

    expect(typeAtGetUserMedia).toBe("auto");
  });

  it("still declares play-and-record before the microphone opens on web", async () => {
    await onPlatform("web");
    setPlaybackAudioSession();
    const api = await mountedRecorder();

    await act(async () => {
      await api.start();
    });

    expect(typeAtGetUserMedia).toBe("play-and-record");
  });
});
