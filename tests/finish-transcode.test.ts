import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentAudio } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import { computePeaks } from "@/lib/audio/peaks";
import type { AudioCodec, Clip } from "@/types/audio";
import type { ChapterId, ClipId, Segment, TakeId } from "@/types/domain";
import type { SegmentId } from "@/types/domain";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";

/**
 * Transcode on Finished (B8, D3) — the SWEEP, in Node (#181).
 *
 * The storage half (`commitTranscode`, `listPcmFinishedSegments`) is T1-tested
 * and mutation-proven in `transcode.test.ts`, so audio cannot be lost by a
 * commit. What that suite cannot reach is the sweep's own orchestration in
 * `finish-transcode.ts`: the single encoder lane (one segment at a time, the
 * load inside the lane), the coalescing of requests that land mid-run, the
 * per-segment skips, the peaks-before-encode ordering, and the per-segment error
 * isolation whose only channel is `console.error`. If any regress, storage relief
 * (#12) quietly stops and nothing surfaces it.
 *
 * The codec seam is browser-only (`withEncoder` drives a Web Worker), so it is
 * faked here — the same seam `encoder-lane.test.ts` uses. The two storage reads
 * are faked too, so a run's segment list and what each load resolves to are under
 * the test's control; `computePeaks` runs for real, and the fake encode
 * TRANSFERS (detaches) the sample buffer as the real worker does, so peaks taken
 * after the encode would see an empty buffer and fail.
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

function pcmClip(id: ClipId, samples: Int16Array): Clip {
  return {
    encoding: "pcm",
    meta: metaFor(id, "pcm", samples.length),
    samples,
  };
}

function mp3Clip(id: ClipId): Clip {
  return {
    encoding: "mp3",
    meta: metaFor(id, "mp3", 3),
    mp3: new Uint8Array([1, 2, 3]),
  };
}

function metaFor(id: ClipId, encoding: "pcm" | "mp3", frames: number) {
  return {
    id,
    sampleRate: 22_050,
    frameCount: frames,
    durationMs: 1,
    createdAt: 0,
    encoding,
    generation: encoding === "mp3" ? 1 : 0,
    byteLength: frames * 2,
    transcodeStallCount: 0,
    peaks: null,
  } as const;
}

/** A resolved load carrying `clip`; the sweep reads only kind/encoding/id/samples. */
function resolvedWith(clipId: ClipId, clip: Clip): SegmentAudio<Clip> {
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
    clip,
  };
}
const resolvedPcm = (clipId: ClipId, samples: Int16Array) =>
  resolvedWith(clipId, pcmClip(clipId, samples));
const resolvedMp3 = (clipId: ClipId) => resolvedWith(clipId, mp3Clip(clipId));

/** A codec whose decode refuses — the sweep never decodes, only encodes. */
function codec(encodeMp3: AudioCodec["encodeMp3"]): AudioCodec {
  return {
    encodeMp3,
    decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let encodeMp3: ReturnType<typeof vi.fn>;
let laneHeld = false;

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clear wipes recorded calls but keeps each
  // mock's IMPLEMENTATION, so a per-case `commitTranscode.mockImplementation`
  // (the COMMIT-failure case) would leak into the next case — the lane case ran
  // with a live commit rejection it was not named for. reset drops the
  // implementation too; the four seams below are re-stubbed right after, and
  // `commitTranscode` falls back to a bare mock (await undefined) per case
  // (round-3 maintainer probe / R2). This keeps each mutation killing only the
  // case it is named for.
  vi.resetAllMocks();
  laneHeld = false;
  encodeMp3 = vi.fn(async (samples: Int16Array) => {
    const marker = samples[0] ?? 0;
    // The real worker transfers samples.buffer (detached, length 0) — that is
    // why the sweep takes peaks BEFORE the encode. Mimic it so a peaks-after
    // regression sees an empty buffer.
    structuredClone(samples.buffer, {
      transfer: [samples.buffer as ArrayBuffer],
    });
    return new Uint8Array([marker]);
  });
  // The lane runs the work with our codec and marks the lane held for its span,
  // so a load moved outside `withEncoder` is observable (round-1 G1).
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) => {
    laneHeld = true;
    try {
      return await work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]));
    } finally {
      laneHeld = false;
    }
  });
  vi.mocked(loadSegmentClip).mockResolvedValue(
    resolvedPcm(cid("c1"), Int16Array.of(1))
  );
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([]);
});

describe("requestTranscodeSweep — the sweep's orchestration", () => {
  it("encodes each finished PCM segment, peaks first, and commits — on the lane", async () => {
    const s1 = Int16Array.of(10, 20, 30);
    const s2 = Int16Array.of(40, 50, 60);
    const peaks1 = computePeaks(Int16Array.of(10, 20, 30), ROW_PEAK_BUCKETS);
    const peaks2 = computePeaks(Int16Array.of(40, 50, 60), ROW_PEAK_BUCKETS);

    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
      { segmentId: sid("s2"), clipId: cid("c2") },
    ]);
    const loadLaneStates: boolean[] = [];
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) => {
      loadLaneStates.push(laneHeld);
      return segmentId === sid("s1")
        ? resolvedPcm(cid("c1"), s1)
        : resolvedPcm(cid("c2"), s2);
    });
    const commitLaneStates: boolean[] = [];
    vi.mocked(commitTranscode).mockImplementation(async () => {
      commitLaneStates.push(laneHeld);
      return "committed";
    });

    await requestTranscodeSweep();

    // One lane turn per segment, each with no abort signal.
    expect(withEncoder).toHaveBeenCalledTimes(2);
    expect(withEncoder).toHaveBeenNthCalledWith(
      1,
      undefined,
      expect.any(Function)
    );
    // Every load AND every commit ran INSIDE the lane (round-1 G1 + the
    // maintainer's R1: the lane is held from the load through the commit, so a
    // share can never coexist with this segment's PCM, nor land its write
    // between a segment's commit and the lane release).
    expect(loadLaneStates).toEqual([true, true]);
    expect(commitLaneStates).toEqual([true, true]);
    // The right buffer was encoded for each segment (identity, before detach).
    expect(encodeMp3.mock.calls[0]?.[0]).toBe(s1);
    expect(encodeMp3.mock.calls[1]?.[0]).toBe(s2);
    // The committed MP3 and the peaks-of-the-live-buffer go together, per segment.
    expect(commitTranscode).toHaveBeenNthCalledWith(
      1,
      sid("s1"),
      cid("c1"),
      new Uint8Array([10]),
      peaks1
    );
    expect(commitTranscode).toHaveBeenNthCalledWith(
      2,
      sid("s2"),
      cid("c2"),
      new Uint8Array([40]),
      peaks2
    );
  });

  it("skips a segment re-recorded under the sweep (meta.id no longer the listed clip)", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
    ]);
    // The active take now points at a different clip than the one listed.
    vi.mocked(loadSegmentClip).mockResolvedValue(
      resolvedPcm(cid("c-new"), Int16Array.of(1))
    );

    await requestTranscodeSweep();

    expect(encodeMp3).not.toHaveBeenCalled();
    expect(commitTranscode).not.toHaveBeenCalled();
  });

  it("skips a segment already transcoded (same clip id, now MP3)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(listPcmFinishedSegments).mockResolvedValue([
        { segmentId: sid("s1"), clipId: cid("c1") },
      ]);
      // A concurrent sweep landed first: same clip id `c1`, but MP3 now.
      vi.mocked(loadSegmentClip).mockResolvedValue(resolvedMp3(cid("c1")));

      await requestTranscodeSweep();

      // Not this sweep's job — encoded and committed nothing, and it is not an
      // error, so nothing is logged.
      expect(encodeMp3).not.toHaveBeenCalled();
      expect(commitTranscode).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skips a segment whose audio no longer resolves — a clean skip, not a caught error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
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
      // The `kind !== "resolved"` guard must SKIP it — an erased/unrecorded
      // segment is not an error. Without that guard, `audio.clip` is undefined
      // and the read throws into the per-segment catch, turning a normal skip
      // into a logged failure (round-1 George G3 / M9).
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps sweeping the rest when one segment's LOAD fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(listPcmFinishedSegments).mockResolvedValue([
        { segmentId: sid("s1"), clipId: cid("c1") },
        { segmentId: sid("s2"), clipId: cid("c2") },
      ]);
      vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) => {
        if (segmentId === sid("s1")) throw new Error("clip read failed");
        return resolvedPcm(cid("c2"), Int16Array.of(2));
      });

      await requestTranscodeSweep();

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

  it("isolates a failure at the ENCODE (not only the load) and never rejects", async () => {
    // The load succeeds for both; s1's ENCODE throws — a failure inside the lane
    // turn, past the load. The per-segment catch must cover the whole turn
    // (load + encode + commit), not just the load: otherwise the throw rejects
    // `runSweeps`, and every call site is `void requestTranscodeSweep()`, so it
    // becomes an unhandled rejection and the rest of the list goes unswept
    // (round-1 George G2 / M8). Encode is the failure mode the worker isolates.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(listPcmFinishedSegments).mockResolvedValue([
        { segmentId: sid("s1"), clipId: cid("c1") },
        { segmentId: sid("s2"), clipId: cid("c2") },
      ]);
      vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
        segmentId === sid("s1")
          ? resolvedPcm(cid("c1"), Int16Array.of(1))
          : resolvedPcm(cid("c2"), Int16Array.of(2))
      );
      encodeMp3.mockImplementation(async (s: Int16Array) => {
        if (s[0] === 1) throw new Error("encode failed"); // s1 only
        return new Uint8Array([s[0] ?? 0]);
      });

      // It must NOT reject — the promise every caller drops on the floor.
      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      // s1's encode threw inside its lane turn and was isolated; s2 still landed.
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

  it("isolates a failure at the COMMIT and never rejects", async () => {
    // The whole lane turn is load → peaks → encode → commit, and the commit is
    // the last thing inside it. A per-segment catch that covers the load and the
    // encode but somehow not the commit (M12: narrow the try, or move the commit
    // out of the turn) would let s1's rejected commit reject `runSweeps` — an
    // unhandled rejection at the `void requestTranscodeSweep()` call sites, with
    // s2 never swept. The commit is where audio is dropped, so its failure is the
    // one that most must stay isolated.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(listPcmFinishedSegments).mockResolvedValue([
        { segmentId: sid("s1"), clipId: cid("c1") },
        { segmentId: sid("s2"), clipId: cid("c2") },
      ]);
      vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
        segmentId === sid("s1")
          ? resolvedPcm(cid("c1"), Int16Array.of(1))
          : resolvedPcm(cid("c2"), Int16Array.of(2))
      );
      vi.mocked(commitTranscode).mockImplementation(async (segmentId) => {
        if (segmentId === sid("s1")) throw new Error("commit failed"); // s1 only
        return "committed";
      });

      // It must NOT reject — the promise every caller drops on the floor.
      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      // Both encodes ran (s1 reached its commit before failing); s2's commit
      // still landed, and s1's failure was logged, not thrown.
      expect(encodeMp3).toHaveBeenCalledTimes(2);
      expect(commitTranscode).toHaveBeenCalledTimes(2);
      expect(commitTranscode).toHaveBeenNthCalledWith(
        2,
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

  it("logs and resolves without throwing when the list read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(listPcmFinishedSegments).mockRejectedValue(
        new Error("db down")
      );

      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(commitTranscode).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("holds the lane one segment at a time — never in parallel", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
      { segmentId: sid("s2"), clipId: cid("c2") },
    ]);
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
      segmentId === sid("s1")
        ? resolvedPcm(cid("c1"), Int16Array.of(1))
        : resolvedPcm(cid("c2"), Int16Array.of(2))
    );
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    encodeMp3.mockImplementation(async (samples: Int16Array) => {
      if (calls++ === 0) await gate; // hold the FIRST segment's encode
      return new Uint8Array([samples[0] ?? 0]);
    });

    try {
      const sweep = requestTranscodeSweep();
      await flush();
      // The loop is awaiting segment 1's lane turn: segment 2's `withEncoder`
      // has not been called and its clip has not been loaded. A `Promise.all`
      // or a whole-loop single lane would break exactly this.
      expect(withEncoder).toHaveBeenCalledTimes(1);
      expect(loadSegmentClip).toHaveBeenCalledTimes(1);

      release();
      await sweep;
      expect(withEncoder).toHaveBeenCalledTimes(2);
      expect(commitTranscode).toHaveBeenCalledTimes(2);
    } finally {
      release();
    }
  });

  it("coalesces every request that arrives mid-run into exactly one extra pass", async () => {
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

    try {
      const first = requestTranscodeSweep(); // starts a run, blocks on the gate
      const joinerA = requestTranscodeSweep(); // both land while it is in flight
      const joinerB = requestTranscodeSweep();

      // N joiners share the ONE in-flight promise — a counter, not a boolean,
      // would let this pass while listing more than twice below.
      expect(joinerA).toBe(first);
      expect(joinerB).toBe(first);
      expect(listPcmFinishedSegments).toHaveBeenCalledTimes(1);

      release();
      await first;

      // Two or more mid-run requests still buy exactly ONE extra pass.
      expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
    } finally {
      release();
    }
  });

  it("does not start an extra pass for a request that arrives after the run ends", async () => {
    await requestTranscodeSweep();
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(1);

    await requestTranscodeSweep();
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
  });

  it("clears the sweep lock even when a pass throws uncaught, so the next request still runs", async () => {
    // The list-read catch covers a REJECTED list; the per-segment catch covers a
    // segment's failure. Neither covers an uncaught throw from the loop itself —
    // e.g. the list resolving to a non-iterable — which propagates out of
    // `sweepOnce`. `running` must still clear, because it lives in `runSweeps`'s
    // `finally`; `if (running)` is truthy for a settled — even rejected — promise,
    // so a clear that a throw skips (e.g. `running = null` written AFTER the loop
    // instead of in the `finally`) wedges every later `void requestTranscodeSweep()`
    // onto the dead promise and Finished PCM never transcodes again this process
    // (round-3 George P3 / M13).
    vi.mocked(listPcmFinishedSegments)
      .mockResolvedValueOnce(
        null as unknown as Awaited<ReturnType<typeof listPcmFinishedSegments>>
      )
      .mockResolvedValue([]);

    // First pass throws out of the `for...of` (null is not iterable), uncaught
    // inside `sweepOnce`, so the sweep rejects.
    await expect(requestTranscodeSweep()).rejects.toBeInstanceOf(TypeError);

    // The lock cleared: a fresh request starts a NEW run and lists again.
    await expect(requestTranscodeSweep()).resolves.toBeUndefined();
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
  });
});
