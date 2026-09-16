import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterStalledSegment } from "@/hooks/finish-transcode";
import type { SegmentAudio } from "@/lib/storage/segment-audio";
import type { AudioCodec, Clip } from "@/types/audio";
import type { ChapterId, ClipId, Segment, TakeId } from "@/types/domain";
import type { SegmentId } from "@/types/domain";

/**
 * The Finished sweep's failure CHANNEL, and its queue order after a stall.
 *
 * Whether the encoder has stopped working is decided in `mp3-codec.ts` and
 * covered by `encoder-health.test.ts`; nothing here asserts health. What the
 * sweep owes is narrower, and both halves were review findings:
 *
 *  1. Every failure it catches reaches the app's ONE failure sink
 *     (`reportFailure`, #167/#188), never `console.error` alone — AGENTS.md is
 *     explicit that the console is not a channel on a phone in a village.
 *  2. A stall ends the run (#290), which made the owed list's order load-bearing
 *     for the first time: one clip that wedges the worker every time sat at the
 *     head of a stable `getAll` walk and starved every other finished segment
 *     for the life of the page (George R1 P2-2). The next pass puts it last.
 *
 * `vi.resetModules()` gives each case a fresh `lastStalledSegmentId`; because
 * that also rebuilds every MOCKED dependency, each case re-imports those too and
 * drives the fresh spies — a `vi.mocked()` on a statically imported one would
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

function segment(id: string): Segment {
  return {
    id: sid(id),
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

function resolvedPcm(
  segmentId: string,
  clipId: ClipId,
  samples: Int16Array
): SegmentAudio<Clip> {
  return {
    kind: "resolved",
    segment: segment(segmentId),
    take: {
      id: "take" as TakeId,
      segmentId: sid(segmentId),
      clipId,
      createdAt: 0,
      durationMs: 1,
    },
    clip: pcmClip(clipId, samples),
  };
}

function codec(encodeMp3: AudioCodec["encodeMp3"]): AudioCodec {
  return {
    encodeMp3,
    decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
  };
}

type Sweep = typeof import("@/hooks/finish-transcode");
type Storage = typeof import("@/lib/storage/transcode");
type SegmentAudioModule = typeof import("@/lib/storage/segment-audio");
type Reporter = typeof import("@/hooks/report-failure");

let requestTranscodeSweep: Sweep["requestTranscodeSweep"];
let subscribeToFailures: Reporter["subscribeToFailures"];
let StalledError: typeof import("@/hooks/mp3-codec").EncoderStalledError;
let listPcmFinishedSegments: Storage["listPcmFinishedSegments"];
let commitTranscode: Storage["commitTranscode"];
let loadSegmentClip: SegmentAudioModule["loadSegmentClip"];

let encodeMp3: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** Two owed segments, s1 then s2, each with its own one-sample clip. */
function twoOwedSegments(): void {
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([
    { segmentId: sid("s1"), clipId: cid("c1") },
    { segmentId: sid("s2"), clipId: cid("c2") },
  ]);
  vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
    segmentId === sid("s1")
      ? resolvedPcm("s1", cid("c1"), Int16Array.of(1))
      : resolvedPcm("s2", cid("c2"), Int16Array.of(2))
  );
}

function captureFailures(): {
  reports: { context: string; cause: unknown }[];
  stop: () => void;
} {
  const reports: { context: string; cause: unknown }[] = [];
  const stop = subscribeToFailures((r) =>
    reports.push({ context: r.context, cause: r.cause })
  );
  return { reports, stop };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  // The sink's terminal is still `console.error` — #205 owns the durable
  // destination — so silence it here and assert on the SINK, not on the log.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  encodeMp3 = vi.fn(
    async (samples: Int16Array) => new Uint8Array([samples[0] ?? 0])
  );

  const codecModule = await import("@/hooks/mp3-codec");
  StalledError = codecModule.EncoderStalledError;
  vi.mocked(codecModule.withEncoder).mockImplementation(async (_signal, work) =>
    work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]))
  );

  const storage = await import("@/lib/storage/transcode");
  listPcmFinishedSegments = storage.listPcmFinishedSegments;
  commitTranscode = storage.commitTranscode;
  vi.mocked(commitTranscode).mockResolvedValue("committed");

  const segmentAudio = await import("@/lib/storage/segment-audio");
  loadSegmentClip = segmentAudio.loadSegmentClip;
  twoOwedSegments();

  ({ subscribeToFailures } = await import("@/hooks/report-failure"));
  ({ requestTranscodeSweep } = await import("@/hooks/finish-transcode"));
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("the sweep's failure channel (#166, #167)", () => {
  it("reports a per-segment failure to the failure SINK, not the console alone", async () => {
    const { reports, stop } = captureFailures();
    try {
      const boom = new Error("one bad clip");
      encodeMp3.mockRejectedValue(boom);

      await requestTranscodeSweep();

      // Both segments fail in an ordinary way, so both are reported and the loop
      // keeps its per-segment isolation.
      expect(reports).toHaveLength(2);
      expect(reports[0]?.context).toBe("transcode-segment");
      // The segment id travels with the report, wrapped AROUND the real cause,
      // so the maintainer's log still says which segment while the sink keeps a
      // stable, low-cardinality context key (#188's contract for `context`).
      expect((reports[0]?.cause as Error).message).toContain("s1");
      expect((reports[0]?.cause as Error).cause).toBe(boom);
      expect((reports[1]?.cause as Error).message).toContain("s2");
    } finally {
      stop();
    }
  });

  it("reports a failure to LIST owed segments to the sink too", async () => {
    const { reports, stop } = captureFailures();
    try {
      vi.mocked(listPcmFinishedSegments).mockRejectedValue(
        new Error("the store is gone")
      );

      await requestTranscodeSweep();

      expect(reports.map((r) => r.context)).toEqual(["transcode-sweep"]);
    } finally {
      stop();
    }
  });
});

describe("a stalled segment does not block the queue (George R1 P2-2)", () => {
  it("puts the segment that stalled LAST on the next pass", async () => {
    // s1 wedges the worker every time; s2 is ordinary. Before the fix, every
    // sweep started at s1, stalled, ended the run — and s2 was never loaded for
    // the life of the page, even though the recovery had warmed a fresh worker
    // that could have encoded it.
    encodeMp3.mockImplementation(async (s: Int16Array) => {
      if (s[0] === 1) throw new StalledError(15_000);
      return new Uint8Array([s[0] ?? 0]);
    });

    await requestTranscodeSweep();
    // Run 1: s1 first, stalls; the drain lands s2 without retrying s1.
    vi.mocked(loadSegmentClip).mockClear();

    await requestTranscodeSweep();
    // Run 2, a LATER sweep in the same page: s1 is still remembered, so the
    // pass takes s2 first and only then retries s1 (which stalls again).
    expect(vi.mocked(loadSegmentClip).mock.calls[0]?.[0]).toBe(sid("s2"));
    expect(vi.mocked(loadSegmentClip).mock.calls[1]?.[0]).toBe(sid("s1"));
  });

  it("leaves a healthy run's order alone", async () => {
    await requestTranscodeSweep();

    expect(vi.mocked(commitTranscode).mock.calls.map((c) => c[0])).toEqual([
      sid("s1"),
      sid("s2"),
    ]);
  });

  it("stops deprioritising a segment once its turn completes", async () => {
    let stall = true;
    encodeMp3.mockImplementation(async (s: Int16Array) => {
      if (s[0] === 1 && stall) throw new StalledError(15_000);
      return new Uint8Array([s[0] ?? 0]);
    });

    await requestTranscodeSweep(); // s1 stalls, remembered
    stall = false;
    await requestTranscodeSweep(); // s2, then s1 — both land
    vi.mocked(commitTranscode).mockClear();

    // s1 is no longer the stalled one, so the natural order is back.
    await requestTranscodeSweep();
    expect(vi.mocked(commitTranscode).mock.calls.map((c) => c[0])).toEqual([
      sid("s1"),
      sid("s2"),
    ]);
  });
});

describe("one drain pass after a stall, in the SAME run (George R2 P2)", () => {
  /** Twenty owed segments p00..p19, each clip holding its own index. */
  function twentyOwed(): void {
    const ids = Array.from({ length: 20 }, (_, i) =>
      String(i).padStart(2, "0")
    );
    vi.mocked(listPcmFinishedSegments).mockResolvedValue(
      ids.map((n) => ({ segmentId: sid(`p${n}`), clipId: cid(`c${n}`) }))
    );
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) => {
      const n = segmentId.slice(1);
      return resolvedPcm(segmentId, cid(`c${n}`), Int16Array.of(Number(n)));
    });
  }

  it("drains the other nineteen on the recovered worker when the FIRST clip is poison", async () => {
    // The launch sweep is the only automatic pass a page gets, and the restart
    // the shelf recommends zeroes the sweep's memory. A reorder that only helps
    // a LATER pass therefore never helped at all: the poison clip, sorted
    // first, stalled every launch and the other nineteen never ran.
    twentyOwed();
    encodeMp3.mockImplementation(async (s: Int16Array) => {
      if (s[0] === 0) throw new StalledError(15_000);
      return new Uint8Array([s[0] ?? 0]);
    });

    await requestTranscodeSweep();

    expect(commitTranscode).toHaveBeenCalledTimes(19);
    // The poison is attempted ONCE in the run — not retried at the back of the
    // drain. #290's point is not to go straight back at what just wedged.
    const poisonAttempts = encodeMp3.mock.calls.filter(
      ([s]) => (s as Int16Array)[0] === 0
    );
    expect(poisonAttempts).toHaveLength(1);
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
  });

  it("stops at a SECOND stall in the drain — that is a wedged encoder, not a bad clip", async () => {
    twentyOwed();
    encodeMp3.mockImplementation(async (s: Int16Array) => {
      if (s[0] === 0 || s[0] === 5) throw new StalledError(15_000);
      return new Uint8Array([s[0] ?? 0]);
    });

    await requestTranscodeSweep();

    // p01..p04 land in the drain, p05 stalls, nothing after it is tried.
    expect(commitTranscode).toHaveBeenCalledTimes(4);
    expect(encodeMp3).toHaveBeenCalledTimes(6);
    // Exactly one drain: no third listing, however the run ended.
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(2);
  });

  it("makes no drain pass when nothing stalled", async () => {
    twentyOwed();

    await requestTranscodeSweep();

    expect(commitTranscode).toHaveBeenCalledTimes(20);
    expect(listPcmFinishedSegments).toHaveBeenCalledTimes(1);
  });
});

describe("afterStalledSegment", () => {
  const owed = [
    { segmentId: sid("a") },
    { segmentId: sid("b") },
    { segmentId: sid("c") },
  ];

  it("is the identity when nothing has stalled", () => {
    expect(afterStalledSegment(owed, null)).toBe(owed);
  });

  it("is the identity when the stalled segment is no longer owed", () => {
    expect(afterStalledSegment(owed, sid("gone"))).toBe(owed);
  });

  it("moves the stalled segment to the back, keeping the rest in order", () => {
    expect(
      afterStalledSegment(owed, sid("a")).map((entry) => entry.segmentId)
    ).toEqual([sid("b"), sid("c"), sid("a")]);
    expect(
      afterStalledSegment(owed, sid("b")).map((entry) => entry.segmentId)
    ).toEqual([sid("a"), sid("c"), sid("b")]);
  });

  it("is the identity when it is already last, or alone", () => {
    expect(
      afterStalledSegment(owed, sid("c")).map((entry) => entry.segmentId)
    ).toEqual([sid("a"), sid("b"), sid("c")]);
    const one = [{ segmentId: sid("a") }];
    expect(afterStalledSegment(one, sid("a"))).toBe(one);
  });
});
