// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
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
 * #1265 item 2: `playTake` resumes the audio context inside the tap and then
 * reads the clip before `playSamples` takes its own claim. This pins the
 * wiring that closes that window: a shared-context claim is taken in the tap,
 * before the read starts, and released only once the read/play flow is over,
 * on every exit. What the claim does to a `devicechange` is pinned in
 * `tests/playback-clock-stall.test.ts`; `audio-io` is mocked here.
 */

const mocks = vi.hoisted(() => ({
  playSamples: vi.fn(),
  loadSegmentClip: vi.fn(),
  log: [] as string[],
}));

vi.mock("@/hooks/audio-io", () => ({
  playSamples: mocks.playSamples,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  claimSharedContext: vi.fn(() => {
    mocks.log.push("claim");
    return () => {
      mocks.log.push("release");
    };
  }),
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
  mocks.log.length = 0;
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
});

it("holds a claim from the tap, across the clip read and the play, and releases it once", async () => {
  let finishRead: (value: unknown) => void = () => {};
  mocks.loadSegmentClip.mockImplementationOnce(() => {
    mocks.log.push("read");
    return new Promise((resolve) => {
      finishRead = resolve;
    });
  });
  mocks.playSamples.mockImplementationOnce(async () => {
    mocks.log.push("playSamples");
    return { stop: () => {}, elapsed: () => 0, duration: 1 };
  });
  const api = await renderHarness(root);

  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });
  // Mid-read: claimed, not released.
  expect(mocks.log).toEqual(["claim", "read"]);

  await act(async () => {
    finishRead(resolvedClip(new Int16Array([1, 2])));
    await flush();
  });
  expect(mocks.log).toEqual(["claim", "read", "playSamples", "release"]);
});

it("releases the claim when the clip read throws", async () => {
  mocks.loadSegmentClip.mockRejectedValueOnce(new Error("disk gone"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const api = await renderHarness(root);

  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });

  expect(mocks.log).toEqual(["claim", "release"]);
});

it("releases the claim when the segment has no audio to play", async () => {
  mocks.loadSegmentClip.mockResolvedValueOnce({ kind: "empty" });
  const api = await renderHarness(root);

  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });

  expect(mocks.playSamples).not.toHaveBeenCalled();
  expect(mocks.log).toEqual(["claim", "release"]);
});
