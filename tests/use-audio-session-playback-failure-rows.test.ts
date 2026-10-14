// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  PlaybackClockStalledError,
  PlaybackResumeError,
} from "@/hooks/playback-resume-error";

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
 * #1213's diagnostic: the playback catch sites in `useAudioSession` that
 * used to end at `console.error` now also write a failure-log row, under
 * `"playback-take"`, `"playback-buffer"` and `"playback-dangling"`.
 *
 * Three rules are pinned here. A failure that is not the #469 resume bound
 * writes exactly one row. The #469 error (`PlaybackResumeError`), whose row
 * `playSamples` has already written, writes none here. A failure belonging
 * to a superseded Play writes none.
 */

const mocks = vi.hoisted(() => ({
  playSamples: vi.fn(),
  loadSegmentClip: vi.fn(),
  danglingReason: vi.fn(),
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/audio-io", () => ({
  playSamples: mocks.playSamples,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  claimSharedContext: vi.fn(() => vi.fn()),
  decodeMp3ToCanonical: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({
  reportFailure: mocks.reportFailure,
}));

const recorderMock: RecorderMockShape = makeRecorderMock();
vi.mock("@/hooks/use-recorder", () => ({
  useRecorder: () => recorderMock,
}));

vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: mocks.loadSegmentClip,
  danglingReason: mocks.danglingReason,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.playSamples.mockReset();
  mocks.loadSegmentClip.mockReset();
  mocks.danglingReason.mockReset().mockReturnValue(null);
  mocks.reportFailure.mockReset();
  // The catch sites keep their console.error beside the new row; silence it
  // so the run output stays readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('a playTake failure that is not the #469 resume bound writes exactly one "playback-take" row', async () => {
  const cause = new Error("decode failed");
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([1, 2]))
  );
  mocks.playSamples.mockRejectedValueOnce(cause);

  const api = await renderHarness(root);
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });

  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(cause, "playback-take");
  expect(api().error).not.toBeNull();
});

it("a playTake failure that IS the #469 resume bound writes no second row (playSamples already wrote it)", async () => {
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([1, 2]))
  );
  mocks.playSamples.mockRejectedValueOnce(
    new PlaybackResumeError("did not settle within 1000 ms")
  );

  const api = await renderHarness(root);
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
  // The user-facing outcome is unchanged: the notice still shows.
  expect(api().error).not.toBeNull();
});

it("a playTake failure belonging to a superseded Play writes no row", async () => {
  mocks.loadSegmentClip
    .mockResolvedValueOnce(resolvedClip(new Int16Array([1, 2])))
    .mockResolvedValueOnce(resolvedClip(new Int16Array([3, 4])));
  let rejectA!: (cause: unknown) => void;
  const a = new Promise((_resolve, reject) => {
    rejectA = reject;
  });
  const b = deferredHandle<unknown>();
  mocks.playSamples
    .mockImplementationOnce(() => a)
    .mockImplementationOnce(() => b.promise);

  const api = await renderHarness(root);
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });
  await act(async () => {
    api().playTake(row("segment-b"));
    await flush();
  });
  await act(async () => {
    rejectA(new Error("A failed after B took the floor"));
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
});

it('a playTake of a segment whose audio is missing writes one "playback-dangling" row', async () => {
  mocks.loadSegmentClip.mockResolvedValueOnce({ kind: "clip-missing" });
  mocks.danglingReason.mockReturnValueOnce("clip c1 is not in the database");

  const api = await renderHarness(root);
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });

  expect(mocks.playSamples).not.toHaveBeenCalled();
  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining("clip c1 is not in the database"),
    }),
    "playback-dangling"
  );
});

it('a playBuffer failure that is not the #469 resume bound writes exactly one "playback-buffer" row', async () => {
  const cause = new Error("createBuffer threw");
  mocks.playSamples.mockRejectedValueOnce(cause);

  const api = await renderHarness(root);
  await act(async () => {
    api().playBuffer(new Int16Array([1, 2, 3]));
    await flush();
  });

  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(cause, "playback-buffer");
});

it("a playBuffer failure that IS the #469 resume bound writes no second row", async () => {
  mocks.playSamples.mockRejectedValueOnce(
    new PlaybackResumeError("still needs resume")
  );

  const api = await renderHarness(root);
  await act(async () => {
    api().playBuffer(new Int16Array([1, 2, 3]));
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
});

it("a playTake whose clock stalled (#1251) writes no second row, and ends the Play as failed", async () => {
  mocks.loadSegmentClip.mockResolvedValueOnce(
    resolvedClip(new Int16Array([1, 2]))
  );
  mocks.playSamples.mockRejectedValueOnce(
    new PlaybackClockStalledError("currentTime did not advance")
  );

  const api = await renderHarness(root);
  await act(async () => {
    api().playTake(row("segment-a"));
    await flush();
  });

  // playSamples wrote the "playback-clock-stalled" row itself.
  expect(mocks.reportFailure).not.toHaveBeenCalled();
  // The same end as any failed Play: the notice, and the button reset.
  expect(api().error).not.toBeNull();
  expect(api().playingId).toBeNull();
});

it("a playBuffer whose clock stalled (#1251) writes no second row, and ends the Play as failed", async () => {
  mocks.playSamples.mockRejectedValueOnce(
    new PlaybackClockStalledError("currentTime did not advance")
  );

  const api = await renderHarness(root);
  await act(async () => {
    api().playBuffer(new Int16Array([1, 2, 3]));
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
  expect(api().error).not.toBeNull();
  expect(api().playingBuffer).toBe(false);
});

it("a playBuffer failure that lands after the translator pressed Stop writes no row", async () => {
  let rejectA!: (cause: unknown) => void;
  mocks.playSamples.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectA = reject;
      })
  );

  const api = await renderHarness(root);
  await act(async () => {
    api().playBuffer(new Int16Array([1, 2, 3]));
    await flush();
  });
  // The second press on a sounding buffer is Stop, which releases the claim.
  await act(async () => {
    api().playBuffer(new Int16Array([1, 2, 3]));
    await flush();
  });
  await act(async () => {
    rejectA(new Error("failed after Stop"));
    await flush();
  });

  expect(mocks.reportFailure).not.toHaveBeenCalled();
});
