import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { EncoderStalledError, withEncoder } from "@/hooks/mp3-codec";
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
 * The Finished sweep and a STALLED encoder (#166, R2 P2-1).
 *
 * `finish-transcode.test.ts` covers the sweep's per-segment error ISOLATION — a
 * plain load/encode/commit failure is logged and the loop moves to the next
 * segment. A stalled encoder is different in kind: it is the whole worker being
 * wedged, so continuing would re-arm the same silence deadline on every remaining
 * segment (N × the timeout) and hold the lane against every queued Share the whole
 * time. The sweep must BREAK on `EncoderStalledError` while still CONTINUING on a
 * plain error. Both branches are asserted here.
 *
 * The codec module is only partially mocked so `EncoderStalledError` stays the
 * REAL class — the sweep's `instanceof` check is exactly what is under test — while
 * `withEncoder` is a stub whose per-segment behaviour each case drives.
 */

vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return { ...actual, withEncoder: vi.fn() };
});
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
      peaks: null,
    },
    samples,
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
    clip: pcmClip(clipId, samples),
  };
}

/** A codec whose encode is supplied per case; decode is never used in a sweep. */
function codec(encodeMp3: AudioCodec["encodeMp3"]): AudioCodec {
  return {
    encodeMp3,
    decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
  };
}

let encodeMp3: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  encodeMp3 = vi.fn(
    async (samples: Int16Array) => new Uint8Array([samples[0] ?? 0])
  );
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]))
  );
  vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
    segmentId === sid("s1")
      ? resolvedPcm(cid("c1"), Int16Array.of(1))
      : resolvedPcm(cid("c2"), Int16Array.of(2))
  );
  vi.mocked(commitTranscode).mockResolvedValue("committed");
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([
    { segmentId: sid("s1"), clipId: cid("c1") },
    { segmentId: sid("s2"), clipId: cid("c2") },
  ]);
});

describe("requestTranscodeSweep — a stalled encoder", () => {
  it("BREAKS the sweep on EncoderStalledError, leaving later segments untouched", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // s1's encode reports the worker wedged; s2 would encode fine.
      encodeMp3.mockImplementation(async (s: Int16Array) => {
        if (s[0] === 1) throw new EncoderStalledError(15_000);
        return new Uint8Array([s[0] ?? 0]);
      });

      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      // The lane turn for s1 ran and stalled; s2's turn NEVER started — the sweep
      // stopped rather than re-arm the deadline on it and block queued Shares.
      expect(withEncoder).toHaveBeenCalledTimes(1);
      expect(loadSegmentClip).toHaveBeenCalledTimes(1);
      expect(commitTranscode).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("CONTINUES to the next segment on a plain encode error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // s1's encode fails in an ordinary, per-segment way — NOT a stall.
      encodeMp3.mockImplementation(async (s: Int16Array) => {
        if (s[0] === 1) throw new Error("one bad clip");
        return new Uint8Array([s[0] ?? 0]);
      });

      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      // Isolation preserved: s2 still gets its turn and commits.
      expect(withEncoder).toHaveBeenCalledTimes(2);
      expect(commitTranscode).toHaveBeenCalledTimes(1);
      expect(commitTranscode).toHaveBeenCalledWith(
        sid("s2"),
        cid("c2"),
        expect.any(Uint8Array),
        expect.anything()
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
