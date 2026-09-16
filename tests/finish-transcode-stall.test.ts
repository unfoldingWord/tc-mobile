import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SegmentAudio } from "@/lib/storage/segment-audio";
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
 *
 * Every case re-imports the sweep through `vi.resetModules()`. The sweep now
 * REMEMBERS which segment stalled, so it can put it last on the next pass instead
 * of letting one poison clip starve the queue (George R1 P2-2) — and that memory
 * is module state, so without the reset the first case below would decide the
 * second one's queue order and the #290 assertions would depend on file order.
 * Because `resetModules` rebuilds every MOCKED dependency too, those are
 * re-imported here as well: a `vi.mocked()` on a statically imported one would
 * configure an instance the reloaded sweep never sees.
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

type Sweep = typeof import("@/hooks/finish-transcode");
type Storage = typeof import("@/lib/storage/transcode");
type SegmentAudioModule = typeof import("@/lib/storage/segment-audio");

let encodeMp3: ReturnType<typeof vi.fn>;
let requestTranscodeSweep: Sweep["requestTranscodeSweep"];
let EncoderStalledError: typeof import("@/hooks/mp3-codec").EncoderStalledError;
let withEncoder: typeof import("@/hooks/mp3-codec").withEncoder;
let loadSegmentClip: SegmentAudioModule["loadSegmentClip"];
let commitTranscode: Storage["commitTranscode"];
let listPcmFinishedSegments: Storage["listPcmFinishedSegments"];

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  encodeMp3 = vi.fn(
    async (samples: Int16Array) => new Uint8Array([samples[0] ?? 0])
  );

  const codecModule = await import("@/hooks/mp3-codec");
  EncoderStalledError = codecModule.EncoderStalledError;
  withEncoder = codecModule.withEncoder;
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]))
  );

  const segmentAudio = await import("@/lib/storage/segment-audio");
  loadSegmentClip = segmentAudio.loadSegmentClip;
  vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
    segmentId === sid("s1")
      ? resolvedPcm(cid("c1"), Int16Array.of(1))
      : resolvedPcm(cid("c2"), Int16Array.of(2))
  );

  const storage = await import("@/lib/storage/transcode");
  commitTranscode = storage.commitTranscode;
  listPcmFinishedSegments = storage.listPcmFinishedSegments;
  vi.mocked(commitTranscode).mockResolvedValue("committed");
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([
    { segmentId: sid("s1"), clipId: cid("c1") },
    { segmentId: sid("s2"), clipId: cid("c2") },
  ]);

  ({ requestTranscodeSweep } = await import("@/hooks/finish-transcode"));
});

describe("requestTranscodeSweep — a stalled encoder", () => {
  it("BREAKS the pass on EncoderStalledError, then drains once WITHOUT the stalled clip", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // s1's encode reports the worker wedged; s2 would encode fine.
      encodeMp3.mockImplementation(async (s: Int16Array) => {
        if (s[0] === 1) throw new EncoderStalledError(15_000);
        return new Uint8Array([s[0] ?? 0]);
      });

      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      // The first pass stopped at s1 rather than re-arm the deadline down the
      // list. The ONE drain pass (George R2 P2) then re-listed and ran s2 on the
      // recovered worker — and never went back to s1.
      expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
      expect(withEncoder).toHaveBeenCalledTimes(2);
      expect(loadSegmentClip).toHaveBeenCalledTimes(2);
      expect(vi.mocked(loadSegmentClip).mock.calls.map((c) => c[0])).toEqual([
        sid("s1"),
        sid("s2"),
      ]);
      expect(commitTranscode).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not re-run the same run after a stall, even if a request arrived (#290)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A Finished transition landing during the 15 s stall window sets the
      // coalescing flag, so `runSweeps` looped once more the moment the stall
      // broke out — re-arming the same wedged worker on the same segment and
      // holding the lane for another window (Frank R3 P2 / #290). The break has
      // to end the RUN, not just the pass.
      let requested = false;
      encodeMp3.mockImplementation(async (s: Int16Array) => {
        if (s[0] === 1) {
          // ONE transition arrives mid-run; do not await, that is the live run.
          // Re-requesting on every pass would spin forever against the unfixed
          // code, which is a hang rather than a legible failure.
          if (!requested) {
            requested = true;
            void requestTranscodeSweep();
          }
          throw new EncoderStalledError(15_000);
        }
        return new Uint8Array([s[0] ?? 0]);
      });

      await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      // The coalesced extra pass is NOT run: had it been, s1 — first in the
      // list — would have been asked again. What runs instead is the single
      // drain pass, which leaves s1 out. So s1 is asked exactly once, the list
      // is taken exactly twice (pass + drain), and nothing loops.
      expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
      const s1Turns = vi
        .mocked(loadSegmentClip)
        .mock.calls.filter((c) => c[0] === sid("s1"));
      expect(s1Turns).toHaveLength(1);
      expect(commitTranscode).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("still honours a request that arrived during a HEALTHY run", async () => {
    // The stall break must not cost the ordinary coalescing guarantee: a
    // transition landing mid-run is still swept without waiting for the next
    // launch.
    let requested = false;
    encodeMp3.mockImplementation(async (s: Int16Array) => {
      if (!requested) {
        requested = true;
        void requestTranscodeSweep();
      }
      return new Uint8Array([s[0] ?? 0]);
    });

    await expect(requestTranscodeSweep()).resolves.toBeUndefined();

    // Two passes over the two segments: the mid-run request earned its re-run.
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
    expect(withEncoder).toHaveBeenCalledTimes(4);
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
