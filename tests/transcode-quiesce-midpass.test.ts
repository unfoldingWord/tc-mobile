import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  quiesceTranscodeSweep,
  requestTranscodeSweep,
} from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentAudio } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import type { AudioCodec, Clip } from "@/types/audio";
import type { ChapterId, ClipId, Segment, TakeId } from "@/types/domain";
import type { SegmentId } from "@/types/domain";

/**
 * Quiescing a pass that is ALREADY walking the backlog (#205, George R5 P2-3).
 *
 * A second file rather than a third case in `transcode-quiesce.test.ts`, for the
 * reason that file gives: `quiesced` is one-way module state on purpose, so the
 * first case to set it decides the module's state for every case after it, and
 * Vitest's isolation is per FILE. Two small files beat re-importing the module
 * graph inside a test, which would have to re-import the mocked modules too and
 * would be harness machinery in place of a test.
 *
 * Why the case matters on its own: quiescing only BETWEEN passes would let the
 * rest of an in-flight list run to the end, and the list is exactly the backlog
 * the launch sweep exists for. That is the unbounded producer against the 50-row
 * ring, so the flag has to be read per segment.
 */

vi.mock("@/hooks/mp3-codec");
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const sid = (s: string) => s as SegmentId;
const cid = (s: string) => s as ClipId;

function segment(): Segment {
  return {
    id: sid("seg"),
    chapterId: "ch" as ChapterId,
    index: 1,
    reference: null,
    label: null,
    activeTakeId: "take" as TakeId,
    status: "affirmed",
  };
}

function resolvedPcm(clipId: ClipId, samples: Int16Array): SegmentAudio<Clip> {
  return {
    kind: "resolved",
    segment: segment(),
    take: {
      id: "take" as TakeId,
      segmentId: sid("seg"),
      clipId,
      createdAt: 0,
      durationMs: 1,
    },
    clip: {
      encoding: "pcm",
      meta: {
        id: clipId,
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
    },
  };
}

const codec = (): AudioCodec => ({
  encodeMp3: async () => new Uint8Array([1]),
  decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
});

describe("a sweep already in flight when the crash screen goes up", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
      work(codec())
    );
    vi.mocked(loadSegmentClip).mockResolvedValue(
      resolvedPcm(cid("c1"), Int16Array.of(1))
    );
  });

  it("stops at the next clip, not at the end of the backlog", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
      { segmentId: sid("s2"), clipId: cid("c2") },
      { segmentId: sid("s3"), clipId: cid("c3") },
    ]);
    // The tree throws while the FIRST clip is in the encoder lane. That one
    // finishes — it holds the lane and its commit is a transaction — so exactly
    // one more row can land, and the other two never start.
    vi.mocked(loadSegmentClip).mockImplementationOnce(async () => {
      quiesceTranscodeSweep();
      return resolvedPcm(cid("c1"), Int16Array.of(1));
    });

    await requestTranscodeSweep();

    expect(loadSegmentClip).toHaveBeenCalledTimes(1);
    expect(commitTranscode).toHaveBeenCalledTimes(1);
  });
});
