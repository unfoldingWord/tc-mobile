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
 * #808: `releaseStream`'s two ref-nulling assignments —
 * `streamRef.current = null` and `recorderRef.current = null`
 * (`src/hooks/use-recorder.ts`) — are the cleanup a throw used to skip before
 * PR 780 (#479). `tests/stop-tracks.test.ts`'s source gate proves
 * `releaseStream` routes through `stopTracks`, but deleting either assignment
 * left that gate green: it never observes what a STALE ref does afterward.
 *
 * This mounts the real `useRecorder()` — not mocked — with `createRoot`/`act`
 * in jsdom, the same style `tests/use-audio-session-supersession.test.ts` uses
 * for `useAudioSession`. `@/hooks/audio-io` (the browser seam `use-recorder.ts`
 * already treats as injectable, and the same boundary
 * `tests/stop-tracks.test.ts` stubs from the other side) is mocked so no real
 * Web Audio graph is needed; `navigator.mediaDevices.getUserMedia` and the
 * global `MediaRecorder` are faked directly, since `use-recorder.ts` reaches
 * both itself rather than through `audio-io.ts`.
 *
 * Each case drives a SECOND call that only a stale ref can reach: a redundant
 * `cancel()`, or a `stop()` called after `cancel()`. With the assignment
 * present, `releaseStream`'s own `if (stream) ...` guard, or `stop`'s
 * `if (!recorder) return ...` guard, short-circuits the second call. With the
 * assignment deleted, the second call reads the ALREADY-RELEASED stream or
 * recorder as if it were still the live one.
 */

class FakeTrack {
  readonly kind = "audio";
  stopped = 0;
  onended: (() => void) | null = null;
  stop(): void {
    this.stopped++;
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

/**
 * Mirrors the native state machine only as far as `use-recorder.ts` reads it:
 * `"inactive"` until `start()` is called, `"recording"` after, and back to
 * `"inactive"` — synchronously, matching the DOM's own `state` field — once
 * `stop()` is called.
 */
class FakeMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(
    public readonly stream: FakeStream,
    options?: { mimeType?: string }
  ) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }
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
  // A minimal stand-in for the real helper: stop every track on the stream
  // it is given. use-recorder.ts's own ref bookkeeping — not stopTracks's
  // per-track throw handling — is what these tests are about.
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
let tracks: FakeTrack[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  tracks = [new FakeTrack(), new FakeTrack()];
  const stream = new FakeStream(tracks);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
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

async function mountStarted(): Promise<UseRecorder> {
  const ref = createRef<UseRecorder>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  if (!ref.current) throw new Error("Harness did not mount useRecorder");
  await act(async () => {
    await ref.current!.start();
  });
  return ref.current;
}

describe("releaseStream nulls streamRef.current, so a redundant cancel() cannot re-stop the capture tracks (#808)", () => {
  it("stops each capture track exactly once across two cancel() calls", async () => {
    const api = await mountStarted();
    expect(tracks.every((t) => t.stopped === 0)).toBe(true);

    act(() => {
      api.cancel();
    });
    expect(tracks.map((t) => t.stopped)).toEqual([1, 1]);

    // A second cancel() — e.g. an explicit cancel followed by the unmount
    // cleanup effect, or a pagehide landing after an explicit Back — must
    // find nothing left to release: `streamRef.current` is already null, so
    // `releaseStream`'s `if (stream) stopTracks(...)` guard must skip it.
    act(() => {
      api.cancel();
    });
    expect(tracks.map((t) => t.stopped)).toEqual([1, 1]);
  });
});

describe("releaseStream nulls recorderRef.current, so stop() after cancel() is a true no-op (#808)", () => {
  it("returns the null-recorder result instead of acting on the released recorder", async () => {
    const api = await mountStarted();

    act(() => {
      api.cancel();
    });

    // With recorderRef.current correctly null, stop()'s own
    // `if (!recorder) return { samples: null, error: null, blob: null };`
    // guard fires immediately. A stale ref instead reaches the released
    // recorder's "already inactive" branch, which seals an empty blob from
    // the chunks cancel() just cleared and reports it as silence rather than
    // as nothing to report.
    const result = await act(async () => api.stop());

    expect(result).toEqual({ samples: null, error: null, blob: null });
  });
});
