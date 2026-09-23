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

/**
 * A clip that stalls the encoder EVERY time, and a translator who keeps
 * sharing (#682).
 *
 * Each successful Share clears the encoder's health (`noteEncodeSucceeded`), and
 * the sweep asks for a pass on that `failing -> ok` edge (#404). Without a bound,
 * every such pass goes back at the poison clip, which holds the one encoder lane
 * for a full silence deadline — so a Share tapped while it is in flight waits
 * behind it, once per Share, for the life of the page.
 *
 * The fake below stands in for `mp3-codec.ts` at the injected `AudioCodec`:
 * `withEncoder` is a real single-file lane (a job waits for the one ahead), and
 * the codec publishes health the way the store does — `ok` on bytes, `failing`
 * on a stall, listeners called on change only. A poison encode does not reject
 * by itself: it stays pending, holding the lane, until the test expires its
 * deadline. That is what lets a case ask the question the issue asks — is the
 * lane held by the poison clip at the moment the next Share arrives?
 */

type Health = "ok" | "failing";
let healthListener: ((health: Health) => void) | null = null;

vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return {
    ...actual,
    withEncoder: vi.fn(),
    subscribeToEncoderHealth: vi.fn((listener: (health: Health) => void) => {
      healthListener = listener;
      return () => {
        if (healthListener === listener) healthListener = null;
      };
    }),
  };
});
vi.mock("@/lib/storage/segment-audio");
vi.mock("@/lib/storage/transcode");

const sid = (s: string) => s as SegmentId;
const cid = (s: string) => s as ClipId;

/** Sample values the fake codec keys on. */
const POISON = 1;
const HEALTHY = 2;
const SHARE = 9;

function segment(id: SegmentId): Segment {
  return {
    id,
    chapterId: "ch" as ChapterId,
    index: 1,
    reference: null,
    label: null,
    activeTakeId: "take" as TakeId,
    status: "affirmed",
  };
}

function resolvedPcm(
  segmentId: SegmentId,
  clipId: ClipId,
  value: number
): SegmentAudio<Clip> {
  const samples = Int16Array.of(value);
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
    clip: {
      encoding: "pcm",
      meta: {
        id: clipId,
        sampleRate: 22_050,
        frameCount: 1,
        durationMs: 1,
        createdAt: 0,
        encoding: "pcm",
        generation: 0,
        byteLength: 2,
        transcodeStallCount: 0,
        peaks: null,
      },
      samples,
    },
  };
}

type Sweep = typeof import("@/hooks/finish-transcode");
type Codec = typeof import("@/hooks/mp3-codec");

let requestTranscodeSweep: Sweep["requestTranscodeSweep"];
let withEncoder: Codec["withEncoder"];
let EncoderStalledError: Codec["EncoderStalledError"];

let health: Health;
let pendingStall: (() => void) | null;
let poisonAttempts: number;
let committed: SegmentId[];
/** What is still finished-and-PCM; a commit takes a segment off it. */
let owed: Array<{ segmentId: SegmentId; clipId: ClipId; value: number }>;

function publish(next: Health): void {
  if (next === health) return;
  health = next;
  healthListener?.(next);
}

const codec: AudioCodec = {
  encodeMp3: (samples) => {
    if (samples[0] === POISON) {
      poisonAttempts += 1;
      return new Promise<Uint8Array<ArrayBuffer>>((_resolve, reject) => {
        pendingStall = () => {
          pendingStall = null;
          publish("failing");
          reject(new EncoderStalledError(15_000));
        };
      });
    }
    publish("ok");
    return Promise.resolve(Uint8Array.of(samples[0] ?? 0));
  },
  decodeMp3: () => Promise.reject(new Error("no decode expected here")),
};

/** Let every queued microtask and timer-0 continuation run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The poison encode's silence deadline passes. */
async function expireStall(): Promise<void> {
  expect(pendingStall).not.toBeNull();
  pendingStall?.();
  await settle();
}

/** A foreground Share: one encode on the same lane, which succeeds. */
function share(): Promise<Uint8Array<ArrayBuffer>> {
  return withEncoder(undefined, (c) => c.encodeMp3(Int16Array.of(SHARE)));
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  healthListener = null;
  health = "ok";
  pendingStall = null;
  poisonAttempts = 0;
  committed = [];

  const codecModule = await import("@/hooks/mp3-codec");
  EncoderStalledError = codecModule.EncoderStalledError;
  withEncoder = codecModule.withEncoder;
  let lane: Promise<void> = Promise.resolve();
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) => {
    const previous = lane;
    let release!: () => void;
    lane = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await work(codec);
    } finally {
      release();
    }
  });

  const segmentAudio = await import("@/lib/storage/segment-audio");
  vi.mocked(segmentAudio.loadSegmentClip).mockImplementation(
    async (segmentId) => {
      const entry = owed.find((o) => o.segmentId === segmentId);
      if (!entry) throw new Error(`unexpected load of ${segmentId}`);
      return resolvedPcm(entry.segmentId, entry.clipId, entry.value);
    }
  );

  const storage = await import("@/lib/storage/transcode");
  vi.mocked(storage.listPcmFinishedSegments).mockImplementation(async () =>
    owed.map(({ segmentId, clipId }) => ({ segmentId, clipId }))
  );
  vi.mocked(storage.commitTranscode).mockImplementation(async (segmentId) => {
    committed.push(segmentId);
    owed = owed.filter((o) => o.segmentId !== segmentId);
    return "committed";
  });
  vi.mocked(storage.recordTranscodeStall).mockResolvedValue(undefined);

  ({ requestTranscodeSweep } = await import("@/hooks/finish-transcode"));
});

describe("a persistently stalling clip and successive Shares (#682)", () => {
  it("costs at most ONE later Share an encoder timeout, and keeps its PCM", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      owed = [{ segmentId: sid("poison"), clipId: cid("cp"), value: POISON }];

      // Launch: the poison clip wedges the worker, the drain has nothing else
      // to do, the run ends, and health reads failing.
      const launch = requestTranscodeSweep();
      await settle();
      await expireStall();
      await launch;
      expect(health).toBe("failing");

      // Share after Share. Each one succeeds and clears health, which asks for
      // a sweep. `heldByPoison[k]` is whether the lane was held by the poison
      // clip when Share k+1 arrived — i.e. whether Share k+1 would wait out a
      // silence deadline.
      const heldByPoison: boolean[] = [];
      for (let k = 0; k < 4; k += 1) {
        await expect(share()).resolves.toEqual(Uint8Array.of(SHARE));
        await settle();
        heldByPoison.push(pendingStall !== null);
        if (pendingStall) await expireStall();
      }

      // One retry after the first recovery — the one that tells a genuinely
      // repaired encoder from a clip that wedges every worker — and never again
      // in this page.
      expect(heldByPoison).toEqual([true, false, false, false]);
      expect(poisonAttempts).toBe(2);

      // Never dropped: nothing was committed over it, and it is still owed for
      // the next launch.
      expect(committed).toEqual([]);
      expect(owed.map((o) => o.segmentId)).toEqual([sid("poison")]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("still transcodes a clip that stalled once when the encoder is genuinely repaired", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The clip is not the problem: the encoder was. It stalls at launch and
      // encodes fine once a Share has shown the encoder works again.
      owed = [{ segmentId: sid("victim"), clipId: cid("cv"), value: POISON }];
      const launch = requestTranscodeSweep();
      await settle();
      await expireStall();
      await launch;
      expect(health).toBe("failing");

      owed = [{ segmentId: sid("victim"), clipId: cid("cv"), value: HEALTHY }];
      await share();
      await settle();

      expect(committed).toEqual([sid("victim")]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not count a stall on an encoder not yet shown to work", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      owed = [{ segmentId: sid("a"), clipId: cid("ca"), value: POISON }];
      const launch = requestTranscodeSweep();
      await settle();
      await expireStall();
      await launch;
      expect(health).toBe("failing");

      // A Finished transition while the encoder is still broken: A stalls
      // again, on a worker nobody has seen produce bytes.
      const again = requestTranscodeSweep();
      await settle();
      await expireStall();
      await again;
      expect(health).toBe("failing");

      // The encoder is genuinely repaired: the recovery sweep still tries A.
      owed = [{ segmentId: sid("a"), clipId: cid("ca"), value: HEALTHY }];
      await share();
      await settle();

      expect(committed).toEqual([sid("a")]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the healthy tail moving past a clip it has stopped retrying", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      owed = [{ segmentId: sid("poison"), clipId: cid("cp"), value: POISON }];
      const launch = requestTranscodeSweep();
      await settle();
      await expireStall();
      await launch;

      // First recovery: the one retry, which stalls again.
      await share();
      await settle();
      await expireStall();

      // A segment finished later still converts, and the poison clip is not
      // attempted in front of it — or at all — on the way.
      owed = [
        ...owed,
        { segmentId: sid("fresh"), clipId: cid("cf"), value: HEALTHY },
      ];
      // Not awaited: were the poison clip attempted, its encode would hold the
      // run open until a deadline this case never expires.
      void requestTranscodeSweep();
      await settle();

      expect(committed).toEqual([sid("fresh")]);
      expect(pendingStall).toBeNull();
      expect(poisonAttempts).toBe(2);
      expect(owed.map((o) => o.segmentId)).toEqual([sid("poison")]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
