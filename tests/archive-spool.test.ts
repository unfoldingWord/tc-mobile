import "fake-indexeddb/auto";

import { Zip, ZipPassThrough } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openArchiveSpool, spoolArchive } from "@/hooks/archive-spool";
import { reportFailure } from "@/hooks/report-failure";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { exportBookZip } from "@/lib/export/book";
import { exportChapterMp3 } from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  resolveBookChapters,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { BookId } from "@/types/domain";
import { fakeOpfs } from "./fake-opfs";
import { clearAllStores, testCodec } from "./support";

/**
 * The browser half of #1003: the spool Share Book's zip streams into. OPFS is
 * a fake here (`tests/fake-opfs.ts`) — Node has none — so these cases pin the
 * spool's own rules (order, finish, release, fallback), not any browser's
 * OPFS. Nothing here ran in a browser or on a phone.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

const bytes = async (file: File) => new Uint8Array(await file.arrayBuffer());
const chunk = (...values: number[]) => Uint8Array.from(values);

beforeEach(() => {
  vi.mocked(reportFailure).mockClear();
});

describe("openArchiveSpool on OPFS", () => {
  it("writes chunks in call order even when a later write lands first, and finishes to one named File", async () => {
    // The data chunk is slow and the chunk after it is fast: an unqueued disk
    // would land them the wrong way round.
    const opfs = fakeOpfs({ latency: (n) => (n > 2 ? 5 : 0) });
    const spool = await openArchiveSpool(opfs.source);
    const writes = [
      spool.sink.write(chunk(1)),
      spool.sink.write(chunk(2, 2, 2)),
      spool.sink.write(chunk(3)),
    ];
    await Promise.all(writes);
    const file = await spool.finish("Book.zip", "application/zip");

    expect(await bytes(file)).toEqual(chunk(1, 2, 2, 2, 3));
    expect(file.name).toBe("Book.zip");
    expect(file.type).toBe("application/zip");
    expect(opfs.maxConcurrentWrites()).toBe(1);
    // The archive is on the fake disk until the share lets it go.
    expect(opfs.files()).toHaveLength(1);
    await spool.release();
    expect(opfs.files()).toEqual([]);
  });

  it("release is idempotent and aborts an unfinished write", async () => {
    const opfs = fakeOpfs();
    const spool = await openArchiveSpool(opfs.source);
    await spool.sink.write(chunk(1));
    await Promise.all([spool.release(), spool.release()]);
    expect(opfs.aborted()).toBe(1);
    expect(opfs.files()).toEqual([]);
    // Released: nothing more goes in, and it cannot be finished.
    await expect(spool.sink.write(chunk(2))).rejects.toThrow(/released/);
    await expect(spool.finish("b.zip", "application/zip")).rejects.toThrow(
      /released/
    );
  });

  it("a failed write poisons the spool: later writes and finish reject, and release still removes the file", async () => {
    const opfs = fakeOpfs({ failWriteAt: 1 });
    const spool = await openArchiveSpool(opfs.source);
    const first = spool.sink.write(chunk(1));
    const second = spool.sink.write(chunk(2));
    await expect(first).rejects.toMatchObject({ name: "QuotaExceededError" });
    await expect(second).rejects.toMatchObject({ name: "QuotaExceededError" });
    await expect(
      spool.finish("b.zip", "application/zip")
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    await spool.release();
    expect(opfs.files()).toEqual([]);
  });

  it("a delete that fails is reported, not thrown", async () => {
    const denied = new DOMException("denied", "NoModificationAllowedError");
    const opfs = fakeOpfs({ removeError: denied });
    const spool = await openArchiveSpool(opfs.source);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(spool.release()).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledWith(denied, "share-spool-release");
    error.mockRestore();
  });

  it("a file already gone is not a failure", async () => {
    const opfs = fakeOpfs();
    const spool = await openArchiveSpool(opfs.source);
    // Removed behind the spool's back (site data cleared, say).
    const [name] = opfs.files();
    const dir = await (
      await opfs.source()
    ).getDirectoryHandle("tc-mobile-share-spool", { create: false });
    await dir.removeEntry(name!);
    await spool.release();
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe("openArchiveSpool falls back to memory", () => {
  const cases: Array<[string, () => ReturnType<typeof fakeOpfs> | null]> = [
    ["no OPFS at all", () => null],
    [
      "a file handle with no createWritable",
      () => fakeOpfs({ noCreateWritable: true }),
    ],
    [
      "a createWritable that rejects",
      () =>
        fakeOpfs({
          createWritableError: new DOMException("no", "NotAllowedError"),
        }),
    ],
  ];
  for (const [label, make] of cases) {
    it(`on ${label}, with the same bytes and no file left behind`, async () => {
      const opfs = make();
      const spool = await openArchiveSpool(
        opfs ? opfs.source : () => undefined
      );
      await spool.sink.write(chunk(7, 8));
      await spool.sink.write(chunk(9));
      const file = await spool.finish("b.zip", "application/zip");
      expect(await bytes(file)).toEqual(chunk(7, 8, 9));
      expect(file.name).toBe("b.zip");
      if (opfs) expect(opfs.files()).toEqual([]);
      await spool.release();
      expect(reportFailure).not.toHaveBeenCalled();
    });
  }

  it("on a getDirectory that refuses", async () => {
    const spool = await openArchiveSpool(() =>
      Promise.reject(new DOMException("private window", "SecurityError"))
    );
    await spool.sink.write(chunk(1));
    expect(await bytes(await spool.finish("b.zip", "application/zip"))).toEqual(
      chunk(1)
    );
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("the memory spool refuses writes after release", async () => {
    const spool = await openArchiveSpool(() => undefined);
    await spool.release();
    await expect(spool.sink.write(chunk(1))).rejects.toThrow(/released/);
  });
});

describe("spoolArchive: who releases the spool", () => {
  it("the caller, through `release`, once the build returns a result", async () => {
    const opfs = fakeOpfs();
    const spooled = await spoolArchive(
      async (sink) => {
        await sink.write(chunk(1, 2));
        return "built";
      },
      "b.zip",
      "application/zip",
      opfs.source
    );
    expect(spooled?.result).toBe("built");
    expect(await bytes(spooled!.file)).toEqual(chunk(1, 2));
    expect(opfs.files()).toHaveLength(1);
    await spooled!.release();
    expect(opfs.files()).toEqual([]);
  });

  it("spoolArchive itself, when the build returns null (nothing, or cancelled)", async () => {
    const opfs = fakeOpfs();
    const spooled = await spoolArchive(
      async (sink) => {
        await sink.write(chunk(1));
        return null;
      },
      "b.zip",
      "application/zip",
      opfs.source
    );
    expect(spooled).toBeNull();
    expect(opfs.files()).toEqual([]);
  });

  it("spoolArchive itself, when the build throws — and the throw still reaches the caller", async () => {
    const opfs = fakeOpfs();
    const boom = new Error("encode failed");
    await expect(
      spoolArchive(
        async (sink) => {
          await sink.write(chunk(1));
          throw boom;
        },
        "b.zip",
        "application/zip",
        opfs.source
      )
    ).rejects.toBe(boom);
    expect(opfs.files()).toEqual([]);
  });

  it("spoolArchive itself, when finishing fails", async () => {
    // The build swallows its write's rejection; finish is what surfaces it.
    const opfs = fakeOpfs({ failWriteAt: 1 });
    await expect(
      spoolArchive(
        async (sink) => {
          await sink.write(chunk(1)).catch(() => undefined);
          return "built";
        },
        "b.zip",
        "application/zip",
        opfs.source
      )
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(opfs.files()).toEqual([]);
  });
});

describe("Share Book through the spool is the old archive, byte for byte (#1003)", () => {
  beforeEach(async () => {
    await clearAllStores();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function bookOf(chapters: number): Promise<BookId> {
    const book = await createBook("b");
    for (let i = 1; i <= chapters; i++) {
      const chapter = await addChapter(book.id);
      const seg = await addSegment(chapter.id);
      await saveTake(
        seg.id,
        newClipId(),
        new Int16Array(CANONICAL_SAMPLE_RATE / 4).fill(i * 100),
        CANONICAL_SAMPLE_RATE
      );
    }
    return book.id;
  }

  const nameChapter = (n: number) => `Chapter ${n}.mp3`;

  /** The pre-#1003 archive: every chunk collected, in order, synchronously. */
  async function oldPath(bookId: BookId): Promise<Uint8Array> {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    const zip = new Zip((err, data) => {
      if (err) throw err;
      parts.push(data);
    });
    for (const chapter of (await resolveBookChapters(bookId)).chapters) {
      const result = await exportChapterMp3(chapter.id, testCodec());
      if (result === null) continue;
      const entry = new ZipPassThrough(nameChapter(chapter.number));
      zip.add(entry);
      entry.push(result.mp3, true);
    }
    zip.end();
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  }

  for (const [label, source] of [
    [
      "an OPFS spool with a slow disk",
      () => fakeOpfs({ latency: (n) => (n > 64 ? 3 : 0) }),
    ],
    ["the memory fallback", () => null],
  ] as const) {
    it(`via ${label}`, async () => {
      const bookId = await bookOf(3);
      const expected = await oldPath(bookId);
      const opfs = source();
      const spooled = await spoolArchive(
        (sink) => exportBookZip(bookId, nameChapter, testCodec(), sink),
        "b.zip",
        "application/zip",
        opfs ? opfs.source : () => undefined
      );
      expect(spooled?.result.chapters).toBe(3);
      expect(await bytes(spooled!.file)).toEqual(expected);
      await spooled!.release();
      if (opfs) expect(opfs.files()).toEqual([]);
    });
  }
});
