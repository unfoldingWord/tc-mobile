import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
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

/**
 * Transcode on Finished (B8, D3) — the SWEEP, in Node (#181).
 *
 * The storage half (`commitTranscode`, `listPcmFinishedSegments`) is T1-tested
 * and mutation-proven in `transcode.test.ts`, so audio cannot be lost by a
 * commit. What that suite cannot reach is the sweep's own orchestration in
 * `finish-transcode.ts`: the one-at-a-time gate, the coalescing of a request
 * that lands mid-run, the per-segment skip when a clip changed under it, and the
 * per-segment error isolation whose only channel is `console.error`. If any of
 * those regress, storage relief (#12) quietly stops and nothing surfaces it.
 *
 * The codec seam is browser-only (`withEncoder` drives a Web Worker), so it is
 * faked here — the same seam `encoder-lane.test.ts` uses. The two storage reads
 * the sweep depends on are faked too, so a run's segment list and what each load
 * resolves to are under the test's control; `computePeaks` runs for real. This
 * is the suite's first `vi.mock`: the sweep is module-level singleton state
 * reached only through those seams, and controlling them is the only way to
 * drive its branches from Node.
 */

vi.mock("@/hooks/mp3-codec");
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const sid = (s: string) => s as SegmentId;
const cid = (s: string) => s as ClipId;

/** A segment the sweep never inspects — present only to satisfy the type. */
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

/** A PCM clip whose metadata id is `id` — what the sweep matches against. */
function pcmClip(
  id: ClipId,
  samples: Int16Array = Int16Array.of(1, 2, 3)
): Clip {
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

/**
 * A resolved segment load holding `clipId`. The sweep only reads `kind`, the
 * clip's `encoding`, `meta.id` and `samples`; `segment`/`take` are filled to
 * satisfy the type and are never inspected.
 */
function resolved(clipId: ClipId, samples?: Int16Array): SegmentAudio<Clip> {
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

/** A codec whose decode refuses — the sweep never decodes, only encodes. */
function codec(encodeMp3: AudioCodec["encodeMp3"]): AudioCodec {
  return {
    encodeMp3,
    decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
  };
}

let encodeMp3: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  encodeMp3 = vi.fn(async () => new Uint8Array([1, 2, 3]));
  // The lane runs the work with our codec, in order, like the real one.
  vi.mocked(withEncoder).mockImplementation((_signal, work) =>
    work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]))
  );
  vi.mocked(loadSegmentClip).mockResolvedValue(resolved(cid("c1")));
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([]);
});

describe("requestTranscodeSweep — the sweep's orchestration", () => {
  it("encodes every finished PCM segment and commits its transcode", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
      { segmentId: sid("s2"), clipId: cid("c2") },
    ]);
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
      segmentId === sid("s1") ? resolved(cid("c1")) : resolved(cid("c2"))
    );

    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
    expect(commitTranscode).toHaveBeenCalledTimes(2);
    expect(commitTranscode).toHaveBeenCalledWith(
      sid("s1"),
      cid("c1"),
      expect.any(Uint8Array),
      expect.anything()
    );
    expect(commitTranscode).toHaveBeenCalledWith(
      sid("s2"),
      cid("c2"),
      expect.any(Uint8Array),
      expect.anything()
    );
  });

  it("skips a segment whose clip changed under it (meta.id no longer the listed clip)", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
    ]);
    // The segment now resolves to a DIFFERENT clip than the one listed: erased,
    // re-recorded or already transcoded between the list and the load.
    vi.mocked(loadSegmentClip).mockResolvedValue(resolved(cid("c-new")));

    await requestTranscodeSweep();

    expect(encodeMp3).not.toHaveBeenCalled();
    expect(commitTranscode).not.toHaveBeenCalled();
  });

  it("skips a segment whose audio no longer resolves", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
    ]);
    vi.mocked(loadSegmentClip).mockResolvedValue({
      kind: "no-active-take",
      segment: segment(),
    });

    await requestTranscodeSweep();

    expect(encodeMp3).not.toHaveBeenCalled();
    expect(commitTranscode).not.toHaveBeenCalled();
  });

  it("keeps sweeping the rest when one segment fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
      { segmentId: sid("s2"), clipId: cid("c2") },
    ]);
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) => {
      if (segmentId === sid("s1")) throw new Error("clip read failed");
      return resolved(cid("c2"));
    });

    await requestTranscodeSweep();

    // s1 failed inside its own lane turn; s2 still landed.
    expect(commitTranscode).toHaveBeenCalledTimes(1);
    expect(commitTranscode).toHaveBeenCalledWith(
      sid("s2"),
      cid("c2"),
      expect.any(Uint8Array),
      expect.anything()
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("logs and resolves without throwing when the list read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listPcmFinishedSegments).mockRejectedValue(new Error("db down"));

    await expect(requestTranscodeSweep()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(commitTranscode).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("coalesces a request that arrives mid-run into exactly one extra pass", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.mocked(listPcmFinishedSegments)
      .mockImplementationOnce(async () => {
        await gate;
        return [];
      })
      .mockImplementation(async () => []);

    const first = requestTranscodeSweep(); // starts a run, blocks on the gate
    const joined = requestTranscodeSweep(); // lands while that run is in flight

    // The second caller joins the in-flight sweep rather than starting a race,
    // and no second pass has begun yet.
    expect(joined).toBe(first);
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(1);

    release();
    await first;

    // The request that landed mid-run is honoured by one more pass — no more,
    // no fewer.
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
  });

  it("does not start an extra pass for a request that arrives after the run ends", async () => {
    await requestTranscodeSweep();
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(1);

    await requestTranscodeSweep();
    // A fresh, separate run — not a coalesced extra pass of the first.
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
  });
});
