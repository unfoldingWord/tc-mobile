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

import { lightsFailureMarker } from "@/lib/failure-marker";

/**
 * The last four `console.error`-only sinks in `hooks/use-recorder.ts` now
 * write a failure-log row, each under its own context. The foreground-resume,
 * tap-open and decode-retry sinks keep their `console.error` beside the row;
 * the start row logs only through `reportFailure`'s own console line, so the
 * hook makes no direct `console.error` call there:
 *
 *   - `armForegroundResume`'s resume on a return to the foreground mid-take:
 *     `"recorder-foreground-resume"`.
 *   - `start()`'s level-meter open (`createLevelTap` throwing; the take still
 *     records, meterless): `"recorder-tap-open"`.
 *   - `retryDecode()`'s fire-and-forget resume: `"recorder-decode-retry-resume"`.
 *   - `start()`'s catch, when the microphone could not be opened: a
 *     `NotAllowedError` (a refusal) under `"recorder-mic-refused"`, anything
 *     else (`NotFoundError`, `NotReadableError`, `OverconstrainedError`,
 *     `SecurityError`, `AbortError`, a non-DOMException) under `"recorder-mic-start"`. The cause
 *     is passed as is, so the row reads "<DOMException name>: <message>".
 *
 * Each case also reads `lightsFailureMarker` for the context the hook used, so
 * the hook's routing and the marker's classification are checked together.
 *
 * The real `useRecorder` is mounted in jsdom with the audio boundary mocked,
 * the same style as `tests/use-recorder-audio-session.test.ts`. What this does
 * NOT show: that any of these fail this way on a phone, or that a row lands in
 * the IndexedDB log there. No device run backs it.
 */

const { reportFailure, resumeAudioContext, createLevelTap, decodeToCanonical } =
  vi.hoisted(() => ({
    reportFailure: vi.fn(),
    resumeAudioContext: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    createLevelTap: vi.fn(),
    decodeToCanonical: vi.fn(),
  }));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

vi.mock("@/hooks/audio-io", () => ({
  isRecordingSupported: () => true,
  pickMimeType: () => undefined,
  createLevelTap,
  probeCaptureTrack: vi.fn(),
  raceAudioResume: vi.fn(async () => false),
  RESUME_TIMEOUT_MS: 1000,
  resumeAudioContext,
  claimSharedContext: vi.fn(() => () => {}),
  stopTracks: vi.fn(),
  decodeToCanonical,
  setRecordAudioSession: vi.fn(),
}));

import {
  armForegroundResume,
  useRecorder,
  type UseRecorder,
} from "@/hooks/use-recorder";

class FakeTrack {
  readonly kind = "audio";
  readyState = "live";
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
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

const Harness = forwardRef<UseRecorder>((_props, ref) => {
  const api = useRecorder();
  useImperativeHandle(ref, () => api, [api]);
  return null;
});

let root: Root;
let container: HTMLDivElement;

function setGetUserMedia(impl: () => Promise<unknown>) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockImplementation(impl) },
    configurable: true,
  });
}

beforeEach(() => {
  reportFailure.mockClear();
  resumeAudioContext.mockReset();
  resumeAudioContext.mockResolvedValue(undefined);
  createLevelTap.mockReset();
  createLevelTap.mockReturnValue(fakeTap);
  decodeToCanonical.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  setGetUserMedia(async () => new FakeStream([new FakeTrack()]));
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
});

async function mountedRecorder(): Promise<UseRecorder> {
  const ref = createRef<UseRecorder>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  if (!ref.current) throw new Error("Harness did not mount useRecorder");
  return ref.current;
}

/** Let the fire-and-forget `.catch` handlers run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function contexts(): string[] {
  return reportFailure.mock.calls.map((call) => call[1] as string);
}

describe("armForegroundResume: a refused resume on return writes a row", () => {
  it("reports the cause under recorder-foreground-resume, which does not light ≡", async () => {
    const cause = new Error("resume refused");
    resumeAudioContext.mockRejectedValue(cause);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });

    const disarm = armForegroundResume(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    disarm();

    expect(reportFailure).toHaveBeenCalledWith(
      cause,
      "recorder-foreground-resume"
    );
    expect(console.error).toHaveBeenCalledWith(
      "Could not resume the audio context on foreground",
      cause
    );
    expect(lightsFailureMarker("recorder-foreground-resume")).toBe(false);
  });
});

describe("retryDecode: a refused resume writes a row", () => {
  it("reports the cause under recorder-decode-retry-resume, which does not light ≡", async () => {
    const cause = new Error("resume refused");
    resumeAudioContext.mockRejectedValue(cause);
    decodeToCanonical.mockResolvedValue(new Float32Array(10));
    const api = await mountedRecorder();

    await act(async () => {
      await api.retryDecode(new Blob(["x"]));
      await settle();
    });

    expect(reportFailure).toHaveBeenCalledWith(
      cause,
      "recorder-decode-retry-resume"
    );
    expect(console.error).toHaveBeenCalledWith(
      "Could not resume the audio context",
      cause
    );
    expect(lightsFailureMarker("recorder-decode-retry-resume")).toBe(false);
  });
});

describe("start(): the level meter failing to open writes a row", () => {
  it("reports under recorder-tap-open, still records, and lights ≡", async () => {
    const cause = new Error("no analyser");
    createLevelTap.mockImplementation(() => {
      throw cause;
    });
    const api = await mountedRecorder();

    let started: boolean | undefined;
    await act(async () => {
      started = await api.start();
    });

    expect(started).toBe(true);
    expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-tap-open");
    expect(console.error).toHaveBeenCalledWith(
      "Could not open the level meter",
      cause
    );
    expect(lightsFailureMarker("recorder-tap-open")).toBe(true);
  });

  it("writes no tap-open row when the meter opens", async () => {
    const api = await mountedRecorder();
    await act(async () => {
      await api.start();
    });
    expect(contexts()).not.toContain("recorder-tap-open");
  });
});

describe("start(): the microphone not opening writes one row", () => {
  it("a refusal (NotAllowedError) is reported under recorder-mic-refused and does not light ≡", async () => {
    const cause = new DOMException("refused", "NotAllowedError");
    setGetUserMedia(async () => {
      throw cause;
    });
    const api = await mountedRecorder();

    await act(async () => {
      await api.start();
      await settle();
    });

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-mic-refused");
    expect(console.error).not.toHaveBeenCalled();
    expect(lightsFailureMarker("recorder-mic-refused")).toBe(false);
  });

  it.each([
    "NotFoundError",
    "NotReadableError",
    "OverconstrainedError",
    "AbortError",
    "SecurityError",
  ])(
    "%s is reported under recorder-mic-start, with its name, and lights ≡",
    async (name) => {
      const cause = new DOMException("failed", name);
      setGetUserMedia(async () => {
        throw cause;
      });
      const api = await mountedRecorder();

      await act(async () => {
        await api.start();
        await settle();
      });

      expect(reportFailure).toHaveBeenCalledTimes(1);
      expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-mic-start");
      expect(console.error).not.toHaveBeenCalled();
      expect((reportFailure.mock.calls[0]![0] as DOMException).name).toBe(name);
      expect(lightsFailureMarker("recorder-mic-start")).toBe(true);
    }
  );

  it("a throw that is not a DOMException is reported under recorder-mic-start", async () => {
    const cause = new TypeError("no mediaDevices");
    setGetUserMedia(async () => {
      throw cause;
    });
    const api = await mountedRecorder();

    await act(async () => {
      await api.start();
    });

    expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-mic-start");
  });

  it("a start that a cancel() superseded writes no row", async () => {
    let reject: (cause: unknown) => void = () => {};
    setGetUserMedia(
      () =>
        new Promise((_resolve, rej) => {
          reject = rej;
        })
    );
    const api = await mountedRecorder();

    await act(async () => {
      const pending = api.start();
      api.cancel();
      reject(new DOMException("failed", "NotReadableError"));
      await pending;
    });

    expect(contexts()).not.toContain("recorder-mic-start");
    expect(contexts()).not.toContain("recorder-mic-refused");
  });
});
