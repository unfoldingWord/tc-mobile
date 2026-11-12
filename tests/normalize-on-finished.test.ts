import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { reportFailure } from "@/hooks/report-failure";
import { CompressorRangeError } from "@/lib/audio/compressor-error";
import { computePeaks } from "@/lib/audio/peaks";
import { NORMALIZE_STAGES } from "@/lib/audio/loudness";
import {
  COMPRESS_ON_FINISHED_KEY,
  NORMALIZE_ON_FINISHED_KEY,
} from "@/lib/settings";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";
import type {
  AudioCodec,
  ClipMeta,
  ClipProcessing,
  NormalizeOptions,
  NormalizedPcm,
} from "@/types/audio";
import type { ChapterId, ClipId, SegmentId, TakeId } from "@/types/domain";
import { ROW_V12_FIELDS } from "./row-fields";

/**
 * Normalize on Finished (#1433 step 3): the sweep's half, in Node.
 *
 * The chain itself is `lib/audio/loudness.ts` (`tests/normalize-pcm.test.ts`)
 * and the worker round trip is `tests/mp3-codec-normalize.test.ts`. What this
 * file pins is the decision the sweep makes per clip: run the chain when the
 * preference is on (off when nothing is stored, since #1748) and the clip's
 * record names no stage yet; encode the normalized samples; take the row
 * peaks from them; and hand the record to `commitTranscode`. With the
 * preference off the encode gets the very samples it got before v14.
 */

vi.mock("@/hooks/mp3-codec");
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const SEGMENT = "s1" as SegmentId;
const CLIP = "c1" as ClipId;

const RECORD: ClipProcessing = {
  stages: NORMALIZE_STAGES,
  measuredLufs: -27.5,
  measuredTruePeakDbtp: -9,
  appliedGainDb: 8.5,
};

function meta(processing: ClipProcessing | null): ClipMeta {
  return {
    id: CLIP,
    sampleRate: 44_100,
    frameCount: 3,
    durationMs: 1,
    createdAt: 0,
    encoding: "pcm",
    generation: 0,
    byteLength: 6,
    transcodeStallCount: 0,
    peaks: null,
    processing,
    location: { kind: "idb" },
  };
}

function loadWith(samples: Int16Array, processing: ClipProcessing | null) {
  vi.mocked(loadSegmentClip).mockResolvedValue({
    kind: "resolved",
    segment: {
      id: SEGMENT,
      chapterId: "ch" as ChapterId,
      index: 1,
      reference: null,
      label: null,
      activeTakeId: "t" as TakeId,
      status: "affirmed",
      ...ROW_V12_FIELDS,
      audioRevision: 0,
    },
    take: {
      id: "t" as TakeId,
      segmentId: SEGMENT,
      clipId: CLIP,
      createdAt: 0,
      durationMs: 1,
    },
    clip: { encoding: "pcm", meta: meta(processing), samples },
  });
}

/** Detaches the buffer as the worker's transfer does, and answers its first sample. */
const encodeMp3 = vi.fn(async (samples: Int16Array) => {
  const marker = samples[0] ?? 0;
  structuredClone(samples.buffer, {
    transfer: [samples.buffer as ArrayBuffer],
  });
  return new Uint8Array([marker & 0xff]);
});

/** Doubles every sample, a stand-in chain whose output is easy to predict. */
const normalizePcm = vi.fn<
  (
    samples: Int16Array,
    sampleRate: number,
    onProgress?: (fraction: number) => void,
    options?: NormalizeOptions
  ) => Promise<NormalizedPcm>
>(async (samples) => {
  const out = Int16Array.from(samples, (v) => v * 2);
  structuredClone(samples.buffer, {
    transfer: [samples.buffer as ArrayBuffer],
  });
  return { samples: out, processing: RECORD };
});

function storePreference(raw: string | null, compress: string | null = null) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) =>
        key === NORMALIZE_ON_FINISHED_KEY
          ? raw
          : key === COMPRESS_ON_FINISHED_KEY
            ? compress
            : null,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  encodeMp3.mockClear();
  normalizePcm.mockClear();
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work({
      encodeMp3: encodeMp3 as unknown as AudioCodec["encodeMp3"],
      decodeMp3: () => Promise.reject(new Error("no decode in a sweep")),
      normalizePcm: normalizePcm as unknown as AudioCodec["normalizePcm"],
    })
  );
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([
    { segmentId: SEGMENT, clipId: CLIP },
  ]);
  vi.mocked(commitTranscode).mockResolvedValue("committed");
});

afterEach(async () => {
  // The sweep keeps module-scoped memory that outlives a test: the compressor
  // refusal latch holds the last refused clip per segment, and only a turn
  // that completes for that segment clears it (#1892). There is no reset
  // seam, so end each test with one completed turn on the shared segment; a
  // test that refused SEGMENT/CLIP then cannot swallow the next one's row.
  // Cleared first, so the expect sees this turn's commit, not the test's.
  try {
    storePreference("0");
    loadWith(Int16Array.of(10, 20, 30), RECORD);
    const commit = vi.mocked(commitTranscode);
    commit.mockResolvedValue("committed");
    commit.mockClear();
    await requestTranscodeSweep();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![0]).toBe(SEGMENT);
    expect(commit.mock.calls[0]![1]).toBe(CLIP);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("normalize on Finished — the sweep (#1433)", () => {
  it("with the preference unset, encodes the stored samples untouched (off by default, PR #1746)", async () => {
    storePreference(null);
    const samples = Int16Array.of(10, 20, 30);
    loadWith(samples, null);

    await requestTranscodeSweep();

    expect(normalizePcm).not.toHaveBeenCalled();
    expect(encodeMp3.mock.calls[0]?.[0]).toBe(samples);
    expect(vi.mocked(commitTranscode).mock.calls[0]?.[4]).toEqual({
      stages: [],
      measuredLufs: null,
      measuredTruePeakDbtp: null,
      appliedGainDb: 0,
    });
  });

  it("with the preference explicitly on, runs the chain, encodes its output and commits its record", async () => {
    storePreference("1");
    loadWith(Int16Array.of(10, 20, 30), null);

    await requestTranscodeSweep();

    expect(normalizePcm).toHaveBeenCalledTimes(1);
    expect(normalizePcm.mock.calls[0]?.[1]).toBe(44_100);
    // The encode got the chain's output, not the stored PCM.
    expect(encodeMp3).toHaveBeenCalledTimes(1);
    expect(commitTranscode).toHaveBeenCalledWith(
      SEGMENT,
      CLIP,
      new Uint8Array([20]),
      // The row's waveform describes the stored (normalized) audio.
      computePeaks(Int16Array.of(20, 40, 60), ROW_PEAK_BUCKETS),
      RECORD
    );
  });

  it("with the preference off, encodes the stored samples untouched and records no stage", async () => {
    storePreference("0");
    const samples = Int16Array.of(10, 20, 30);
    loadWith(samples, null);

    await requestTranscodeSweep();

    expect(normalizePcm).not.toHaveBeenCalled();
    // The same buffer the load handed over, as before v14.
    expect(encodeMp3.mock.calls[0]?.[0]).toBe(samples);
    expect(commitTranscode).toHaveBeenCalledWith(
      SEGMENT,
      CLIP,
      new Uint8Array([10]),
      computePeaks(Int16Array.of(10, 20, 30), ROW_PEAK_BUCKETS),
      {
        stages: [],
        measuredLufs: null,
        measuredTruePeakDbtp: null,
        appliedGainDb: 0,
      }
    );
  });

  it("skips the chain for a clip whose record already names stages, and keeps that record", async () => {
    // Explicitly on, so the skip is the record's doing, not the default's.
    storePreference("1");
    const samples = Int16Array.of(10, 20, 30);
    loadWith(samples, RECORD);

    await requestTranscodeSweep();

    expect(normalizePcm).not.toHaveBeenCalled();
    expect(encodeMp3.mock.calls[0]?.[0]).toBe(samples);
    expect(vi.mocked(commitTranscode).mock.calls[0]?.[4]).toEqual(RECORD);
  });
});

describe("the compressor switch in the sweep (#1873)", () => {
  it("unset, asks the chain for no compressor (the switch starts off)", async () => {
    storePreference("1");
    loadWith(Int16Array.of(10, 20, 30), null);

    await requestTranscodeSweep();

    expect(normalizePcm.mock.calls[0]?.[3]).toEqual({ compress: false });
  });

  it("on, with evening out on, asks the chain to compress", async () => {
    storePreference("1", "1");
    loadWith(Int16Array.of(10, 20, 30), null);

    await requestTranscodeSweep();

    expect(normalizePcm.mock.calls[0]?.[3]).toEqual({ compress: true });
  });

  it("on, with evening out off, runs no chain: the compressor is one of its stages", async () => {
    storePreference("0", "1");
    const samples = Int16Array.of(10, 20, 30);
    loadWith(samples, null);

    await requestTranscodeSweep();

    expect(normalizePcm).not.toHaveBeenCalled();
    expect(encodeMp3.mock.calls[0]?.[0]).toBe(samples);
  });

  it("a compressor refusal keeps the PCM and is reported under its own context", async () => {
    storePreference("1", "1");
    loadWith(Int16Array.of(10, 20, 30), null);
    const refused = new CompressorRangeError(
      "compressor: chunk holds a non-finite sample"
    );
    normalizePcm.mockRejectedValueOnce(refused);

    await requestTranscodeSweep();

    expect(encodeMp3).not.toHaveBeenCalled();
    expect(commitTranscode).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledTimes(1);
    const [cause, context] = vi.mocked(reportFailure).mock.calls[0]!;
    expect(context).toBe("transcode-compressor");
    expect((cause as Error).cause).toBe(refused);
  });

  it("a clip the compressor refused on two sweeps writes one row, and is tried again each time (#1879)", async () => {
    storePreference("1", "1");
    loadWith(Int16Array.of(10, 20, 30), null);
    // The sweep's memory is module state that outlives a test; a turn that
    // completes clears it, so this one starts from none.
    await requestTranscodeSweep();
    vi.mocked(commitTranscode).mockClear();
    vi.mocked(reportFailure).mockClear();
    loadWith(Int16Array.of(10, 20, 30), null);
    normalizePcm.mockClear();
    // A fresh error per sweep, as the worker round trip builds one per reply.
    normalizePcm
      .mockRejectedValueOnce(new CompressorRangeError("compressor: first"))
      .mockRejectedValueOnce(new CompressorRangeError("compressor: second"));
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([
      { segmentId: SEGMENT, clipId: CLIP },
    ]);

    await requestTranscodeSweep();
    await requestTranscodeSweep();

    // Still unfinished, so the sweep went back to it: nothing was held out.
    expect(normalizePcm).toHaveBeenCalledTimes(2);
    expect(commitTranscode).not.toHaveBeenCalled();
    const contexts = vi.mocked(reportFailure).mock.calls.map((c) => c[1]);
    expect(contexts).toEqual(["transcode-compressor"]);
  });

  it("a second compressor refusal on the same clip, in its own test, writes its own row (#1892)", async () => {
    storePreference("1", "1");
    // Start from no latch whatever ran before: one completed turn clears it.
    loadWith(Int16Array.of(10, 20, 30), null);
    await requestTranscodeSweep();
    vi.mocked(reportFailure).mockClear();

    // Refusal, a completed turn, then the same clip refused again: the second
    // refusal is a new episode and writes its own row, with no other test's
    // state needed to make the latch dirty.
    loadWith(Int16Array.of(10, 20, 30), null);
    normalizePcm.mockRejectedValueOnce(
      new CompressorRangeError("compressor: first episode")
    );
    await requestTranscodeSweep();

    loadWith(Int16Array.of(10, 20, 30), null);
    await requestTranscodeSweep();

    loadWith(Int16Array.of(10, 20, 30), null);
    normalizePcm.mockRejectedValueOnce(
      new CompressorRangeError("compressor: second episode")
    );
    await requestTranscodeSweep();

    const contexts = vi.mocked(reportFailure).mock.calls.map((c) => c[1]);
    expect(contexts).toEqual(["transcode-compressor", "transcode-compressor"]);
    // Each row carries its own episode's refusal, not one error twice.
    const messages = vi
      .mocked(reportFailure)
      .mock.calls.map((c) => ((c[0] as Error).cause as Error).message);
    expect(messages).toEqual([
      "compressor: first episode",
      "compressor: second episode",
    ]);
  });

  it("any other chain failure keeps its existing context", async () => {
    storePreference("1", "1");
    loadWith(Int16Array.of(10, 20, 30), null);
    normalizePcm.mockRejectedValueOnce(new RangeError("not the compressor"));

    await requestTranscodeSweep();

    expect(vi.mocked(reportFailure).mock.calls[0]?.[1]).toBe(
      "transcode-segment"
    );
  });
});
