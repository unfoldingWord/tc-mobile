// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
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
 * Chapter play inside `useAudioSession` (#1468 slice b): the wiring the
 * Node tests of `hooks/chapter-player.ts` cannot see. A hidden page pauses
 * the chapter BEFORE the idle context drop; becoming visible starts nothing;
 * `leave()` and a row's Play clear chapter state; a live microphone refuses
 * it. `audio-io` is mocked, so nothing here sounds or was run on a device.
 */

const CH = "chapter-1" as ChapterId;

const mocks = vi.hoisted(() => ({
  playSamples: vi.fn(),
  loadSegmentClip: vi.fn(),
  chapterPlayCandidates: vi.fn(),
  log: [] as string[],
}));

vi.mock("@/hooks/audio-io", () => ({
  playSamples: mocks.playSamples,
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  claimSharedContext: vi.fn(() => () => {}),
  decodeMp3ToCanonical: vi.fn(),
  dropSharedContextWhenIdle: vi.fn(() => {
    mocks.log.push("drop");
  }),
  checkSharedClockOnReturn: vi.fn(() => {
    mocks.log.push("check-clock");
    return Promise.resolve();
  }),
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

let root: Root;
let container: HTMLDivElement;
let visibility: DocumentVisibilityState = "visible";
const handles: { stop: () => void }[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  mocks.log.length = 0;
  handles.length = 0;
  mocks.chapterPlayCandidates.mockReset();
  mocks.chapterPlayCandidates.mockResolvedValue([
    {
      segmentId: "s1",
      startChapterId: CH,
      audio: { kind: "playable", frames: 4 * CANONICAL_SAMPLE_RATE },
    },
    {
      segmentId: "s2",
      startChapterId: CH,
      audio: { kind: "playable", frames: 4 * CANONICAL_SAMPLE_RATE },
    },
  ]);
  mocks.loadSegmentClip.mockReset();
  mocks.loadSegmentClip.mockResolvedValue(resolvedClip(new Int16Array(4)));
  mocks.playSamples.mockReset();
  mocks.playSamples.mockImplementation(
    async (_s: Int16Array, o: { offsetSeconds: number }) => {
      mocks.log.push(`play@${o.offsetSeconds}`);
      const h = {
        stop: vi.fn(() => {
          mocks.log.push("stop");
        }),
        elapsed: () => o.offsetSeconds + 1,
        duration: 4,
      };
      handles.push(h);
      return h;
    }
  );
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
});

async function playing() {
  const api = await renderHarness(root);
  await act(async () => {
    api().playChapter(CH);
    await flush();
    await flush();
  });
  expect(api().chapterPlay.status).toBe("playing");
  return api;
}

describe("useAudioSession: chapter play", () => {
  it("a hidden page pauses the chapter before the context drop; visible starts nothing", async () => {
    const api = await playing();

    await act(async () => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    });

    expect(mocks.log.slice(-2)).toEqual(["stop", "drop"]);
    expect(api().chapterPlay).toMatchObject({
      chapterId: CH,
      status: "paused",
    });
    expect(api().readChapterProgress()).toBeGreaterThan(0);

    await act(async () => {
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    });

    expect(mocks.log.filter((l) => l.startsWith("play@"))).toEqual(["play@0"]);
    expect(api().chapterPlay.status).toBe("paused");

    // The next tap resumes where the hide left it.
    await act(async () => {
      api().playChapter(CH);
      await flush();
      await flush();
    });
    expect(mocks.log.filter((l) => l.startsWith("play@"))).toEqual([
      "play@0",
      "play@1",
    ]);
  });

  it("leave() ends chapter play and clears its state", async () => {
    const api = await playing();

    await act(async () => {
      api().leave();
      await flush();
    });

    expect(handles[0]?.stop).toHaveBeenCalled();
    expect(api().chapterPlay.status).toBe("idle");
    expect(api().readChapterProgress()).toBeNull();
  });

  it("leave() forgets a paused chapter, which holds no floor to stop", async () => {
    const api = await playing();
    await act(async () => {
      api().pauseChapter();
      await flush();
    });
    expect(api().chapterPlay.status).toBe("paused");

    await act(async () => {
      api().leave();
      await flush();
    });

    expect(api().chapterPlay.status).toBe("idle");
    expect(api().readChapterProgress()).toBeNull();
  });

  it("a row's Play takes the floor from the chapter and clears its state", async () => {
    const api = await playing();

    await act(async () => {
      api().playTake(row("other"));
      await flush();
    });

    expect(handles[0]?.stop).toHaveBeenCalled();
    expect(api().chapterPlay.status).toBe("idle");
    expect(api().playingId).toBe("other");
  });

  it("a row's Play forgets a paused chapter", async () => {
    const api = await playing();
    await act(async () => {
      api().pauseChapter();
      await flush();
    });

    await act(async () => {
      api().playTake(row("other"));
      await flush();
    });

    expect(api().chapterPlay.status).toBe("idle");
    expect(api().readChapterProgress()).toBeNull();
  });

  it("a live microphone refuses chapter play", async () => {
    recorderMock.start.mockResolvedValueOnce(new Promise(() => {}));
    const api = await renderHarness(root);
    await act(async () => {
      void api().startRecording();
      api().playChapter(CH);
      await flush();
    });

    expect(mocks.chapterPlayCandidates).not.toHaveBeenCalled();
    expect(api().chapterPlay.status).toBe("idle");
  });
});
