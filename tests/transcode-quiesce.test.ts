import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";
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
 * The sweep stops when the crash screen goes up (#205, George R5 P2-3).
 *
 * Its own file, not a case in `finish-transcode.test.ts`, because `quiesced` is
 * one-way module state on purpose: there is no resume, since the only exit from
 * the crash screen is a reload and a reload is a new page with a fresh launch
 * sweep. A case that set it would poison every case after it in the same file,
 * and Vitest gives each FILE its own module graph. The mid-pass case lives in
 * `transcode-quiesce-midpass.test.ts` for exactly that reason.
 *
 * What this is protecting. `ErrorBoundary` replaces `App`, but the sweep's state
 * is module-scoped — the callers are hooks on different screens — so `App`'s
 * unmount does not cancel a run. A sweep started at launch therefore keeps
 * encoding clips and reporting one `transcode-segment` row per failure into the
 * 50-row ring that the crash screen's Send is about to export. With a backlog of
 * finished-but-PCM segments and an encoder that FAILS rather than stalls (a
 * stall ends the pass; an ordinary failure does not), that is an unbounded
 * producer against a bounded log, and it can prune the `[render]` row before a
 * facilitator finishes the two-gesture Send.
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

const codec = (): AudioCodec => ({
  encodeMp3: async () => new Uint8Array([1]),
  decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
});

describe("the transcode sweep and the crash screen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
      work(codec())
    );
    vi.mocked(loadSegmentClip).mockResolvedValue(
      resolvedPcm(cid("c1"), Int16Array.of(1))
    );
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: sid("s1"), clipId: cid("c1") },
    ]);
  });

  it("sweeps normally, then stops for good once the boundary catches", async () => {
    // The legitimate state first. Without this the assertion below is satisfied
    // by a sweep that never worked at all, which is the shape AGENTS.md calls a
    // gate proved in one direction only.
    await requestTranscodeSweep();
    expect(commitTranscode).toHaveBeenCalledTimes(1);

    // A render throw. `componentDidCatch` is where the app's side effects on a
    // crash live, and quiescing is one of them — the wiring is asserted here
    // rather than the flag alone, because a flag nothing sets is not a fix.
    const boundary = new ErrorBoundary({ children: null });
    boundary.componentDidCatch(new Error("render threw"), {
      componentStack: null,
    });

    vi.mocked(commitTranscode).mockClear();
    await requestTranscodeSweep();
    // Nothing loaded, nothing encoded, nothing committed — and so no
    // `transcode-segment` row can reach the ring the crash screen is about to
    // send. The PCM is untouched and the next launch picks it up, which is the
    // sweep's own documented contract.
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(1); // the first sweep only
    expect(loadSegmentClip).toHaveBeenCalledTimes(1);
    expect(commitTranscode).not.toHaveBeenCalled();
  });

  it("stays stopped — there is no resume, and a later request is a no-op", async () => {
    quiesceTranscodeSweep();
    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(listPcmFinishedSegments).not.toHaveBeenCalled();
    expect(commitTranscode).not.toHaveBeenCalled();
  });
});
