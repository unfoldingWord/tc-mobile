import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildBookBundle } from "@/hooks/use-book-export";
import { performSetBookLanguage } from "@/hooks/use-language-ask";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  addChapter,
  addSegment,
  createBook,
  getBook,
} from "@/lib/storage/books";
import * as booksStore from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { BookId } from "@/types/domain";

import { clearAllStores } from "./support";
import { readBundle } from "./support/scripture-bundle-reader";

/**
 * The language ask's write (#1492) and what it means for the export: the
 * tag the ask stores is the tag `metadata.json` carries, through the bundle
 * builder that already reads `Book.languageCode` (ADR 0014). Not covered here:
 * the sheet itself (e2e/export-language-ask.spec.ts) and any phone.
 */

const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return { ...actual, setBookLanguageOnce: vi.fn(actual.setBookLanguageOnce) };
});

const PARAMS = {
  bookName: "Mark",
  appVersion: "2.0.0",
  defaultLocale: "en",
  exportedAt: Date.parse("2026-11-20T10:00:00.000Z"),
  filename: "Mark - project.zip",
};

beforeEach(async () => {
  reportFailure.mockClear();
  vi.mocked(booksStore.setBookLanguageOnce).mockClear();
  await clearAllStores();
});

async function recordedBook(languageCode: string | null): Promise<BookId> {
  const book = await createBook("Mark", languageCode);
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  await saveTake(
    segment.id,
    newClipId(),
    new Int16Array(4800).fill(100),
    CANONICAL_SAMPLE_RATE
  );
  return book.id;
}

async function exportedLanguages(bookId: BookId): Promise<unknown> {
  const out = await buildBookBundle(bookId, PARAMS);
  if (out.kind !== "ready") throw new Error(`expected a bundle: ${out.kind}`);
  const { metadata } = readBundle(new Uint8Array(await out.file.arrayBuffer()));
  await out.release();
  return (metadata as { languages: unknown }).languages;
}

describe("performSetBookLanguage", () => {
  it("stores the pick, and the next export's metadata.json carries it", async () => {
    const bookId = await recordedBook(null);
    expect(await exportedLanguages(bookId)).toEqual([
      { tag: "und", name: { en: "Undetermined" } },
    ]);

    const result = await performSetBookLanguage(bookId, "swh");

    expect(result.ok).toBe(true);
    expect((await getBook(bookId))?.languageCode).toBe("swh");
    expect(await exportedLanguages(bookId)).toEqual([
      { tag: "swh", name: { en: "swh" } },
    ]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("keeps a book's existing language, so its export is unchanged", async () => {
    const bookId = await recordedBook("fr");

    const result = await performSetBookLanguage(bookId, "swh");

    expect(result.ok && result.book.languageCode).toBe("fr");
    expect(await exportedLanguages(bookId)).toEqual([
      { tag: "fr", name: { en: "fr" } },
    ]);
  });

  it("reports a failed write as book-language and returns its key, writing nothing", async () => {
    const bookId = await recordedBook(null);
    const cause = new Error("disk gone");
    vi.mocked(booksStore.setBookLanguageOnce).mockRejectedValueOnce(cause);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await performSetBookLanguage(bookId, "swh");

    quiet.mockRestore();
    expect(result).toEqual({ ok: false, key: "saveFailed" });
    expect(reportFailure).toHaveBeenCalledWith(cause, "book-language");
    expect((await getBook(bookId))?.languageCode).toBeNull();
  });
});
