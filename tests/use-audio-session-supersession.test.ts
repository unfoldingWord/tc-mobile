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

import {
  useAudioSession,
  type UseAudioSession,
} from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

/**
 * #650: mounts the real `useAudioSession` with `createRoot` and `act` in
 * jsdom to exercise `playTake`'s use of the arbiter's answer, including its
 * `onEnded` guard and `settle` branch around `playbackHandleRef`. The pure
 * arbiter is covered separately by `tests/audio-session.test.ts`. This runs the
 * hook over a mocked `./audio-io`, `./use-recorder` and
 * `@/lib/storage/segment-audio`, and drives the exact race #650 names: tap
 * segment A, tap segment B before A's `playSamples` has resolved, then
 * resolve A.
 */

const mocks = vi.hoisted(() => ({
  playSamples: vi.fn(),
  loadSegmentClip: vi.fn(),
}));

vi.mock("@/hooks/audio-io", () => ({
  playSamples: mocks.playSamples,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  decodeMp3ToCanonical: vi.fn(),
}));

// A STABLE object, not a fresh one per call: `useAudioSession`'s `leave`
// depends on `recorder.cancel`'s identity (among others), and `leave`'s own
// unmount-cleanup effect re-fires whenever `leave` changes identity. A mock
// that hands back a new `vi.fn()` every render would rerun that cleanup,
// calling `leave()` and resetting `playingId` to `null`.
const recorderMock = {
  start: vi.fn(),
  stop: vi.fn(),
  retryDecode: vi.fn(),
  cancel: vi.fn(),
  state: "idle",
  error: null,
  elapsedMs: 0,
  supported: true,
  readLevel: () => 0,
  readMeterAvailable: () => true,
  readScope: () => null,
  peekScope: () => null,
  meterFailed: false,
};
vi.mock("@/hooks/use-recorder", () => ({
  useRecorder: () => recorderMock,
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: mocks.loadSegmentClip,
  danglingReason: vi.fn().mockReturnValue(null),
}));

function row(id: string): SegmentRow {
  return {
    segmentId: id as SegmentId,
    ordinal: 1,
    label: null,
    hasClip: true,
    finished: false,
    clipId: null,
    peaks: null,
    durationMs: null,
  };
}

/** A resolved clip minimal enough to drive `playTake`'s pcm branch; the rest
 * of `SegmentAudio`'s shape is untouched by that code path. */
function resolvedClip(samples: Int16Array) {
  return {
    kind: "resolved",
    segment: {},
    take: {},
    clip: { encoding: "pcm", meta: {}, samples },
  };
}

function stubHandle(elapsedSeconds: number) {
  return { stop: vi.fn(), elapsed: () => elapsedSeconds, duration: 10 };
}

/** A `playSamples` call this test settles from outside, on its own schedule. */
function deferredHandle() {
  let resolve!: (handle: ReturnType<typeof stubHandle>) => void;
  const promise = new Promise<ReturnType<typeof stubHandle>>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// A ref, not a reassigned module-level binding: `react-hooks/globals` bans
// writing an outer variable during render as a side effect. `useImperativeHandle`
// commits after render, like the `RecorderHandle` pattern other jsdom-mounted
// tests here already use (`tests/recorder-superseded-writes.test.ts`).
const Harness = forwardRef<UseAudioSession>((_props, ref) => {
  const api = useAudioSession();
  useImperativeHandle(ref, () => api, [api]);
  return null;
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.playSamples.mockReset();
  mocks.loadSegmentClip.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("does not adopt a handle whose claim was superseded, and its stale onEnded leaves the current holder alone (#650)", async () => {
  const rowA = row("segment-a");
  const rowB = row("segment-b");
  mocks.loadSegmentClip
    .mockResolvedValueOnce(resolvedClip(new Int16Array([1, 2])))
    .mockResolvedValueOnce(resolvedClip(new Int16Array([3, 4])));

  const a = deferredHandle();
  const b = deferredHandle();
  mocks.playSamples
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => b.promise);

  const ref = createRef<UseAudioSession>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  const api = () => {
    if (!ref.current) throw new Error("Harness did not mount useAudioSession");
    return ref.current;
  };

  // Tap A: claims the floor, reads its clip, and calls playSamples — which
  // does not resolve yet.
  await act(async () => {
    api().playTake(rowA);
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(1);
  expect(api().playingId).toBe(rowA.segmentId);

  // Tap B before A's playSamples settles: B's claim supersedes A's
  // synchronously, inside the same tap.
  await act(async () => {
    api().playTake(rowB);
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(2);
  expect(api().playingId).toBe(rowB.segmentId);

  const callA = mocks.playSamples.mock.calls[0];
  if (!callA) throw new Error("playSamples was not called for row A");
  const optionsA = callA[1] as { onEnded?: () => void };

  // Resolve A's now-superseded claim. Nothing sounds yet for the list-take
  // path (`playbackPosition`'s `sounding` half only ever comes from the
  // buffer-preview flag), so an adopted handle is the only way this reads
  // non-null.
  const handleA = stubHandle(999);
  await act(async () => {
    a.resolve(handleA);
    await flush();
  });
  expect(handleA.stop).toHaveBeenCalledOnce();
  expect(api().readPlaybackPosition()).toBeNull();

  // A's stale onEnded must be a no-op for B's now-current state.
  await act(async () => {
    optionsA.onEnded?.();
  });
  expect(api().playingId).toBe(rowB.segmentId);
  expect(api().playbackRanOut).toBe(false);

  // B's own handle is the one that gets adopted.
  const handleB = stubHandle(5);
  await act(async () => {
    b.resolve(handleB);
    await flush();
  });
  expect(api().readPlaybackPosition()).toEqual({ ms: 5000, measured: true });
});
