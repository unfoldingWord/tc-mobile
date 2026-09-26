import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldRetryAfterFailure } from "@/hooks/finish-transcode";
import type { SegmentAudio } from "@/lib/storage/segment-audio";
import type { AudioCodec, Clip } from "@/types/audio";
import type {
  ChapterId,
  ClipId,
  Segment,
  SegmentId,
  TakeId,
} from "@/types/domain";

/**
 * #1010 — a segment whose transcode fails because the phone is out of room (a
 * quota error) is attempted once per session rather than once per sweep.
 * Every Finished tap starts a sweep, so without this each tap re-decodes and
 * re-encodes the failing segment and writes another failure-log row for it.
 *
 * A held-out segment is tried again when:
 *  - a later storage estimate shows more free space than at its failure;
 *  - its clip changes (re-recorded or edited: a new clip id);
 *  - the app restarts (a fresh module).
 *
 * Failures that are not quota keep today's retry on every sweep; the
 * sweep's docblock on `failedSegments` says why.
 *
 * Stalls keep their own mechanism (ADR 0009, #290, #682) and are pinned in
 * `transcode-poison-backoff.test.ts`; the last case here only shows the new
 * memory does not leak into it.
 *
 * `vi.resetModules()` gives each case a fresh sweep module, so each case
 * re-imports the mocked dependencies and drives the fresh spies (the shape
 * `transcode-reporting.test.ts` documents).
 */

vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return {
    ...actual,
    withEncoder: vi.fn(),
    // `failing`, so no stall here counts toward #682's page limit and the
    // stall case below reads the stall path alone.
    encoderHealth: vi.fn(() => "failing"),
  };
});
vi.mock("@/hooks/use-storage-pressure", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-storage-pressure")>();
  return { ...actual, readStorageEstimate: vi.fn() };
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
type Pressure = typeof import("@/hooks/use-storage-pressure");

let requestTranscodeSweep: Sweep["requestTranscodeSweep"];
let pauseTranscodeSweep: Sweep["pauseTranscodeSweep"];
let resumeTranscodeSweep: Sweep["resumeTranscodeSweep"];
let quiesceTranscodeSweep: Sweep["quiesceTranscodeSweep"];
let STORAGE_ESTIMATE_TIMEOUT_MS: Sweep["STORAGE_ESTIMATE_TIMEOUT_MS"];
let subscribeToFailures: Reporter["subscribeToFailures"];
let StalledError: typeof import("@/hooks/mp3-codec").EncoderStalledError;
let listPcmFinishedSegments: Storage["listPcmFinishedSegments"];
let commitTranscode: Storage["commitTranscode"];
let loadSegmentClip: SegmentAudioModule["loadSegmentClip"];
let readStorageEstimate: Pressure["readStorageEstimate"];

let encodeMp3: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let reports: { context: string; cause: unknown }[];
let stopCapture: () => void;

/** The clip each segment currently holds; a case re-records by editing it. */
let clipOf: Map<string, ClipId>;

function owe(...segmentIds: string[]): void {
  vi.mocked(listPcmFinishedSegments).mockImplementation(async () =>
    segmentIds.map((s) => ({ segmentId: sid(s), clipId: clipOf.get(s)! }))
  );
  vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) => {
    const n = Number(segmentId.slice(1));
    return resolvedPcm(segmentId, clipOf.get(segmentId)!, Int16Array.of(n));
  });
}

/** Free space the next estimate reports, or `null` for "could not ask". */
function freeSpace(free: number | null): void {
  vi.mocked(readStorageEstimate).mockResolvedValue(
    free === null ? null : { usage: 1_000_000 - free, quota: 1_000_000 }
  );
}

/** How many times the sweep asked the worker to encode segment `sN`. */
function encodesOf(n: number): number {
  return encodeMp3.mock.calls.filter(
    (c) => (c[0] as Int16Array | undefined)?.[0] === n
  ).length;
}

function segmentReports(segmentId: string): number {
  return reports.filter(
    (r) =>
      r.context === "transcode-segment" &&
      (r.cause as Error).message.includes(`segment ${segmentId} `)
  ).length;
}

async function loadSweep(): Promise<void> {
  const codecModule = await import("@/hooks/mp3-codec");
  StalledError = codecModule.EncoderStalledError;
  vi.mocked(codecModule.encoderHealth).mockReturnValue("failing");
  vi.mocked(codecModule.withEncoder).mockImplementation(async (_signal, work) =>
    work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]))
  );

  const storage = await import("@/lib/storage/transcode");
  listPcmFinishedSegments = storage.listPcmFinishedSegments;
  commitTranscode = storage.commitTranscode;
  vi.mocked(commitTranscode).mockResolvedValue("committed");

  const segmentAudio = await import("@/lib/storage/segment-audio");
  loadSegmentClip = segmentAudio.loadSegmentClip;

  const pressure = await import("@/hooks/use-storage-pressure");
  readStorageEstimate = pressure.readStorageEstimate;
  freeSpace(null);

  ({ subscribeToFailures } = await import("@/hooks/report-failure"));
  reports = [];
  stopCapture = subscribeToFailures((r) =>
    reports.push({ context: r.context, cause: r.cause })
  );
  ({
    requestTranscodeSweep,
    pauseTranscodeSweep,
    resumeTranscodeSweep,
    quiesceTranscodeSweep,
    STORAGE_ESTIMATE_TIMEOUT_MS,
  } = await import("@/hooks/finish-transcode"));
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  clipOf = new Map([
    ["s1", cid("c1")],
    ["s2", cid("c2")],
  ]);
  encodeMp3 = vi.fn(
    async (samples: Int16Array) => new Uint8Array([samples[0] ?? 0])
  );
  await loadSweep();
});

afterEach(() => {
  stopCapture();
  errorSpy.mockRestore();
});

/** s1's commit fails the way a full phone fails it; s2 is healthy. */
function s1HitsQuota(): void {
  vi.mocked(commitTranscode).mockImplementation(async (segmentId) => {
    if (segmentId === sid("s1")) {
      throw new DOMException("quota", "QuotaExceededError");
    }
    return "committed";
  });
}

describe("a segment that failed is attempted once per session (#1010)", () => {
  it("does not re-encode it on later sweeps while nothing has changed", async () => {
    owe("s1", "s2");
    s1HitsQuota();

    await requestTranscodeSweep();
    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(encodesOf(1)).toBe(1);
    // The healthy neighbour is untouched by the hold-out: it is still owed
    // (the mock list never drops it) and is still encoded every sweep.
    expect(encodesOf(2)).toBe(3);
  });

  it("writes ONE failure-log entry for it, not one per sweep", async () => {
    owe("s1");
    s1HitsQuota();

    await requestTranscodeSweep();
    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(segmentReports("s1")).toBe(1);
  });

  it("reads the legacy quota code as out of room too", async () => {
    owe("s1");
    vi.mocked(commitTranscode).mockRejectedValue(
      Object.assign(new Error("quota"), { code: 22 })
    );

    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying, and logging, a failure that is not quota", async () => {
    owe("s1");
    encodeMp3.mockRejectedValue(new Error("worker error"));

    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
    expect(segmentReports("s1")).toBe(2);
  });

  it("returns a held-out segment to per-sweep retry once it fails another way", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    // Storage frees; the retry now fails for a different reason.
    freeSpace(50_000);
    vi.mocked(commitTranscode).mockRejectedValue(new Error("not quota"));
    await requestTranscodeSweep();
    // A different reason is a new failure, and it gets its own row: the
    // dedup is for running out of room AGAIN, not for any retry.
    expect(segmentReports("s1")).toBe(2);
    // Less room than at the quota failure: only the entry being gone lets
    // this sweep retry it.
    freeSpace(500);
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(3);
    expect(segmentReports("s1")).toBe(3);
  });

  it("logs a stall on a held-out segment's storage retry", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    freeSpace(50_000);
    encodeMp3.mockRejectedValue(new StalledError(15_000));
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
    expect(segmentReports("s1")).toBe(2);
  });

  it("does not re-load the held-out segment's PCM", async () => {
    owe("s1");
    s1HitsQuota();

    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(vi.mocked(loadSegmentClip)).toHaveBeenCalledTimes(1);
  });
});

describe("storage freeing up retries it", () => {
  it("retries once a later estimate shows more free space than at failure", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    freeSpace(50_000);
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
  });

  it("does not retry on the same free space", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("does not retry on less free space", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    freeSpace(500);
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("never retries on storage when the failure-time reading was unknown", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(null);
    await requestTranscodeSweep();

    freeSpace(900_000);
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("never retries on storage when the later reading is unknown", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    freeSpace(null);
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("measures against the LATEST failure, so a retry that fails again needs more room again", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();
    freeSpace(50_000);
    await requestTranscodeSweep(); // retried, fails at 50 000 free
    await requestTranscodeSweep(); // same 50 000: held out

    expect(encodeMp3).toHaveBeenCalledTimes(2);
  });

  it("does not log a second entry when the storage retry fails the same way", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();
    freeSpace(50_000);
    await requestTranscodeSweep();

    expect(segmentReports("s1")).toBe(1);
  });

  it("lands the segment when the retry succeeds", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    vi.mocked(commitTranscode).mockResolvedValue("committed");
    freeSpace(50_000);
    await requestTranscodeSweep();

    expect(
      vi.mocked(commitTranscode).mock.calls.map((c) => [c[0], c[1]])
    ).toEqual([
      [sid("s1"), cid("c1")],
      [sid("s1"), cid("c1")],
    ]);
  });
});

describe("the segment changing retries it", () => {
  it("retries on the very next sweep once the segment holds a new clip", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    clipOf.set("s1", cid("c1-edited"));
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
    expect(vi.mocked(commitTranscode).mock.calls[1]?.[1]).toBe(
      cid("c1-edited")
    );
  });

  it("logs the new clip's failure as a fresh entry", async () => {
    owe("s1");
    s1HitsQuota();
    await requestTranscodeSweep();

    clipOf.set("s1", cid("c1-edited"));
    await requestTranscodeSweep();
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
    expect(segmentReports("s1")).toBe(2);
  });
});

describe("the app restarting retries it", () => {
  it("gives the segment a clean first attempt in a fresh module", async () => {
    owe("s1");
    s1HitsQuota();
    await requestTranscodeSweep();
    await requestTranscodeSweep();
    expect(encodeMp3).toHaveBeenCalledTimes(1);

    // A reload: every module, and so every piece of session memory, is new.
    stopCapture();
    vi.resetModules();
    await loadSweep();
    owe("s1");
    s1HitsQuota();
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(2);
    expect(segmentReports("s1")).toBe(1);
  });
});

describe("stalls keep their own handling", () => {
  it("still retries a stalled clip on a later sweep beside a held-out one", async () => {
    owe("s1", "s2");
    s1HitsQuota();
    encodeMp3.mockImplementation(async (s: Int16Array) => {
      if (s[0] === 2) throw new StalledError(15_000);
      return new Uint8Array([s[0] ?? 0]);
    });

    await requestTranscodeSweep();
    await requestTranscodeSweep();

    // s1 (quota) once; s2 (stall) on both sweeps. Its stall count started
    // with the encoder `failing`, so the #682 page limit never counts it —
    // the stall path decides alone, exactly as before this change.
    expect(encodesOf(1)).toBe(1);
    expect(encodesOf(2)).toBe(2);
    // Every stall is still reported: the stall branch is not deduplicated.
    expect(segmentReports("s2")).toBe(2);
  });
});

describe("the storage read does not outlive a pause or hang the sweep", () => {
  it("does not start a held-out retry when the sweep is paused during the read", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    vi.mocked(commitTranscode).mockResolvedValue("committed");
    vi.mocked(readStorageEstimate).mockImplementation(async () => {
      pauseTranscodeSweep("test");
      return { usage: 950_000, quota: 1_000_000 };
    });
    await requestTranscodeSweep();
    expect(encodeMp3).toHaveBeenCalledTimes(1);

    // The request is handed to the resume, not lost.
    freeSpace(50_000);
    resumeTranscodeSweep("test");
    // Awaited by polling, not by joining with another request: a join would
    // itself ask for one more pass.
    await vi.waitFor(() => expect(encodeMp3).toHaveBeenCalledTimes(2));
  });

  it("does not start a held-out retry when the sweep is quiesced during the read", async () => {
    owe("s1");
    s1HitsQuota();
    freeSpace(1_000);
    await requestTranscodeSweep();

    vi.mocked(readStorageEstimate).mockImplementation(async () => {
      quiesceTranscodeSweep();
      return { usage: 950_000, quota: 1_000_000 };
    });
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("gives up on an estimate that never settles, as an unknown reading", async () => {
    vi.useFakeTimers();
    try {
      owe("s1");
      s1HitsQuota();
      vi.mocked(readStorageEstimate).mockReturnValue(new Promise(() => {}));

      // The quota catch's read.
      let settled = false;
      void requestTranscodeSweep().then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(STORAGE_ESTIMATE_TIMEOUT_MS);
      expect(settled).toBe(true);

      // The skip guard's read: unknown keeps s1 held out, and the run ends.
      settled = false;
      void requestTranscodeSweep().then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(STORAGE_ESTIMATE_TIMEOUT_MS);
      expect(settled).toBe(true);
      expect(encodeMp3).toHaveBeenCalledTimes(1);

      // Nothing is left joined to a dead run: a later sweep still works.
      freeSpace(null);
      clipOf.set("s1", cid("c1-edited"));
      await requestTranscodeSweep();
      expect(encodeMp3).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shouldRetryAfterFailure", () => {
  it("is true only for strictly more free space than at the failure", () => {
    expect(shouldRetryAfterFailure(1_001, 1_000)).toBe(true);
    expect(shouldRetryAfterFailure(1_000, 1_000)).toBe(false);
    expect(shouldRetryAfterFailure(999, 1_000)).toBe(false);
  });

  it("is false when either reading is unknown", () => {
    expect(shouldRetryAfterFailure(undefined, 1_000)).toBe(false);
    expect(shouldRetryAfterFailure(1_000, undefined)).toBe(false);
    expect(shouldRetryAfterFailure(undefined, undefined)).toBe(false);
  });

  it("compares negative headroom the same way", () => {
    expect(shouldRetryAfterFailure(-10, -20)).toBe(true);
  });
});
