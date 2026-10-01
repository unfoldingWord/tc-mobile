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
  unmountContainer,
  type RecorderMockShape,
} from "./use-audio-session-harness";

/**
 * #361 (the instance raised from #618/#601): `playTake`'s `onEnded` in
 * `use-audio-session.ts` calls `setPlaying(null, true)`, and that `true` is
 * the only place `playbackRanOut` is ever produced. The #361 comment that
 * raised this said "nothing in tests/ mounts useAudioSession" — that is now
 * stale (`tests/use-audio-session-supersession.test.ts`,
 * `tests/use-audio-session-buffer-supersession.test.ts`, #735/#739), so this
 * file adds the missing instance using the same jsdom-mount harness rather
 * than reopening the umbrella issue's claim. The harness itself is now the
 * shared one from `./use-audio-session-harness` (#816).
 *
 * This mounts the real `useAudioSession` hook over a mocked `./audio-io`,
 * `./use-recorder` and `@/lib/storage/segment-audio`, drives `playTake` over
 * a resolved pcm clip, captures the `onEnded` handed to the mocked
 * `playSamples`, and invokes it directly to stand in for the clip running out
 * (a real run-out is `audio-io.ts`'s own `source.onended`, out of reach from
 * Node). The control tap (a second `playTake` on the same row before the
 * first has resolved) drives the hook's existing hand-stop branch instead,
 * which must leave `playbackRanOut` false.
 *
 * Both assertions are red-first BY MUTATION, per AGENTS.md ("where the code
 * already exists, get the same signal by mutation"): the guard already exists
 * in `use-audio-session.ts`, so there is no broken state to write this test
 * against. Observed pass/fail pairs are reported in the PR body, not here
 * (AGENTS.md bars a run's output from living in a comment).
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

const recorderMock: RecorderMockShape = makeRecorderMock();
vi.mock("@/hooks/use-recorder", () => ({
  useRecorder: () => recorderMock,
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: mocks.loadSegmentClip,
  danglingReason: vi.fn().mockReturnValue(null),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.playSamples.mockReset();
  mocks.loadSegmentClip.mockReset();
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
});

it("playTake's onEnded is the producer: invoking it flips playbackRanOut true (#361)", async () => {
  const rowA = row("segment-a");
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([1, 2]))
  );
  const a = deferredHandle<{
    stop: () => void;
    elapsed: () => number;
    duration: number;
  }>();
  mocks.playSamples.mockImplementationOnce(() => a.promise);

  const api = await renderHarness(root);

  await act(async () => {
    api().playTake(rowA);
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(1);
  expect(api().playingId).toBe(rowA.segmentId);
  expect(api().playbackRanOut).toBe(false);

  const call = mocks.playSamples.mock.calls[0];
  if (!call) throw new Error("playSamples was not called for row A");
  const options = call[1] as { onEnded?: () => void };
  expect(options.onEnded).toEqual(expect.any(Function));

  await act(async () => {
    options.onEnded?.();
  });

  expect(api().playingId).toBeNull();
  expect(api().playbackRanOut).toBe(true);
});

it("a hand stop (tapping the sounding row again) does NOT set playbackRanOut (control)", async () => {
  const rowA = row("segment-a");
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([1, 2]))
  );
  const a = deferredHandle<{
    stop: () => void;
    elapsed: () => number;
    duration: number;
  }>();
  mocks.playSamples.mockImplementationOnce(() => a.promise);

  const api = await renderHarness(root);

  // Tap A, then tap A again before its `playSamples` has resolved: the second
  // tap lands on the hook's existing "already playing this row" branch, which
  // stops it by hand (`setPlaying(null)`, no `ranOut`) rather than through
  // `onEnded`.
  await act(async () => {
    api().playTake(rowA);
    api().playTake(rowA);
    await flush();
  });

  // The first tap really started a load (an idle, never-played session would
  // also read null/false below), and the second tap did not start another.
  expect(mocks.loadSegmentClip).toHaveBeenCalledTimes(1);
  expect(mocks.playSamples).not.toHaveBeenCalled();
  expect(api().playingId).toBeNull();
  expect(api().playbackRanOut).toBe(false);
});
