import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { closeDb, getDb } from "@/lib/storage/db";
import type { AudioCodec } from "@/types/audio";
import type {
  BookId,
  ChapterId,
  ClipId,
  SegmentId,
  TakeId,
} from "@/types/domain";
import { clearAllStores } from "./support";

vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return { ...actual, withEncoder: vi.fn() };
});

const bid = (s: string) => s as BookId;
const chid = (s: string) => s as ChapterId;
const sid = (s: string) => s as SegmentId;
const tid = (s: string) => s as TakeId;
const cid = (s: string) => s as ClipId;

async function seedFinishedPcmSegments(count: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["books", "chapters", "segments", "takes", "clipMeta", "clipData"],
    "readwrite"
  );
  await tx.objectStore("books").put({
    id: bid("b1"),
    name: "Book 001",
    languageCode: null,
    chapterIds: [chid("ch1")],
    createdAt: 0,
    updatedAt: 0,
    coverColourKey: null,
  });
  await tx.objectStore("chapters").put({
    id: chid("ch1"),
    bookId: bid("b1"),
    number: 1,
    name: null,
    segmentIds: Array.from({ length: count }, (_, i) => sid(`p0${i}`)),
  });
  for (let i = 0; i < count; i += 1) {
    const segmentId = sid(`p0${i}`);
    const takeId = tid(`t0${i}`);
    const clipId = cid(`c0${i}`);
    const samples = Int16Array.of(i);
    await tx.objectStore("segments").put({
      id: segmentId,
      chapterId: chid("ch1"),
      index: i + 1,
      reference: null,
      label: null,
      activeTakeId: takeId,
      status: "affirmed",
    });
    await tx.objectStore("takes").put({
      id: takeId,
      segmentId,
      clipId,
      createdAt: 0,
      durationMs: 1,
    });
    await tx.objectStore("clipMeta").put({
      id: clipId,
      sampleRate: CANONICAL_SAMPLE_RATE,
      frameCount: samples.length,
      durationMs: 1,
      createdAt: 0,
      encoding: "pcm",
      generation: 0,
      byteLength: samples.byteLength,
      transcodeStallCount: 0,
      peaks: null,
    });
    await tx.objectStore("clipData").put(samples.buffer, clipId);
  }
  await tx.done;
}

async function coldLaunchSweep(
  poisonSamples: ReadonlySet<number>
): Promise<void> {
  await closeDb();
  vi.resetModules();
  const codecModule = await import("@/hooks/mp3-codec");
  const { EncoderStalledError } = codecModule;
  vi.mocked(codecModule.withEncoder).mockImplementation(
    async (_signal, work) => {
      const codec: AudioCodec = {
        encodeMp3: async (samples) => {
          const marker = samples[0] ?? 0;
          if (poisonSamples.has(marker)) throw new EncoderStalledError(15_000);
          return new Uint8Array([marker + 1]);
        },
        decodeMp3: () => Promise.reject(new Error("no decode expected")),
      };
      return work(codec);
    }
  );
  const { requestTranscodeSweep } = await import("@/hooks/finish-transcode");
  await requestTranscodeSweep();
}

beforeEach(async () => {
  await clearAllStores();
  vi.restoreAllMocks();
});

describe("transcode sweep durable stall accounting across cold launches (#404)", () => {
  it.each([
    { poisonCount: 2, firstHealthy: 2 },
    { poisonCount: 3, firstHealthy: 3 },
  ])(
    "lets healthy clips after $poisonCount poison clips transcode on the next cold launch",
    async ({ poisonCount, firstHealthy }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await seedFinishedPcmSegments(5);
        const poison = new Set(
          Array.from({ length: poisonCount }, (_, i) => i)
        );

        await coldLaunchSweep(poison);
        expect(
          (await (await getDb()).get("clipMeta", cid(`c0${firstHealthy}`)))
            ?.encoding
        ).toBe("pcm");

        await coldLaunchSweep(poison);

        const healthy = await (
          await getDb()
        ).get("clipMeta", cid(`c0${firstHealthy}`));
        expect(healthy?.encoding).toBe("mp3");
        for (let i = 0; i < poisonCount; i += 1) {
          expect(
            (await (await getDb()).get("clipMeta", cid(`c0${i}`)))
              ?.transcodeStallCount
          ).toBeGreaterThan(0);
        }
      } finally {
        errorSpy.mockRestore();
      }
    }
  );
});
