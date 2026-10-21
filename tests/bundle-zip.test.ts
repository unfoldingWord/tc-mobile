import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { WAV_HEADER_BYTES } from "@/lib/audio/wav";
import { type ArchiveSink, memoryArchiveSink } from "@/lib/export/book";
import {
  type BundleAudioSource,
  type BundleWriteInput,
  type BundleWriteSegment,
  PcmLengthMismatchError,
  writeBundleZip,
} from "@/lib/export/bundle/write";
import type { ClipMeta } from "@/types/audio";
import type {
  Book,
  BookId,
  Chapter,
  ChapterId,
  ClipId,
  SegmentId,
  TakeId,
} from "@/types/domain";

import {
  BundleReadError,
  type BundleReadReason,
  readBundle,
} from "./support/scripture-bundle-reader";

/**
 * The Scripture Bundle zip writer (#1587, ADR 0014 point 3), read back by the
 * test-side reader in `support/scripture-bundle-reader.ts`. The writer is pure
 * and takes each segment's audio as a chunked source, so a whole book runs in
 * Node with no storage and no browser. Nothing here ran on a phone.
 */

const BOOK_ID = "0b5c6f0e-1111-4222-8333-944445555666" as BookId;
const EXPORTED_AT = Date.parse("2026-11-20T10:00:00.000Z");

function concat(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function clip(
  id: string,
  encoding: "pcm" | "mp3",
  byteLength: number
): ClipMeta {
  const frameCount = encoding === "pcm" ? byteLength / 2 : 44100;
  return {
    id: id as ClipId,
    sampleRate: 44100,
    frameCount,
    durationMs: Math.round((frameCount / 44100) * 1000),
    createdAt: 1,
    encoding,
    generation: encoding === "mp3" ? 1 : 0,
    byteLength,
    transcodeStallCount: 0,
    peaks: null,
  };
}

/** `bytes` handed out in pieces of `size`, each a fresh view (never reused). */
function chunked(
  meta: ClipMeta,
  bytes: Uint8Array<ArrayBuffer>,
  size: number
): BundleAudioSource {
  return {
    clip: meta,
    async *read() {
      for (let at = 0; at < bytes.length; at += size) {
        yield bytes.subarray(at, Math.min(at + size, bytes.length));
      }
    },
  };
}

/** Distinctive bytes, so a flip can be placed inside one ingredient. */
function mp3Bytes(marker: string, length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) % 251;
  bytes.set(new TextEncoder().encode(marker), 16);
  return bytes;
}

function pcmBytes(frames: number, seed: number): Uint8Array<ArrayBuffer> {
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i++) samples[i] = ((i * seed) % 2000) - 1000;
  return new Uint8Array(samples.buffer);
}

function seg(
  chapter: string,
  n: number,
  source: BundleAudioSource | null,
  take: "none" | "with" = source === null ? "none" : "with"
): BundleWriteSegment {
  const id = `${chapter}-seg-${n}` as SegmentId;
  return {
    segment: {
      id,
      chapterId: chapter as ChapterId,
      index: n,
      reference: null,
      label: null,
      activeTakeId: take === "with" ? (`${id}-take` as TakeId) : null,
      status: source === null ? "not-started" : "affirmed",
      createdAt: 1,
      modifiedAt: null,
      templateKey: null,
    },
    take:
      take === "with"
        ? {
            id: `${id}-take` as TakeId,
            segmentId: id,
            clipId: (source?.clip.id ?? "gone") as ClipId,
            createdAt: 2,
            durationMs: 1000,
          }
        : null,
    source,
  };
}

function chapter(id: string, number: number, segments: BundleWriteSegment[]) {
  const value: Chapter = {
    id: id as ChapterId,
    bookId: BOOK_ID,
    number,
    name: null,
    segmentIds: segments.map((s) => s.segment.id),
    createdAt: 1,
    modifiedAt: null,
    templateKey: null,
  };
  return { chapter: value, segments };
}

function bookOf(chapters: ReturnType<typeof chapter>[]): BundleWriteInput {
  const book: Book = {
    id: BOOK_ID,
    name: "Mark",
    number: 1,
    languageCode: "sw",
    chapterIds: chapters.map((c) => c.chapter.id),
    createdAt: 1,
    updatedAt: 1,
    coverColourKey: null,
    shelfPosition: 0,
    provenance: { kind: "blank" },
    licence: "CC-BY-SA-4.0",
    modifiedAt: null,
  };
  return {
    book,
    bookName: "Mark",
    chapters,
    appVersion: "2.0.0",
    defaultLocale: "en",
    exportedAt: EXPORTED_AT,
    languageName: "Swahili",
  };
}

const MP3_1 = mp3Bytes("MP3-FIXTURE-ONE", 5000);
const PCM_1 = pcmBytes(3000, 7);
const PCM_2 = pcmBytes(1201, 13);

/**
 * Two chapters: an MP3 segment, a WAV segment and a never-recorded one; then a
 * WAV segment and a take whose clip is gone. The chapters are numbered 5 and 9
 * so a path built from the number instead of the position shows.
 */
function fixture(): BundleWriteInput {
  return bookOf([
    chapter("ch-a", 5, [
      seg("ch-a", 1, chunked(clip("clip-1", "mp3", MP3_1.length), MP3_1, 700)),
      seg("ch-a", 2, chunked(clip("clip-2", "pcm", PCM_1.length), PCM_1, 1000)),
      seg("ch-a", 3, null),
    ]),
    chapter("ch-b", 9, [
      seg("ch-b", 1, chunked(clip("clip-3", "pcm", PCM_2.length), PCM_2, 999)),
      seg("ch-b", 2, null, "with"),
    ]),
  ]);
}

async function written(input: BundleWriteInput): Promise<Uint8Array> {
  const sink = memoryArchiveSink();
  const result = await writeBundleZip(input, sink);
  expect(result).toEqual({ audio: 3, missing: 2 });
  return concat(sink.chunks);
}

function readReason(zip: Uint8Array): BundleReadReason | "read" {
  try {
    readBundle(zip);
    return "read";
  } catch (cause) {
    if (cause instanceof BundleReadError) return cause.reason;
    throw cause;
  }
}

describe("a book round-trips through the bundle zip (#1587)", () => {
  it("writes every recorded segment at its ordinal path, project.json, then metadata.json last, and reads back", async () => {
    const zip = await written(fixture());
    const { files, metadata, project } = readBundle(zip);

    expect(Object.keys(files)).toEqual([
      "ingredients/audio/c001/s001.mp3",
      "ingredients/audio/c001/s002.wav",
      "ingredients/audio/c002/s001.wav",
      "ingredients/tc-mobile/project.json",
      "metadata.json",
    ]);
    // The MP3 goes in as stored; a PCM clip gets a WAV header and its bytes
    // unchanged.
    expect(files["ingredients/audio/c001/s001.mp3"]).toEqual(MP3_1);
    const wav = files["ingredients/audio/c001/s002.wav"]!;
    expect(wav.subarray(WAV_HEADER_BYTES)).toEqual(PCM_1);
    expect(files["ingredients/audio/c002/s001.wav"]!.length).toBe(
      WAV_HEADER_BYTES + PCM_2.length
    );

    expect(metadata.type.flavorType.flavor.name).toBe("x-tcMobileAudio");
    // project.json lists every segment, audio or not, and says why not.
    const segments = (project.chapters as { segments: unknown[] }[]).flatMap(
      (c) => c.segments
    ) as { id: string; ingredient: string | null; missingAudio: string }[];
    expect(segments.map((s) => [s.id, s.ingredient, s.missingAudio])).toEqual([
      ["ch-a-seg-1", "ingredients/audio/c001/s001.mp3", null],
      ["ch-a-seg-2", "ingredients/audio/c001/s002.wav", null],
      ["ch-a-seg-3", null, "not-recorded"],
      ["ch-b-seg-1", "ingredients/audio/c002/s001.wav", null],
      ["ch-b-seg-2", null, "audio-missing"],
    ]);
  });

  it("writes a book with no audio at all as project.json and metadata.json", async () => {
    const sink = memoryArchiveSink();
    const input = bookOf([chapter("ch-a", 1, [seg("ch-a", 1, null)])]);
    expect(await writeBundleZip(input, sink)).toEqual({ audio: 0, missing: 1 });
    const { files } = readBundle(concat(sink.chunks));
    expect(Object.keys(files)).toEqual([
      "ingredients/tc-mobile/project.json",
      "metadata.json",
    ]);
  });

  it("returns null, writing nothing more, once shouldContinue says stop", async () => {
    const sink = memoryArchiveSink();
    let checks = 0;
    const result = await writeBundleZip(fixture(), sink, () => ++checks < 2);
    expect(result).toBeNull();
    const names = new TextDecoder().decode(concat(sink.chunks));
    expect(names).toContain("c001/s001.mp3");
    expect(names).not.toContain("c001/s002.wav");
    expect(names).not.toContain("metadata.json");
  });
});

describe("the reader refuses a bundle that does not check out", () => {
  /** The good bundle's entries, edited, re-zipped stored in the given order. */
  async function edited(
    edit: (files: Record<string, Uint8Array>) => Record<string, Uint8Array>
  ): Promise<Uint8Array> {
    const files = unzipSync(await written(fixture()));
    return zipSync(edit(files), { level: 0 });
  }

  it("fails on MD5 when one byte of one ingredient is flipped in the archive", async () => {
    const zip = await written(fixture());
    const marker = new TextEncoder().encode("MP3-FIXTURE-ONE");
    const at = Buffer.from(zip).indexOf(Buffer.from(marker));
    expect(at).toBeGreaterThan(0);
    const flipped = zip.slice();
    flipped[at + 3]! ^= 0x01;
    expect(readReason(zip)).toBe("read");
    expect(readReason(flipped)).toBe("md5");
  });

  it("fails when an ingredient is missing, unlisted, or metadata.json is not last", async () => {
    expect(
      readReason(
        await edited((f) => {
          delete f["ingredients/audio/c002/s001.wav"];
          return f;
        })
      )
    ).toBe("missing-file");
    expect(
      readReason(
        await edited((f) => ({ "stray.txt": new Uint8Array(1), ...f }))
      )
    ).toBe("unlisted-file");
    expect(
      readReason(
        await edited(({ "metadata.json": m, ...rest }) => ({
          "metadata.json": m!,
          ...rest,
        }))
      )
    ).toBe("metadata-not-last");
  });
});

describe("a PCM clip whose bytes disagree with its frame count", () => {
  it.each([
    ["short", PCM_1.subarray(0, PCM_1.length - 2)],
    ["long", concat([PCM_1, new Uint8Array(2)])],
  ])("rejects the export when the source is %s", async (_label, bytes) => {
    const source = chunked(
      clip("clip-2", "pcm", PCM_1.length),
      bytes as Uint8Array<ArrayBuffer>,
      1000
    );
    const input = bookOf([chapter("ch-a", 1, [seg("ch-a", 1, source)])]);
    await expect(
      writeBundleZip(input, memoryArchiveSink())
    ).rejects.toBeInstanceOf(PcmLengthMismatchError);
  });
});

describe("memory stays bounded while a large segment streams (#1587)", () => {
  // A 16 MiB segment in 64 KiB pieces: about a 26-minute PCM take, longer
  // than the 20-minute cap allows, scaled to run in a second.
  const PIECE = 64 * 1024;
  const PIECES = 256;
  // Local header and data descriptor, each carrying the entry name: generous.
  const ENTRY_OVERHEAD = 256;

  it("hands the sink each piece itself, and nothing is outstanding when the next piece is read", async () => {
    let held = 0;
    let peak = 0;
    const handed = new Set<Uint8Array>();
    // The slowest sink the ArchiveSink contract allows (the same lazy thenable
    // as tests/book-export-stream.test.ts): a write lands only when awaited.
    const sink: ArchiveSink = {
      write(chunk) {
        handed.add(chunk);
        held += chunk.length;
        peak = Math.max(peak, held);
        let landed = false;
        return {
          then(resolve: (v: void) => void) {
            if (!landed) held -= chunk.length;
            landed = true;
            resolve();
          },
        } as unknown as Promise<void>;
      },
    };
    const yielded: Uint8Array[] = [];
    const heldAtRead: number[] = [];
    const meta = clip("clip-big", "mp3", PIECE * PIECES);
    const source: BundleAudioSource = {
      clip: meta,
      async *read() {
        for (let i = 0; i < PIECES; i++) {
          heldAtRead.push(held);
          const piece = new Uint8Array(PIECE).fill(i % 251);
          yielded.push(piece);
          yield piece;
        }
      },
    };
    const input = bookOf([chapter("ch-a", 1, [seg("ch-a", 1, source)])]);

    expect(await writeBundleZip(input, sink)).toEqual({ audio: 1, missing: 0 });

    expect(heldAtRead).toHaveLength(PIECES);
    expect(Math.max(...heldAtRead)).toBe(0);
    // No whole-buffer copy, and no per-piece copy either: every piece reached
    // the sink as the very object the source yielded.
    expect(yielded.every((piece) => handed.has(piece))).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(PIECE);
    expect(peak).toBeLessThan(PIECE + ENTRY_OVERHEAD);
    expect(held).toBe(0);
  });
});
