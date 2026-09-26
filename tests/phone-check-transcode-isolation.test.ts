import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { withEncoder } from "@/hooks/mp3-codec";
import { runMemoryCheck, runPhoneChecks } from "@/hooks/use-phone-check";
import type { AllocationDeps } from "@/lib/phone-check/allocation";
import type {
  DeviceInfo,
  EncodeResult,
  ProbeOutcome,
  StorageResult,
} from "@/lib/phone-check/report";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentAudio } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import type { AudioCodec, Clip } from "@/types/audio";
import type { ChapterId, ClipId, SegmentId, TakeId } from "@/types/domain";

/**
 * #1009, Frank R1 P2 on #1013: the background transcode sweep must not run
 * while the phone check measures storage or memory. Three halves: the sweep
 * starts no turn during a run, a turn already in flight when a run starts
 * finishes before the run measures anything, and a request made during the
 * run is carried out once the run ends.
 *
 * The sweep here is the REAL module (`finish-transcode.ts`); only the codec
 * and the storage it reads and writes are stubbed, as in
 * `tests/transcode-pause.test.ts`.
 */

vi.mock("@/hooks/mp3-codec");
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const sid = (s: string) => s as SegmentId;
const cid = (s: string) => s as ClipId;

function resolvedPcm(segmentId: SegmentId, clipId: ClipId): SegmentAudio<Clip> {
  const samples = Int16Array.of(1);
  return {
    kind: "resolved",
    segment: {
      id: segmentId,
      chapterId: "ch" as ChapterId,
      index: 1,
      reference: null,
      label: null,
      activeTakeId: "take" as TakeId,
      status: "affirmed",
    },
    take: {
      id: "take" as TakeId,
      segmentId,
      clipId,
      createdAt: 0,
      durationMs: 1,
    },
    clip: {
      encoding: "pcm",
      meta: {
        id: clipId,
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
    },
  };
}

const codec = (): AudioCodec => ({
  encodeMp3: async () => new Uint8Array([1]),
  decodeMp3: () => Promise.reject(new Error("no decode expected in a sweep")),
});

const OWED = [{ segmentId: sid("s1"), clipId: cid("clip-s1") }];

const ok = <T>(value: T): ProbeOutcome<T> => ({ status: "ok", value });
const DEVICE = {} as DeviceInfo;
const ENCODE = {} as EncodeResult;
const STORAGE = {} as StorageResult;

function memoryDeps(onAllocate: () => void): AllocationDeps {
  return {
    allocate: onAllocate,
    writeBreadcrumb: () => {},
    yieldTurn: () => Promise.resolve(),
    steps: [25, 50],
  };
}

/** Releases for held commits, so a failed case cannot wedge the next one. */
const heldTurns: (() => void)[] = [];

/** Hold the sweep's next commit open until `finish` is called. */
function holdNextCommit(log: string[]): { finish: () => void } {
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  heldTurns.push(finish);
  vi.mocked(commitTranscode).mockImplementationOnce(async () => {
    await held;
    log.push("sweep-commit-done");
    return "committed";
  });
  return { finish };
}

/** A few macrotask turns: long enough for anything unblocked to have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the phone check holds the transcode sweep off its measurements", () => {
  afterEach(() => {
    for (const finish of heldTurns.splice(0)) finish();
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
      work(codec())
    );
    vi.mocked(loadSegmentClip).mockImplementation(async (segmentId) =>
      resolvedPcm(segmentId, cid(`clip-${segmentId}`))
    );
    vi.mocked(commitTranscode).mockResolvedValue("committed");
    // Join any run an earlier case left in flight on an empty owed list, so
    // it cannot spend this case's mocks.
    vi.mocked(listPcmFinishedSegments).mockResolvedValue([]);
    await requestTranscodeSweep();
    vi.mocked(listPcmFinishedSegments).mockClear();
    vi.mocked(commitTranscode).mockClear();
  });

  it("starts no sweep turn while the memory ceiling allocates, and runs the request after", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue(OWED);
    const listedDuringRun: number[] = [];

    await runMemoryCheck(
      memoryDeps(() => {
        // A Finished transition asks for a sweep mid-measurement.
        void requestTranscodeSweep();
        listedDuringRun.push(
          vi.mocked(listPcmFinishedSegments).mock.calls.length
        );
      })
    );

    expect(listedDuringRun).toEqual([0, 0]);
    expect(commitTranscode).not.toHaveBeenCalled();
    // The run is over: the deferred request is carried out.
    await vi.waitFor(() => {
      expect(commitTranscode).toHaveBeenCalledTimes(1);
    });
  });

  it("starts no sweep turn while the storage probe runs, and runs the request after", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue(OWED);
    let listedDuringStorage = -1;

    await runPhoneChecks(
      {
        device: async () => ok(DEVICE),
        encode: async () => ok(ENCODE),
        storage: async () => {
          void requestTranscodeSweep();
          await settle();
          listedDuringStorage = vi.mocked(listPcmFinishedSegments).mock.calls
            .length;
          return ok(STORAGE);
        },
      },
      () => {},
      () => {}
    );

    expect(listedDuringStorage).toBe(0);
    expect(commitTranscode).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(commitTranscode).toHaveBeenCalledTimes(1);
    });
  });

  it("lets a sweep turn already in flight finish before the memory ceiling allocates", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue(OWED);
    const log: string[] = [];
    const turn = holdNextCommit(log);
    void requestTranscodeSweep();
    await vi.waitFor(() => {
      expect(commitTranscode).toHaveBeenCalledTimes(1);
    });

    // Direct entry into step 4 while the turn is still committing.
    const run = runMemoryCheck(memoryDeps(() => log.push("allocate")));
    await settle();
    expect(log).toEqual([]);

    turn.finish();
    await run;
    expect(log).toEqual(["sweep-commit-done", "allocate", "allocate"]);
  });

  it("lets a sweep turn already in flight finish before the storage probe starts", async () => {
    vi.mocked(listPcmFinishedSegments).mockResolvedValue(OWED);
    const log: string[] = [];
    const turn = holdNextCommit(log);
    void requestTranscodeSweep();
    await vi.waitFor(() => {
      expect(commitTranscode).toHaveBeenCalledTimes(1);
    });

    const run = runPhoneChecks(
      {
        device: async () => ok(DEVICE),
        encode: async () => ok(ENCODE),
        storage: async () => {
          log.push("storage");
          return ok(STORAGE);
        },
      },
      () => {},
      () => {}
    );
    await settle();
    expect(log).toEqual([]);

    turn.finish();
    await run;
    expect(log).toEqual(["sweep-commit-done", "storage"]);
  });
});
