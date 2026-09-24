// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  deferredHandle,
  flush,
  makeRecorderMock,
  mountContainer,
  renderHarness,
  resolvedClip,
  row,
  stubHandle,
  unmountContainer,
  type RecorderMockShape,
} from "./use-audio-session-harness";

/**
 * #650: mounts the real `useAudioSession` with `createRoot` and `act` in
 * jsdom to exercise `playTake`'s use of the arbiter's answer, including its
 * `onEnded` guard and `settle` branch around `playbackHandleRef`. The pure
 * arbiter is covered separately by `tests/audio-session.test.ts`. This runs the
 * hook over a mocked `./audio-io`, `./use-recorder` and
 * `@/lib/storage/segment-audio`, and drives the exact race #650 names: tap
 * segment A, tap segment B before A's `playSamples` has resolved, then
 * resolve A. The mount harness itself is now the shared one from
 * `./use-audio-session-harness` (#816).
 */

const mocks = vi.hoisted(() => ({
  playSamples: vi.fn(),
  loadSegmentClip: vi.fn(),
  decodeMp3ToCanonical: vi.fn(),
}));

vi.mock("@/hooks/audio-io", () => ({
  playSamples: mocks.playSamples,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  decodeMp3ToCanonical: mocks.decodeMp3ToCanonical,
}));

const recorderMock: RecorderMockShape = makeRecorderMock();
vi.mock("@/hooks/use-recorder", () => ({
  useRecorder: () => recorderMock,
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: mocks.loadSegmentClip,
  danglingReason: vi.fn().mockReturnValue(null),
}));

/**
 * A resolved clip that drives `playTake`'s mp3 branch (#781's `"stored-mp3"`
 * case). `mp3` is deliberately an empty byte stream — `mp3GranuleCount`
 * (`lib/audio/mp3-align.ts`) reads zero frames from it, so `fitMp3Decode`
 * takes its `decoded.length === frames` branch (no header math needed) as
 * long as the mocked `decodeMp3ToCanonical` resolves exactly `frameCount`
 * samples, which the caller below arranges.
 */
function resolvedMp3Clip(frameCount: number) {
  return {
    kind: "resolved",
    segment: {},
    take: {},
    clip: { encoding: "mp3", meta: { frameCount }, mp3: new Uint8Array(0) },
  };
}

/** Cast for reading the `source` a `playSamples` call was made with, without
 * pulling in the full `PlaySamplesOptions` shape this test doesn't need. */
function sourceOf(call: unknown): string | undefined {
  return (call as { source?: string } | undefined)?.source;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.playSamples.mockReset();
  mocks.loadSegmentClip.mockReset();
  mocks.decodeMp3ToCanonical.mockReset();
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
});

it("does not adopt a handle whose claim was superseded, and its stale onEnded leaves the current holder alone (#650)", async () => {
  const rowA = row("segment-a");
  const rowB = row("segment-b");
  mocks.loadSegmentClip
    .mockResolvedValueOnce(resolvedClip(new Int16Array([1, 2])))
    .mockResolvedValueOnce(resolvedClip(new Int16Array([3, 4])));

  const a = deferredHandle<ReturnType<typeof stubHandle>>();
  const b = deferredHandle<ReturnType<typeof stubHandle>>();
  mocks.playSamples
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => b.promise);

  const api = await renderHarness(root);

  // Tap A: claims the floor, reads its clip, and calls playSamples — which
  // does not resolve yet.
  await act(async () => {
    api().playTake(rowA);
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(1);
  expect(api().playingId).toBe(rowA.segmentId);
  // #781: playTake over a pcm clip must label its probe source "stored-pcm" —
  // nothing else pinned that the hook passes the right `ProbeSource` per
  // caller (only what the probe DOES with a label, in tests/audio-probe.test.ts).
  expect(sourceOf(mocks.playSamples.mock.calls[0]?.[1])).toBe("stored-pcm");

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

it('labels playTake\'s probe source "stored-mp3" for a finished (mp3) clip (#781)', async () => {
  const rowM = row("segment-mp3");
  const frameCount = 4;
  mocks.loadSegmentClip.mockResolvedValueOnce(resolvedMp3Clip(frameCount));
  // Shaped so `fitMp3Decode` (which runs for real over this mock's return,
  // per #781) takes its `decoded.length === frames` branch: no granule-count
  // math applies when the decode already comes back the right length.
  mocks.decodeMp3ToCanonical.mockResolvedValueOnce(new Int16Array(frameCount));

  const handle = deferredHandle<ReturnType<typeof stubHandle>>();
  mocks.playSamples.mockImplementationOnce(() => handle.promise);

  const api = await renderHarness(root);

  await act(async () => {
    api().playTake(rowM);
    await flush();
  });

  expect(mocks.playSamples).toHaveBeenCalledTimes(1);
  expect(sourceOf(mocks.playSamples.mock.calls[0]?.[1])).toBe("stored-mp3");
});
