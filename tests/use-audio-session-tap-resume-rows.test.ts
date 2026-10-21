// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ChapterId } from "@/types/domain";

import {
  flush,
  makeRecorderMock,
  mountContainer,
  renderHarness,
  resolvedClip,
  row,
  unmountContainer,
} from "./use-audio-session-harness";

/**
 * #1559: the in-tap `resumeAudioContext()` of a chapter Play and of a take's
 * Play used to end at `console.error`. A rejected resume now writes one
 * failure-log row, `"chapter-play"` and `"playback-tap-resume"`. `audio-io`
 * is mocked: this reads what the hook reports, not what a device does.
 */

const mocks = vi.hoisted(() => ({
  playSamples: vi.fn(),
  loadSegmentClip: vi.fn(),
  chapterPlayCandidates: vi.fn(),
  resumeAudioContext: vi.fn(),
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/audio-io", () => ({
  playSamples: mocks.playSamples,
  resumeAudioContext: mocks.resumeAudioContext,
  claimSharedContext: vi.fn(() => () => {}),
  decodeMp3ToCanonical: vi.fn(),
  dropSharedContextWhenIdle: vi.fn(),
  checkSharedClockOnReturn: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/hooks/report-failure", () => ({
  reportFailure: mocks.reportFailure,
}));

const recorderMock = { ...makeRecorderMock(), seal: vi.fn(() => false) };
vi.mock("@/hooks/use-recorder", () => ({
  useRecorder: () => recorderMock,
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: mocks.loadSegmentClip,
  danglingReason: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/storage/books", () => ({
  chapterPlayCandidates: mocks.chapterPlayCandidates,
}));

const CH = "chapter-1" as ChapterId;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.playSamples.mockReset().mockResolvedValue({
    stop: vi.fn(),
    elapsed: () => 0,
    duration: 1,
  });
  mocks.reportFailure.mockReset();
  mocks.resumeAudioContext.mockReset();
  mocks.loadSegmentClip
    .mockReset()
    .mockResolvedValue(resolvedClip(new Int16Array(4)));
  mocks.chapterPlayCandidates.mockReset().mockResolvedValue([
    {
      segmentId: "s1",
      startChapterId: CH,
      audio: { kind: "playable", frames: 4 },
    },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('a chapter Play whose in-tap resume rejects writes one "chapter-play" row', async () => {
  const cause = new Error("resume refused");
  mocks.resumeAudioContext.mockRejectedValue(cause);

  const api = await renderHarness(root);
  await act(async () => {
    api().playChapter(CH);
    await flush();
    await flush();
  });

  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(cause, "chapter-play");
});

it('a take Play whose in-tap resume rejects writes one "playback-tap-resume" row', async () => {
  const cause = new Error("resume refused");
  mocks.resumeAudioContext.mockRejectedValue(cause);

  const api = await renderHarness(root);
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
    await flush();
  });

  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(
    cause,
    "playback-tap-resume"
  );
});

it("a resume that resolves writes no row from either tap", async () => {
  mocks.resumeAudioContext.mockResolvedValue(undefined);

  const api = await renderHarness(root);
  await act(async () => {
    api().playChapter(CH);
    await flush();
    await flush();
  });
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
});
