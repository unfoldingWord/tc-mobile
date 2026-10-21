import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { encodeMp3 } from "@/lib/audio/mp3";
import { parseJoinableMp3 } from "@/lib/audio/mp3-join";
import { computePeaks } from "@/lib/audio/peaks";
import { exportBookZip, memoryArchiveSink } from "@/lib/export/book";
import { exportChapterMp3 } from "@/lib/export/chapter";
import { chapterFileParts, chapterId3Fields } from "@/lib/export/chapter-tag";
import {
  addChapter,
  addSegment,
  createBook,
  renameBook,
  renameChapter,
  resolveBookChapters,
} from "@/lib/storage/books";
import { getClip, newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { resolveSegmentAudio } from "@/lib/storage/segment-audio";
import { saveTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type { BookId, ChapterId, ClipId } from "@/types/domain";
import { audioAfterId3v2, clearAllStores, testCodec } from "./support";

beforeEach(clearAllStores);

const ATTRIBUTION = "Open Bible Stories, unfoldingWord, CC BY-SA 4.0";

/** One file from its parts, the way `new File(parts)` sees it. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Every frame id of the file's leading tag, in order. */
function frameIds(file: Uint8Array): string[] {
  const end = 10 + ((file[8]! << 7) | file[9]!); // small tags only
  const ids: string[] = [];
  for (let at = 10; at < end;) {
    ids.push(String.fromCharCode(...file.subarray(at, at + 4)));
    const size = new DataView(file.buffer, file.byteOffset + at + 4, 4);
    at += 10 + size.getUint32(0);
  }
  return ids;
}

/** A book of one chapter per entry, each one segment of `n` frames. */
async function bookOf(
  lengths: readonly number[]
): Promise<{ bookId: BookId; chapterIds: ChapterId[]; clipIds: ClipId[] }> {
  const book = await createBook("Mark");
  const chapterIds: ChapterId[] = [];
  const clipIds: ClipId[] = [];
  for (const [i, n] of lengths.entries()) {
    const chapter = await addChapter(book.id);
    chapterIds.push(chapter.id);
    const seg = await addSegment(chapter.id);
    const clipId = newClipId();
    clipIds.push(clipId);
    await saveTake(
      seg.id,
      clipId,
      Int16Array.from({ length: n }, () => 1000 * (i + 1)),
      CANONICAL_SAMPLE_RATE
    );
  }
  return { bookId: book.id, chapterIds, clipIds };
}

/** Mark every recorded segment of `bookId` Finished and land its transcode. */
async function finishAll(bookId: BookId): Promise<void> {
  for (const chapter of (await resolveBookChapters(bookId)).chapters) {
    for (const segmentId of chapter.segmentIds) {
      const audio = await resolveSegmentAudio(segmentId);
      if (audio.kind !== "resolved") continue;
      const clip = await getClip(audio.clip.id);
      if (clip?.encoding !== "pcm") throw new Error("expected a PCM clip");
      await setSegmentFinished(segmentId, true);
      await commitTranscode(
        segmentId,
        audio.clip.id,
        encodeMp3(clip.samples),
        computePeaks(clip.samples, 4)
      );
    }
  }
}

/** Stamp `bookId` as made from a template, as the template writer does. */
async function makeTemplateBook(bookId: BookId): Promise<void> {
  const db = await getDb();
  const book = await db.get("books", bookId);
  await db.put("books", {
    ...book!,
    provenance: {
      kind: "template",
      template: { id: "obs", version: "1.0.0", kind: "collection" },
      attribution: ATTRIBUTION,
    },
    licence: "CC-BY-SA-4.0",
  });
}

describe("chapterId3Fields (#252)", () => {
  const blank = { name: "Mark", provenance: { kind: "blank" } } as const;

  it("names the chapter and book, numbers the track, and attributes nothing for a blank book", () => {
    expect(chapterId3Fields(blank, { name: "Mark 6", number: 6 })).toEqual({
      title: "Mark 6",
      album: "Mark",
      track: 6,
      copyright: null,
      comment: null,
    });
  });

  it("writes no placeholder for an unnamed chapter or book (#169)", () => {
    const fields = chapterId3Fields(
      { ...blank, name: null },
      { name: null, number: 2 }
    );
    expect([fields.title, fields.album, fields.track]).toEqual([null, null, 2]);
  });

  it("carries a template book's attribution as the comment", () => {
    const template = {
      name: "OBS",
      provenance: {
        kind: "template",
        template: { id: "obs", version: "1.0.0", kind: "collection" },
        attribution: ATTRIBUTION,
      },
    } as const;
    expect(chapterId3Fields(template, { name: null, number: 1 }).comment).toBe(
      ATTRIBUTION
    );
  });
});

describe("a shared chapter carries exactly one tag (#252)", () => {
  it("a joined (all-Finished) chapter: one tag, then the joined MP3 unchanged", async () => {
    const { bookId, chapterIds } = await bookOf([20_000]);
    await finishAll(bookId);
    await renameChapter(chapterIds[0]!, "Mark 1");
    const codec = testCodec();
    const result = await exportChapterMp3(chapterIds[0]!, codec);
    expect(codec.encodeMp3).not.toHaveBeenCalled(); // it was joined

    const file = joined(await chapterFileParts(chapterIds[0]!, result!.mp3));
    expect(frameIds(file)).toEqual(["TIT2", "TALB", "TRCK"]);
    // audioAfterId3v2 throws on a second tag behind the first.
    expect(audioAfterId3v2(file)).toEqual(result!.mp3);
    // A decoder that skips the tag finds the same frames the join wrote.
    expect(parseJoinableMp3(file)!.bytes).toEqual(
      parseJoinableMp3(result!.mp3)!.bytes
    );
  });

  it("an encoded chapter takes the same one tag", async () => {
    const { chapterIds } = await bookOf([4_410]);
    const result = await exportChapterMp3(chapterIds[0]!, testCodec());
    const file = joined(await chapterFileParts(chapterIds[0]!, result!.mp3));
    expect(frameIds(file)).toEqual(["TALB", "TRCK"]);
    expect(audioAfterId3v2(file)).toEqual(result!.mp3);
  });

  it("every Share Book entry is tagged once, with the template attribution", async () => {
    const { bookId } = await bookOf([4_410, 4_410]);
    await finishAll(bookId);
    await makeTemplateBook(bookId);
    await renameBook(bookId, "Stories");
    const sink = memoryArchiveSink();
    await exportBookZip(bookId, (n) => `${n}.mp3`, testCodec(), sink);
    const entries = unzipSync(joined(sink.chunks));
    expect(Object.keys(entries)).toEqual(["1.mp3", "2.mp3"]);
    for (const entry of Object.values(entries)) {
      expect(frameIds(entry)).toEqual(["TALB", "TRCK", "COMM"]);
      expect(parseJoinableMp3(audioAfterId3v2(entry))).not.toBeNull();
    }
  });

  it("leaves every stored clip byte for byte as it was", async () => {
    const { bookId, clipIds } = await bookOf([4_410, 9_000]);
    await finishAll(bookId);
    const before = await Promise.all(clipIds.map((id) => getClip(id)));
    await exportBookZip(
      bookId,
      (n) => `${n}.mp3`,
      testCodec(),
      memoryArchiveSink()
    );
    for (const [i, id] of clipIds.entries()) {
      const after = await getClip(id);
      expect(after).toEqual(before[i]);
      if (after?.encoding !== "mp3") throw new Error("expected an MP3 clip");
      expect([...after.mp3.subarray(0, 3)]).not.toEqual([0x49, 0x44, 0x33]);
    }
  });

  it("shares the MP3 alone when its chapter is gone", async () => {
    const mp3 = encodeMp3(new Int16Array(4_410));
    expect(await chapterFileParts("gone" as ChapterId, mp3)).toEqual([mp3]);
  });
});
