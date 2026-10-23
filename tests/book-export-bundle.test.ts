import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildBookBundle } from "@/hooks/use-book-export";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import { WAV_HEADER_BYTES } from "@/lib/audio/wav";
import { gatherBundleInput } from "@/lib/export/bundle/gather";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { getClip, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import { saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { BookId, SegmentId } from "@/types/domain";

import { fakeOpfs } from "./fake-opfs";
import { clearAllStores } from "./support";
import { readBundle } from "./support/scripture-bundle-reader";
import { NO_STAGES_RUN } from "@/lib/audio/loudness";

/**
 * Gathering a book from storage into the Scripture Bundle zip (#1457, ADR
 * 0014), through fake-indexeddb and the real writer, read back by the
 * test-side reader. The OPFS spool is the in-memory one unless a case stubs a
 * fake. Not covered, and not run on a phone: a real OPFS, the share sheet, and
 * another app decoding the zip.
 */

const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

const PARAMS = {
  bookName: "Mark",
  appVersion: "2.0.0",
  defaultLocale: "en",
  exportedAt: Date.parse("2026-11-20T10:00:00.000Z"),
  filename: "Mark.zip",
};

beforeEach(async () => {
  reportFailure.mockClear();
  await clearAllStores();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function pcm(frames: number, value: number): Int16Array {
  return new Int16Array(frames).fill(value);
}

async function record(segmentId: SegmentId, frames: number, value: number) {
  const clipId = newClipId();
  await saveTake(segmentId, clipId, pcm(frames, value), CANONICAL_SAMPLE_RATE);
  return clipId;
}

async function finish(segmentId: SegmentId): Promise<Uint8Array> {
  const audio = await resolveSegmentAudio(segmentId);
  if (audio.kind !== "resolved") throw new Error("expected a recording");
  const clip = await getClip(audio.clip.id);
  if (clip?.encoding !== "pcm") throw new Error("expected PCM");
  await setSegmentFinished(segmentId, true);
  const mp3 = encodeMp3(clip.samples);
  const outcome = await commitTranscode(
    segmentId,
    audio.clip.id,
    mp3,
    computePeaks(clip.samples, 4),
    NO_STAGES_RUN
  );
  expect(outcome).toBe("committed");
  return mp3;
}

interface Fixture {
  readonly bookId: BookId;
  readonly finished: SegmentId;
  readonly draft: SegmentId;
  readonly empty: SegmentId;
  readonly gone: SegmentId;
  readonly mp3: Uint8Array;
}

/** Chapter 1: Finished (MP3), unfinished (PCM), never recorded. Chapter 2: clip gone. */
async function fixture(): Promise<Fixture> {
  const book = await createBook("Mark");
  const c1 = await addChapter(book.id);
  const finished = (await addSegment(c1.id)).id;
  const draft = (await addSegment(c1.id)).id;
  const empty = (await addSegment(c1.id)).id;
  const c2 = await addChapter(book.id);
  const gone = (await addSegment(c2.id)).id;
  await record(finished, 2000, 700);
  await record(draft, 1500, -300);
  const goneClip = await record(gone, 800, 5);
  const mp3 = await finish(finished);
  const db = await getDb();
  await db.delete("clipMeta", goneClip);
  await db.delete("clipData", goneClip);
  return { bookId: book.id, finished, draft, empty, gone, mp3 };
}

describe("gatherBundleInput maps each segment to its audio source (#1457)", () => {
  it("gives Finished its MP3 and unfinished its PCM with the clip's own metadata, and no source otherwise", async () => {
    const f = await fixture();
    const input = await gatherBundleInput(f.bookId, PARAMS);
    const segs = input!.chapters.flatMap((c) => c.segments);
    expect(segs.map((s) => s.segment.id)).toEqual([
      f.finished,
      f.draft,
      f.empty,
      f.gone,
    ]);
    expect(segs.map((s) => s.source?.clip.encoding ?? null)).toEqual([
      "mp3",
      "pcm",
      null,
      null,
    ]);
    // never recorded: no take; clip gone: the take is kept so the reason reads
    // "audio-missing"
    expect(segs[2]!.take).toBeNull();
    expect(segs[3]!.take).not.toBeNull();
  });

  it("is null for a book that is not there", async () => {
    expect(await gatherBundleInput("nope" as BookId, PARAMS)).toBeNull();
  });
});

describe("buildBookBundle zips a stored book (#1457)", () => {
  it("writes the stored MP3 as is and the PCM behind a WAV header, and reads back", async () => {
    const f = await fixture();
    const out = await buildBookBundle(f.bookId, PARAMS);
    if (out.kind !== "ready") throw new Error(`got ${out.kind}`);
    expect([out.audio, out.missing]).toEqual([2, 2]);
    expect(out.file.name).toBe("Mark.zip");

    const { files } = readBundle(new Uint8Array(await out.file.arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      "ingredients/audio/c001/s001.mp3",
      "ingredients/audio/c001/s002.wav",
      "ingredients/tc-mobile/project.json",
      "metadata.json",
    ]);
    expect(files["ingredients/audio/c001/s001.mp3"]).toEqual(f.mp3);
    const wav = files["ingredients/audio/c001/s002.wav"]!;
    expect(wav.length).toBe(WAV_HEADER_BYTES + 1500 * 2);
    expect(new Int16Array(wav.slice(WAV_HEADER_BYTES).buffer)).toEqual(
      pcm(1500, -300)
    );
    await out.release();
  });

  it("does not change any clip: generation, encoding and bytes are as before", async () => {
    const f = await fixture();
    const db = await getDb();
    const before = {
      meta: await db.getAll("clipMeta"),
      data: await db.getAll("clipData"),
    };
    const out = await buildBookBundle(f.bookId, PARAMS);
    expect(out.kind).toBe("ready");
    expect(await db.getAll("clipMeta")).toEqual(before.meta);
    expect(await db.getAll("clipData")).toEqual(before.data);
    if (out.kind === "ready") await out.release();
  });

  it("is empty for a book with no recorded audio, and for a missing book", async () => {
    const opfs = fakeOpfs();
    vi.stubGlobal("navigator", { storage: { getDirectory: opfs.source } });
    const book = await createBook("Empty");
    const chapter = await addChapter(book.id);
    await addSegment(chapter.id);
    expect((await buildBookBundle(book.id, PARAMS)).kind).toBe("empty");
    expect(opfs.files()).toEqual([]);
    expect((await buildBookBundle("nope" as BookId, PARAMS)).kind).toBe(
      "empty"
    );
  });

  it("is cancelled, and releases its spool, when shouldContinue says stop", async () => {
    const opfs = fakeOpfs();
    vi.stubGlobal("navigator", { storage: { getDirectory: opfs.source } });
    const f = await fixture();
    let calls = 0;
    const out = await buildBookBundle(f.bookId, PARAMS, () => ++calls < 3);
    expect(out.kind).toBe("cancelled");
    expect(opfs.files()).toEqual([]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("keeps the spool until the caller releases a ready File", async () => {
    const opfs = fakeOpfs();
    vi.stubGlobal("navigator", { storage: { getDirectory: opfs.source } });
    const f = await fixture();
    const out = await buildBookBundle(f.bookId, PARAMS);
    if (out.kind !== "ready") throw new Error(`got ${out.kind}`);
    expect(opfs.files()).toHaveLength(1);
    await out.release();
    expect(opfs.files()).toEqual([]);
  });

  it("reports a failed spool write as book-export-bundle, returns failed and releases the spool", async () => {
    const opfs = fakeOpfs({ failWriteAt: 2 });
    vi.stubGlobal("navigator", { storage: { getDirectory: opfs.source } });
    const f = await fixture();
    const out = await buildBookBundle(f.bookId, PARAMS);
    expect(out.kind).toBe("failed");
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]![1]).toBe("book-export-bundle");
    expect(opfs.files()).toEqual([]);
  });

  it("stops with BundleClipChangedError when a clip vanishes between gather and read", async () => {
    const f = await fixture();
    const input = await gatherBundleInput(f.bookId, PARAMS);
    const source = input!.chapters[0]!.segments[1]!.source!;
    const db = await getDb();
    await db.delete("clipData", source.clip.id);
    await db.delete("clipMeta", source.clip.id);
    const read = async () => {
      for await (const piece of source.read()) void piece;
    };
    await expect(read()).rejects.toMatchObject({
      name: "BundleClipChangedError",
    });
  });
});
