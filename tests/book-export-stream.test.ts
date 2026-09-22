import "fake-indexeddb/auto";

import { Zip, ZipPassThrough, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  type ArchiveSink,
  exportBookZip,
  exportLibraryZip,
  memoryArchiveSink,
} from "@/lib/export/book";
import { exportChapterMp3 } from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  resolveBookChapters,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import type { BookId } from "@/types/domain";
import { clearAllStores, testCodec } from "./support";

/**
 * Share Book's archive leaves the export as it is produced (#1003). These
 * cases pin the two halves of that: what the export holds at its peak, as a
 * byte count, and that the bytes it writes are the bytes the old
 * collect-every-chunk path produced, in the same order.
 *
 * "Held" here is counted, not measured from the heap: a sink below counts the
 * bytes it has been handed and not yet been waited for. That is the part of
 * the peak this change moves. A chapter's PCM and its encode are not counted,
 * and nothing here ran on a phone (#1002 is that check).
 */

const nameChapter = (n: number): string => `Chapter ${n}.mp3`;

function concat(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function bookOf(chapters: number, name = "b"): Promise<BookId> {
  const book = await createBook(name);
  for (let i = 1; i <= chapters; i++) {
    const chapter = await addChapter(book.id);
    const seg = await addSegment(chapter.id);
    await saveTake(
      seg.id,
      newClipId(),
      new Int16Array(100).fill(i),
      CANONICAL_SAMPLE_RATE
    );
  }
  return book.id;
}

/**
 * A codec that encodes nothing: chapter `n` (1-based, in encode order) comes
 * back as `sizeOf(n)` bytes. Enough for the archive's shape, and cheap enough
 * for a Psalms-sized book in Node.
 */
function sizedCodec(sizeOf: (n: number) => number): AudioCodec & {
  readonly onEncode: (hook: () => void) => void;
} {
  let n = 0;
  let hook: () => void = () => undefined;
  return {
    onEncode: (h) => {
      hook = h;
    },
    encodeMp3: async () => {
      hook();
      n++;
      return new Uint8Array(sizeOf(n)).fill(n % 251);
    },
    decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
  };
}

/**
 * The slowest sink the {@link ArchiveSink} contract allows: a write makes no
 * progress until the export waits on it. So `held` is exactly what the export
 * has handed over without waiting — the bytes a real sink would still be
 * holding if the disk were slower than the export. Bytes are copied out for
 * a digest-free comparison only when `keep` is set.
 */
function lazySink(keep = false) {
  let held = 0;
  let peak = 0;
  let written = 0;
  const chunks: Uint8Array[] = [];
  const sink: ArchiveSink = {
    write(chunk) {
      held += chunk.length;
      peak = Math.max(peak, held);
      let done = false;
      const land = () => {
        if (done) return;
        done = true;
        held -= chunk.length;
        written += chunk.length;
        if (keep) chunks.push(chunk.slice());
      };
      // A thenable, not a Promise: its body runs only when someone awaits it.
      const lazy = {
        then(resolve: (v: void) => void, reject: (e: unknown) => void) {
          try {
            land();
            resolve();
          } catch (cause) {
            reject(cause);
          }
        },
      };
      return lazy as unknown as Promise<void>;
    },
  };
  return {
    sink,
    held: () => held,
    peak: () => peak,
    written: () => written,
    bytes: () => concat(chunks),
  };
}

beforeEach(clearAllStores);
afterEach(() => {
  vi.useRealTimers();
});

describe("what Share Book holds while it builds (#1003)", () => {
  // A Psalms-shaped book: 150 chapters, one of them (the 119th) much longer
  // than the rest. Sizes are scaled down so the case runs in seconds.
  const CHAPTERS = 150;
  const LONG = 119;
  const SHORT_BYTES = 256 * 1024;
  const LONG_BYTES = 8 * 1024 * 1024;
  const sizeOf = (n: number) => (n === LONG ? LONG_BYTES : SHORT_BYTES);
  const MP3_BYTES = (CHAPTERS - 1) * SHORT_BYTES + LONG_BYTES;
  // Local header, data descriptor and central-directory record per entry,
  // each carrying the entry name: generous, like the estimate's allowance.
  const ENTRY_OVERHEAD = 256;

  it("before: the collect-every-chunk sink holds the whole archive when the export returns", async () => {
    const bookId = await bookOf(CHAPTERS);
    const sink = memoryArchiveSink();
    const result = await exportBookZip(
      bookId,
      nameChapter,
      sizedCodec(sizeOf),
      sink
    );
    expect(result?.chapters).toBe(CHAPTERS);
    const held = sink.chunks.reduce((n, c) => n + c.length, 0);
    expect(held).toBeGreaterThan(MP3_BYTES);
    expect(held).toBeLessThan(MP3_BYTES + CHAPTERS * ENTRY_OVERHEAD);
  }, 60_000);

  it("after: a streaming sink is never handed more than the longest chapter's entry before the export waits on it", async () => {
    const bookId = await bookOf(CHAPTERS);
    const lazy = lazySink();
    const codec = sizedCodec(sizeOf);
    // Nothing from an earlier chapter may still be outstanding when the next
    // chapter's encode starts.
    const heldAtEncode: number[] = [];
    codec.onEncode(() => heldAtEncode.push(lazy.held()));
    const result = await exportBookZip(bookId, nameChapter, codec, lazy.sink);

    expect(result?.chapters).toBe(CHAPTERS);
    expect(heldAtEncode).toHaveLength(CHAPTERS);
    expect(Math.max(...heldAtEncode)).toBe(0);
    // Everything was written, and nothing is left outstanding.
    expect(lazy.written()).toBeGreaterThan(MP3_BYTES);
    expect(lazy.held()).toBe(0);
    // The peak is one entry: the long chapter's MP3 plus its own headers, and
    // at least that — this is a count, not a bound that holds by accident.
    expect(lazy.peak()).toBeGreaterThanOrEqual(LONG_BYTES);
    expect(lazy.peak()).toBeLessThan(LONG_BYTES + ENTRY_OVERHEAD);
    expect(lazy.peak()).toBeLessThan(lazy.written() / 5);
  }, 60_000);

  it("Share your work streams the same way: nothing outstanding at any chapter's encode", async () => {
    await bookOf(3, "A");
    await bookOf(2, "B");
    const lazy = lazySink();
    const codec = sizedCodec(() => SHORT_BYTES);
    const heldAtEncode: number[] = [];
    codec.onEncode(() => heldAtEncode.push(lazy.held()));
    const result = await exportLibraryZip(
      (book) => book.name ?? "",
      (_book, n) => nameChapter(n),
      codec,
      lazy.sink
    );
    expect(result?.books).toBe(2);
    expect(heldAtEncode).toEqual([0, 0, 0, 0, 0]);
    expect(lazy.peak()).toBeLessThan(SHORT_BYTES + ENTRY_OVERHEAD);
    expect(lazy.held()).toBe(0);
  });
});

/**
 * The archive the export built before #1003, rebuilt here from the same
 * chapter MP3s: fflate's streaming `Zip`, one stored pass-through entry per
 * chapter in book order, every chunk collected synchronously. Byte identity
 * against this is what "the same zip" means below.
 */
async function oldPathArchive(
  bookId: BookId,
  codec: AudioCodec
): Promise<Uint8Array> {
  const { chapters } = await resolveBookChapters(bookId);
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    chunks.push(chunk);
  });
  for (const chapter of chapters) {
    const result = await exportChapterMp3(chapter.id, codec);
    if (result === null) continue;
    const entry = new ZipPassThrough(nameChapter(chapter.number));
    zip.add(entry);
    entry.push(result.mp3, true);
  }
  zip.end();
  return concat(chunks);
}

describe("the streamed archive is the same archive (#1003)", () => {
  beforeEach(() => {
    // Entry headers carry a DOS timestamp from `Date.now()`; pin it, so two
    // builds of one book are comparable byte for byte.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  });

  it("is byte-identical to the old path, through the memory sink and through a streaming one", async () => {
    const bookId = await bookOf(3);
    const expected = await oldPathArchive(bookId, testCodec());

    const memory = memoryArchiveSink();
    await exportBookZip(bookId, nameChapter, testCodec(), memory);
    expect(concat(memory.chunks)).toEqual(expected);

    const lazy = lazySink(true);
    await exportBookZip(bookId, nameChapter, testCodec(), lazy.sink);
    expect(lazy.bytes()).toEqual(expected);

    // And it is a zip of those entries, in book order.
    expect(Object.keys(unzipSync(lazy.bytes()))).toEqual([
      "Chapter 1.mp3",
      "Chapter 2.mp3",
      "Chapter 3.mp3",
    ]);
  });
});

describe("a failing sink fails the export (#1003)", () => {
  it("a write that rejects rejects the export, and no later chapter is encoded", async () => {
    const bookId = await bookOf(3);
    const codec = testCodec();
    const full = new DOMException("disk full", "QuotaExceededError");
    let writes = 0;
    const sink: ArchiveSink = {
      write: () => (++writes === 2 ? Promise.reject(full) : Promise.resolve()),
    };
    await expect(exportBookZip(bookId, nameChapter, codec, sink)).rejects.toBe(
      full
    );
    // The first chapter's entry is where the write failed.
    expect(codec.encodeMp3).toHaveBeenCalledTimes(1);
  });

  it("a write that throws instead of rejecting still rejects the export", async () => {
    const bookId = await bookOf(2);
    const boom = new Error("sync throw");
    const sink: ArchiveSink = {
      write: () => {
        throw boom;
      },
    };
    await expect(
      exportBookZip(bookId, nameChapter, testCodec(), sink)
    ).rejects.toBe(boom);
  });

  it("a cancel that lands while a chapter's bytes are being written stops before that chapter's step", async () => {
    const bookId = await bookOf(2);
    let live = true;
    const sink: ArchiveSink = {
      write: async () => {
        live = false;
      },
    };
    const onStep = vi.fn();
    const result = await exportBookZip(
      bookId,
      nameChapter,
      testCodec(),
      sink,
      () => live,
      onStep
    );
    expect(result).toBeNull();
    // Only the opening (0, total) report: the written chapter is not counted.
    expect(onStep.mock.calls.map(([done]) => done)).toEqual([0]);
  });
});
