// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  flush,
  makeRecorderMock,
  mountContainer,
  renderHarness,
  unmountContainer,
} from "./use-audio-session-harness";

/**
 * Three sinks that ended at `console.error` now write one failure-log row each,
 * under a context of their own: `startRecording`'s catch ("recorder-start"),
 * the buffer Play's in-tap resume ("playback-buffer-tap-resume") and the
 * sheet-open resume ("sheet-open-resume"). `audio-io` is mocked: this reads
 * what the hook reports, not what a device does.
 */

const mocks = vi.hoisted(() => ({
  resumeAudioContext: vi.fn(),
  playSamples: vi.fn(),
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

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.reportFailure.mockReset();
  mocks.resumeAudioContext.mockReset().mockResolvedValue(undefined);
  mocks.playSamples.mockReset().mockResolvedValue({
    stop: vi.fn(),
    elapsed: () => 0,
    duration: 1,
  });
  recorderMock.start.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('a start() that rejects writes one "recorder-start" row', async () => {
  const cause = new Error("start rejected");
  recorderMock.start.mockRejectedValue(cause);

  const api = await renderHarness(root);
  let started: boolean | undefined;
  await act(async () => {
    started = await api().startRecording();
    await flush();
  });

  expect(started).toBe(false);
  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(cause, "recorder-start");
});

it('a buffer Play whose in-tap resume rejects writes one "playback-buffer-tap-resume" row', async () => {
  const cause = new Error("resume refused");
  mocks.resumeAudioContext.mockRejectedValue(cause);

  const api = await renderHarness(root);
  await act(async () => {
    api().playBuffer(new Int16Array(4));
    await flush();
    await flush();
  });

  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(
    cause,
    "playback-buffer-tap-resume"
  );
});

it('opening the sheet with a resume that rejects writes one "sheet-open-resume" row', async () => {
  const cause = new Error("resume refused");
  mocks.resumeAudioContext.mockRejectedValue(cause);

  const api = await renderHarness(root);
  await act(async () => {
    api().primeAudioContext();
    await flush();
  });

  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(cause, "sheet-open-resume");
});

it("resumes that resolve write no row", async () => {
  const api = await renderHarness(root);
  await act(async () => {
    api().primeAudioContext();
    api().playBuffer(new Int16Array(4));
    await flush();
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
});
