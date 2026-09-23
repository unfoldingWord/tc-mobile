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
 * #650 named this hole in both copies of the playback tail; #735 closed it
 * for `playTake` (`tests/use-audio-session-supersession.test.ts`) and its own
 * docblock named `playBuffer`'s copy as the sibling left open — filed here as
 * #736. This is that coverage, for `playBuffer`'s `onEnded` guard
 * (`src/hooks/use-audio-session.ts:433`) and its `settle`/`playbackHandleRef`
 * assignment (`:449-451`).
 *
 * `playBuffer` treats a SECOND tap while `playingBufferRef.current` is true as
 * a stop, not a new claim (there is only one working buffer) — so this test
 * cannot supersede a buffer claim with a second `playBuffer` call the way
 * #735 supersedes one `playTake` with another. It supersedes the buffer claim
 * with a `playTake` call instead (both claim the same `"take"` floor kind in
 * `lib/audio/session.ts`, so a `playTake` claim while a buffer claim is
 * outstanding invalidates the buffer's token exactly as a second `playTake`
 * would), then taps `playBuffer` again — now that `playingBufferRef.current`
 * has been reset by the take's `claimFloor` — to give a THIRD claim something
 * live and observable (`playingBuffer === true`) for the first buffer's stale
 * `onEnded` to corrupt if the guard were missing.
 *
 * Both assertions below are red-first BY MUTATION, per AGENTS.md ("where the
 * code already exists, get the same signal by mutation"): the guards already
 * exist, so there is no broken state to write this test against. Verified
 * manually, not captured in this file (AGENTS.md bars a run's output from
 * living in a comment) — see the PR body's mutation table for the observed
 * pass/fail pairs.
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

// A STABLE object, not a fresh one per call — see #735's identical note:
// `useAudioSession`'s `leave` depends on `recorder.cancel`'s identity (among
// others), and `leave`'s own unmount-cleanup effect re-fires whenever `leave`
// changes identity. A mock that hands back a new `vi.fn()` every render made
// every render's commit look like an unmount.
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

// A ref, not a reassigned module-level binding — see #735's identical note.
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

it("does not adopt a superseded playBuffer handle, and its stale onEnded leaves the current buffer holder alone (#736)", async () => {
  const rowX = row("segment-x");
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([9, 9]))
  );

  const bufferA = new Int16Array([1, 2]);
  const bufferC = new Int16Array([5, 6]);

  const a = deferredHandle();
  const x = deferredHandle();
  const c = deferredHandle();
  mocks.playSamples
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => x.promise)
    .mockImplementationOnce(() => c.promise);

  const ref = createRef<UseAudioSession>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  const api = () => {
    if (!ref.current) throw new Error("Harness did not mount useAudioSession");
    return ref.current;
  };

  const onEndedA = vi.fn();

  // Tap buffer A: claims the floor, calls playSamples, does not resolve yet.
  await act(async () => {
    api().playBuffer(bufferA, 0, { onEnded: onEndedA });
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(1);
  expect(api().playingBuffer).toBe(true);
  // #781: playBuffer must label its probe source "working" — nothing else
  // pinned that the hook passes the right `ProbeSource` per caller (only what
  // the probe DOES with a label, in tests/audio-probe.test.ts).
  expect(
    (mocks.playSamples.mock.calls[0]?.[1] as { source?: string } | undefined)
      ?.source
  ).toBe("working");

  // Tap take X before A's playSamples settles: X claims the same "take" floor
  // kind, which supersedes A's token exactly as a second playTake would (both
  // paths call `session.claim("take")` — see `lib/audio/session.ts`).
  // `claimFloor` also resets `playingBufferRef.current`, so this is the take
  // path taking over the floor from the buffer path.
  await act(async () => {
    api().playTake(rowX);
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(2);
  expect(api().playingId).toBe(rowX.segmentId);
  expect(api().playingBuffer).toBe(false);

  // Tap buffer C: `playingBufferRef.current` is false again (X's claim reset
  // it), so this takes the claim path, not the stop path — a fresh, live
  // buffer claim for A's stale onEnded to threaten.
  await act(async () => {
    api().playBuffer(bufferC);
    await flush();
  });
  expect(mocks.playSamples).toHaveBeenCalledTimes(3);
  expect(api().playingBuffer).toBe(true);
  expect(api().playingId).toBeNull();

  const callA = mocks.playSamples.mock.calls[0];
  if (!callA) throw new Error("playSamples was not called for buffer A");
  const optionsA = callA[1] as { onEnded?: () => void };

  // Resolve A's now-superseded claim. `settle` must refuse it, stop the
  // handle itself, and — the part an unconditional assignment would skip —
  // leave `playbackHandleRef` alone: C's claim is live but has not settled
  // its own handle yet, so the correct read here is still "sounding, not
  // measured", never A's (stopped) 999s elapsed (mutation 2's guard). This
  // check must run BEFORE C resolves: C's own later, correct assignment would
  // silently overwrite an unconditional assignment from A and hide the bug.
  const handleA = stubHandle(999);
  await act(async () => {
    a.resolve(handleA);
    await flush();
  });
  expect(handleA.stop).toHaveBeenCalledOnce();
  expect(api().readPlaybackPosition()).toEqual({ ms: 0, measured: false });

  // A's stale onEnded must be a no-op for C's now-current buffer claim
  // (mutation 1's guard): C's `playingBuffer` state, and the caller's own
  // `onEnded`, must be untouched.
  await act(async () => {
    optionsA.onEnded?.();
  });
  expect(onEndedA).not.toHaveBeenCalled();
  expect(api().playingBuffer).toBe(true);

  // C's own handle is the one that gets adopted.
  const handleC = stubHandle(7);
  await act(async () => {
    c.resolve(handleC);
    await flush();
  });
  expect(api().readPlaybackPosition()).toEqual({ ms: 7000, measured: true });

  // X's deferred handle is left unresolved by design: this test only needs
  // X's claim to have existed long enough to reset the buffer flag above.
  void x;
});
