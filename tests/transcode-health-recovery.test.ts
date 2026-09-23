import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SegmentAudio } from "@/lib/storage/segment-audio";
import type { AudioCodec, Clip } from "@/types/audio";
import type {
  ChapterId,
  ClipId,
  Segment,
  SegmentId,
  TakeId,
} from "@/types/domain";

let healthListener: ((health: "ok" | "failing") => void) | null = null;

vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return {
    ...actual,
    withEncoder: vi.fn(),
    subscribeToEncoderHealth: vi.fn(
      (listener: (health: "ok" | "failing") => void) => {
        healthListener = listener;
        return () => {
          if (healthListener === listener) healthListener = null;
        };
      }
    ),
  };
});
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const sid = (s: string) => s as SegmentId;
const cid = (s: string) => s as ClipId;

function segment(id: SegmentId): Segment {
  return {
    id,
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

function resolvedPcm(segmentId: SegmentId): SegmentAudio<Clip> {
  const n = Number(segmentId.slice(1));
  const clipId = cid(`c${String(n).padStart(2, "0")}`);
  return {
    kind: "resolved",
    segment: segment(segmentId),
    take: {
      id: "take" as TakeId,
      segmentId,
      clipId,
      createdAt: 0,
      durationMs: 1,
    },
    clip: pcmClip(clipId, Int16Array.of(n)),
  };
}

function codec(encodeMp3: AudioCodec["encodeMp3"]): AudioCodec {
  return {
    encodeMp3,
    decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
  };
}

type Sweep = typeof import("@/hooks/finish-transcode");
type Codec = typeof import("@/hooks/mp3-codec");
type Storage = typeof import("@/lib/storage/transcode");
type SegmentAudioModule = typeof import("@/lib/storage/segment-audio");

let requestTranscodeSweep: Sweep["requestTranscodeSweep"];
let EncoderStalledError: Codec["EncoderStalledError"];
let withEncoder: Codec["withEncoder"];
let loadSegmentClip: SegmentAudioModule["loadSegmentClip"];
let commitTranscode: Storage["commitTranscode"];
let listPcmFinishedSegments: Storage["listPcmFinishedSegments"];
let encodeMp3: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  healthListener = null;

  const codecModule = await import("@/hooks/mp3-codec");
  EncoderStalledError = codecModule.EncoderStalledError;
  withEncoder = codecModule.withEncoder;

  encodeMp3 = vi.fn(async (samples: Int16Array) => {
    if (samples[0] === 0 || samples[0] === 5)
      throw new EncoderStalledError(15_000);
    return new Uint8Array([samples[0] ?? 0]);
  });
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec(encodeMp3 as unknown as AudioCodec["encodeMp3"]))
  );

  const segmentAudio = await import("@/lib/storage/segment-audio");
  loadSegmentClip = segmentAudio.loadSegmentClip;
  vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
    resolvedPcm(segmentId)
  );

  const storage = await import("@/lib/storage/transcode");
  commitTranscode = storage.commitTranscode;
  listPcmFinishedSegments = storage.listPcmFinishedSegments;
  vi.mocked(commitTranscode).mockResolvedValue("committed");
  vi.mocked(listPcmFinishedSegments).mockResolvedValue([
    { segmentId: sid("p00"), clipId: cid("c00") },
    { segmentId: sid("p05"), clipId: cid("c05") },
    { segmentId: sid("p06"), clipId: cid("c06") },
  ]);

  ({ requestTranscodeSweep } = await import("@/hooks/finish-transcode"));
});

describe("transcode sweep restart on encoder health recovery (#404)", () => {
  it("requests a new sweep when health recovers after a two-stall run ended", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await requestTranscodeSweep();

      expect(commitTranscode).not.toHaveBeenCalledWith(
        sid("p06"),
        cid("c06"),
        expect.any(Uint8Array),
        expect.anything()
      );
      expect(healthListener).not.toBeNull();

      healthListener?.("failing");
      healthListener?.("ok");

      await vi.waitFor(() => {
        expect(commitTranscode).toHaveBeenCalledWith(
          sid("p06"),
          cid("c06"),
          expect.any(Uint8Array),
          expect.anything()
        );
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
