import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SegmentAudio } from "@/lib/storage/segment-audio";
import type { AudioCodec, Clip } from "@/types/audio";
import type { ChapterId, ClipId, Segment, TakeId } from "@/types/domain";
import type { SegmentId } from "@/types/domain";

/**
 * The second half of #166: an encoder that has stopped working SAYS so.
 *
 * `finish-transcode-stall.test.ts` covers what the sweep DOES with a wedged
 * worker (break the run, keep the PCM). This covers what anyone hears about it.
 * Before this, a device whose worker could not run at all transcoded nothing and
 * told nobody — the only trace was a `console.error`, which AGENTS.md is explicit
 * is "not a channel on a phone in a village".
 *
 * Two separate claims are pinned here:
 *
 *  1. Every sweep failure reaches the app's ONE failure sink (`reportFailure`,
 *     #167/#188) rather than the console alone.
 *  2. Consecutive failures are counted in the module state and flip the published
 *     health to `failing` at — and not before — `TRANSCODE_FAILURE_THRESHOLD`,
 *     and one successful transcode clears it.
 *
 * The count lives in module state, so every case re-imports the sweep through
 * `vi.resetModules()` (the seam `encoder-deadline.test.ts` uses) and starts from
 * a fresh counter; without it the count would leak across cases and the threshold
 * assertions would depend on file order. Because `resetModules` also rebuilds
 * every MOCKED dependency, each case re-imports those too and drives the fresh
 * spies — a `vi.mocked()` on a statically imported one would configure an
 * instance the reloaded sweep never sees.
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
    id: sid("s1"),
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
      segmentId: sid("s1"),
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
let transcodeHealth: Sweep["transcodeHealth"];
let subscribeToTranscodeHealth: Sweep["subscribeToTranscodeHealth"];
let subscribeToFailures: Reporter["subscribeToFailures"];
let StalledError: typeof import("@/hooks/mp3-codec").EncoderStalledError;
let THRESHOLD: number;

let listPcmFinishedSegments: Storage["listPcmFinishedSegments"];
let commitTranscode: Storage["commitTranscode"];
let loadSegmentClip: SegmentAudioModule["loadSegmentClip"];

let encodeMp3: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** One owed segment per sweep, so one sweep is exactly one encoder turn. */
function oneOwedSegment(): void {
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([
    { segmentId: sid("s1"), clipId: cid("c1") },
  ]);
  vi.mocked(loadSegmentClip).mockImplementation(async () =>
    resolvedPcm(cid("c1"), Int16Array.of(1))
  );
}

/** A per-segment encode failure that is NOT a stall. */
function failEveryEncode(): void {
  encodeMp3.mockImplementation(async () => {
    throw new Error("encode failed");
  });
}

/** Collect what the app's single failure sink is told. */
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
  oneOwedSegment();

  ({ subscribeToFailures } = await import("@/hooks/report-failure"));

  const mod = await import("@/hooks/finish-transcode");
  requestTranscodeSweep = mod.requestTranscodeSweep;
  transcodeHealth = mod.transcodeHealth;
  subscribeToTranscodeHealth = mod.subscribeToTranscodeHealth;
  THRESHOLD = mod.TRANSCODE_FAILURE_THRESHOLD;
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

      expect(reports).toHaveLength(1);
      expect(reports[0]?.context).toBe("transcode-segment");
      // The segment id travels with the report, wrapped AROUND the real cause,
      // so the maintainer's log still says which segment while the sink keeps a
      // stable, low-cardinality context key (#188's contract for `context`).
      expect((reports[0]?.cause as Error).message).toContain("s1");
      expect((reports[0]?.cause as Error).cause).toBe(boom);
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
      // Listing is not the ENCODER failing, so it never moves the health: the
      // indicator means "this phone cannot encode", and nothing else.
      expect(transcodeHealth()).toBe("ok");
    } finally {
      stop();
    }
  });
});

describe("transcodeHealth — surfacing an encoder that stopped working (#166)", () => {
  it("starts ok and stays ok below the threshold", async () => {
    expect(transcodeHealth()).toBe("ok");
    failEveryEncode();

    for (let i = 0; i < THRESHOLD - 1; i++) {
      await requestTranscodeSweep();
      expect(transcodeHealth()).toBe("ok");
    }
  });

  it("flips to failing on the Nth consecutive failure and tells subscribers ONCE", async () => {
    const seen: string[] = [];
    const stop = subscribeToTranscodeHealth((h) => seen.push(h));
    try {
      failEveryEncode();

      for (let i = 0; i < THRESHOLD; i++) await requestTranscodeSweep();
      expect(transcodeHealth()).toBe("failing");
      expect(seen).toEqual(["failing"]);

      // Still failing, and NOT announced again: this is ONE state-in-place
      // indicator, not a message per failure (#166's fix shape).
      await requestTranscodeSweep();
      expect(seen).toEqual(["failing"]);
    } finally {
      stop();
    }
  });

  it("counts a STALLED encoder as a failure like any other", async () => {
    // A stall is the strongest evidence the encoder has stopped working, so it
    // must not be the one failure kind that never reaches the indicator — and it
    // is the easy one to miss, because the sweep returns out of the loop on it.
    encodeMp3.mockImplementation(async () => {
      throw new StalledError(15_000);
    });

    for (let i = 0; i < THRESHOLD; i++) await requestTranscodeSweep();

    expect(transcodeHealth()).toBe("failing");
  });

  it("clears back to ok on one successful transcode", async () => {
    const seen: string[] = [];
    const stop = subscribeToTranscodeHealth((h) => seen.push(h));
    try {
      failEveryEncode();
      for (let i = 0; i < THRESHOLD; i++) await requestTranscodeSweep();
      expect(transcodeHealth()).toBe("failing");

      encodeMp3.mockImplementation(
        async (s: Int16Array) => new Uint8Array([s[0] ?? 0])
      );
      await requestTranscodeSweep();

      expect(transcodeHealth()).toBe("ok");
      expect(seen).toEqual(["failing", "ok"]);

      // And the COUNT is back to zero with it, not merely the published state.
      // A success that only flipped the state would leave the count at N, so
      // the very next single failure would re-trip — the threshold would be 1
      // for the rest of the page's life, which is the opposite of what a
      // threshold is for. It has to take N more in a row.
      failEveryEncode();
      for (let i = 0; i < THRESHOLD - 1; i++) {
        await requestTranscodeSweep();
        expect(transcodeHealth()).toBe("ok");
      }
      await requestTranscodeSweep();
      expect(transcodeHealth()).toBe("failing");
      expect(seen).toEqual(["failing", "ok", "failing"]);
    } finally {
      stop();
    }
  });

  it("does NOT treat a skipped segment as a success", async () => {
    // A segment that no longer qualifies (erased, re-recorded, already MP3)
    // leaves the lane turn without throwing AND without encoding anything.
    // Counting that as a success would clear the counter on a phone whose
    // encoder is dead, and the indicator would never appear.
    failEveryEncode();
    for (let i = 0; i < THRESHOLD - 1; i++) await requestTranscodeSweep();
    expect(transcodeHealth()).toBe("ok");

    vi.mocked(loadSegmentClip).mockImplementation(async () => ({
      kind: "no-active-take",
      segment: segment(),
    }));
    await requestTranscodeSweep();

    expect(encodeMp3).toHaveBeenCalledTimes(THRESHOLD - 1);
    expect(transcodeHealth()).toBe("ok");

    // The skip did not clear the count: the next real failure is still the Nth.
    oneOwedSegment();
    failEveryEncode();
    await requestTranscodeSweep();
    expect(transcodeHealth()).toBe("failing");
  });

  it("stops telling a subscriber that has unsubscribed", async () => {
    const seen: string[] = [];
    const stop = subscribeToTranscodeHealth((h) => seen.push(h));
    stop();
    failEveryEncode();

    for (let i = 0; i < THRESHOLD; i++) await requestTranscodeSweep();

    expect(transcodeHealth()).toBe("failing");
    expect(seen).toEqual([]);
  });

  it("a throwing subscriber neither breaks the sweep nor is swallowed", async () => {
    const boom = new Error("the listener blew up");
    const stopListener = subscribeToTranscodeHealth(() => {
      throw boom;
    });
    const { reports, stop } = captureFailures();
    try {
      failEveryEncode();

      for (let i = 0; i < THRESHOLD; i++)
        await expect(requestTranscodeSweep()).resolves.toBeUndefined();

      expect(transcodeHealth()).toBe("failing");
      expect(
        reports.some(
          (r) => r.context === "transcode-health" && r.cause === boom
        )
      ).toBe(true);
    } finally {
      stop();
      stopListener();
    }
  });
});
