import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { computePeaks } from "@/lib/audio/peaks";
import { NORMALIZE_STAGES } from "@/lib/audio/loudness";
import { NORMALIZE_ON_FINISHED_KEY } from "@/lib/settings";
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
  (samples: Int16Array, sampleRate: number) => Promise<NormalizedPcm>
>(async (samples) => {
  const out = Int16Array.from(samples, (v) => v * 2);
  structuredClone(samples.buffer, {
    transfer: [samples.buffer as ArrayBuffer],
  });
  return { samples: out, processing: RECORD };
});

function storePreference(raw: string | null): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) =>
        key === NORMALIZE_ON_FINISHED_KEY ? raw : null,
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

afterEach(() => {
  vi.unstubAllGlobals();
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
