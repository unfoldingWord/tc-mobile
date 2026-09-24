import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  pauseTranscodeSweep,
  requestTranscodeSweep,
  resumeTranscodeSweep,
} from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentAudio } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import type { AudioCodec, Clip } from "@/types/audio";
import type {
  ChapterId,
  ClipId,
  Segment,
  SegmentId,
  TakeId,
} from "@/types/domain";

vi.mock("@/hooks/mp3-codec");
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const sid = (s: string) => s as SegmentId;
const cid = (s: string) => s as ClipId;

function segment(id: SegmentId): Segment {
  return {
    id,
    chapterId: "ch" as ChapterId,
    index: 1,
    reference: null,
    label: null,
    activeTakeId: "take" as TakeId,
    status: "affirmed",
  };
}

function pcmClip(id: ClipId, samples: Int16Array): Clip {
  return {
    encoding: "pcm",
    meta: {
      id,
      sampleRate: 22_050,
      frameCount: samples.length,
      durationMs: 1,
      createdAt: 0,
      encoding: "pcm",
      generation: 0,
      byteLength: samples.length * 2,
      transcodeStallCount: 0,
      peaks: null,
    },
    samples,
  };
}

function resolvedPcm(segmentId: SegmentId, clipId: ClipId): SegmentAudio<Clip> {
  return {
    kind: "resolved",
    segment: segment(segmentId),
    take: {
      id: "take" as TakeId,
      segmentId,
      clipId,
      createdAt: 0,
      durationMs: 1,
    },
    clip: pcmClip(clipId, Int16Array.of(1)),
  };
}

const codec = (): AudioCodec => ({
  encodeMp3: async () => new Uint8Array([1]),
  decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
});

describe("the transcode sweep pause/resume gate", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
      work(codec())
    );
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
      resolvedPcm(segmentId, cid(`clip-${segmentId}`))
    );
    vi.mocked(commitTranscode).mockResolvedValue("committed");
    // The sweep's state is module-scoped, so a run an earlier case left in
    // flight would spend THIS case's mocks. Join it on an empty owed list —
    // `requestTranscodeSweep` returns the run in progress when there is one —
    // and only then let the case start counting.
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([]);
    await requestTranscodeSweep();
    vi.mocked(listPcmFinishedSegments).mockClear();
    vi.mocked(commitTranscode).mockClear();
  });

  it("defers requested work while paused, then resumes it", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("clip-s1") },
    ]);

    pauseTranscodeSweep("save-failed");
    await requestTranscodeSweep();

    expect(listPcmFinishedSegments).not.toHaveBeenCalled();
    expect(commitTranscode).not.toHaveBeenCalled();

    resumeTranscodeSweep("save-failed");

    await vi.waitFor(() => {
      expect(commitTranscode).toHaveBeenCalledTimes(1);
    });
  });

  it("stops between segments when a pause is requested during a run", async () => {
    vi.mocked(listPcmFinishedSegments)
      .mockResolvedValueOnce([
        { segmentId: sid("s1"), clipId: cid("clip-s1") },
        { segmentId: sid("s2"), clipId: cid("clip-s2") },
      ])
      .mockResolvedValue([{ segmentId: sid("s2"), clipId: cid("clip-s2") }]);
    vi.mocked(commitTranscode).mockImplementationOnce(async () => {
      pauseTranscodeSweep("save-failed");
      return "committed";
    });

    await requestTranscodeSweep();

    expect(commitTranscode).toHaveBeenCalledTimes(1);

    resumeTranscodeSweep("save-failed");

    await vi.waitFor(() => {
      expect(commitTranscode).toHaveBeenCalledTimes(2);
    });
  });
  it("hands a request that arrived during the run to the resume", async () => {
    // The pause lands while the LAST segment of the pass commits, so
    // `sweepOnce`'s per-segment check never runs again and `runSweeps` is where
    // the pause is noticed — with `requestedDuringRun` set by the transition
    // that asked for another pass. Nothing else will ask again: the resume is
    // the only thing left that can spend it.
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("clip-s1") },
      { segmentId: sid("s2"), clipId: cid("clip-s2") },
    ]);
    let commits = 0;
    vi.mocked(commitTranscode).mockImplementation(async () => {
      commits += 1;
      if (commits === 2) {
        // A Finished transition asks for another pass, and the save-failure
        // screen mounts, both while this commit is in flight.
        void requestTranscodeSweep();
        pauseTranscodeSweep("save-failed");
      }
      return "committed";
    });

    await requestTranscodeSweep();
    expect(commitTranscode).toHaveBeenCalledTimes(2);

    resumeTranscodeSweep("save-failed");

    // Polled, never joined. `requestTranscodeSweep` would START the run this
    // case exists to observe — awaiting it here would pass whether or not the
    // resume did anything, which is the whole assertion.
    await vi.waitFor(() => {
      expect(vi.mocked(commitTranscode).mock.calls.length).toBeGreaterThan(2);
    });
  });
});
