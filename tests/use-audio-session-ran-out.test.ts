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
 * #361 (the instance raised from #618/#601): `playTake`'s `onEnded` in
 * `use-audio-session.ts` calls `setPlaying(null, true)`, and that `true` is
 * the only place `playbackRanOut` is ever produced. The #361 comment that
 * raised this said "nothing in tests/ mounts useAudioSession" — that is now
 * stale (`tests/use-audio-session-supersession.test.ts`,
 * `tests/use-audio-session-buffer-supersession.test.ts`, #735/#739), so this
 * file adds the missing instance using that same jsdom-mount harness rather
 * than reopening the umbrella issue's claim.
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

// A STABLE object, not a fresh one per call: see the identical note in
// `tests/use-audio-session-supersession.test.ts` — a mock that hands back a
// new `vi.fn()` every render makes every render's commit look like an
// unmount, which calls `leave()` and resets `playingId` before this test ever
// reads it.
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

/** A resolved clip minimal enough to drive `playTake`'s pcm branch. */
function resolvedClip(samples: Int16Array) {
  return {
    kind: "resolved",
    segment: {},
    take: {},
    clip: { encoding: "pcm", meta: {}, samples },
  };
}

/** A `playSamples` call this test settles from outside, on its own schedule. */
function deferredHandle() {
  let resolve!: (handle: {
    stop: () => void;
    elapsed: () => number;
    duration: number;
  }) => void;
  const promise = new Promise<{
    stop: () => void;
    elapsed: () => number;
    duration: number;
  }>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// A ref, not a reassigned module-level binding: see the identical note in
// `tests/use-audio-session-supersession.test.ts`.
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

it("playTake's onEnded is the producer: invoking it flips playbackRanOut true (#361)", async () => {
  const rowA = row("segment-a");
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([1, 2]))
  );
  const a = deferredHandle();
  mocks.playSamples.mockImplementationOnce(() => a.promise);

  const ref = createRef<UseAudioSession>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  const api = () => {
    if (!ref.current) throw new Error("Harness did not mount useAudioSession");
    return ref.current;
  };

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
  const a = deferredHandle();
  mocks.playSamples.mockImplementationOnce(() => a.promise);

  const ref = createRef<UseAudioSession>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  const api = () => {
    if (!ref.current) throw new Error("Harness did not mount useAudioSession");
    return ref.current;
  };

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
