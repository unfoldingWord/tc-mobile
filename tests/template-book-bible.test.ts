import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { getBook, getChapter, getSegmentsOfChapter } from "@/lib/storage/books";
import {
  type TemplateBookIds,
  createBookFromPlan,
} from "@/lib/storage/template-book";
import { planBookFromTemplate } from "@/lib/templates/plan";
import { parseTemplatePackage } from "@/lib/templates/validate";
import type { BookId, ChapterId, SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Plan and write a book from the real Titus package (#1450, plan task 2,
 * done-when R2): the validator, `planBookFromTemplate` and
 * `createBookFromPlan` together, on the pinned dataset fixture rather than an
 * invented one. The fixture and its provenance are in
 * `fixtures/templates/README.md`.
 *
 * The expected rows are read from the fixture's raw JSON, not from the parsed
 * package, so a validator that rewrote a key or a span would not pass by
 * agreeing with itself.
 *
 * Titles are not asserted here. Whether and how chapter and segment titles
 * are written at creation is plan tasks 3 and 4, which wait on the dataset's
 * title tables.
 */

const FIXTURE = path.join(
  __dirname,
  "fixtures",
  "templates",
  "bible-passages-TIT.json"
);
const NOW = 1_760_000_000_000;

interface RawSegment {
  readonly key: string;
  readonly reference: unknown;
}
interface RawPackage {
  readonly version: string;
  readonly attribution: string;
  readonly title: { readonly en: string };
  readonly chapters: readonly {
    readonly key: string;
    readonly number: number;
    readonly segments: readonly RawSegment[];
  }[];
}

const raw = (): RawPackage =>
  JSON.parse(readFileSync(FIXTURE, "utf8")) as RawPackage;

beforeEach(clearAllStores);

describe("a book made from the pinned Titus package", () => {
  it("a Titus book is written with the dataset's keys, spans and chapter numbers", async () => {
    const source = raw();
    // The fixture's own shape, so a re-pin that changes it is noticed here.
    expect(source.chapters.map((c) => c.segments.length)).toEqual([9, 7, 9]);

    const plan = planBookFromTemplate(
      parseTemplatePackage(source),
      () => undefined,
      NOW
    );
    const ids: TemplateBookIds = {
      book: "book-tit" as BookId,
      chapters: plan.chapters.map((chapter, c) => ({
        id: `chapter-tit-${c}` as ChapterId,
        segments: chapter.segments.map(
          (_, s) => `segment-tit-${c}-${s}` as SegmentId
        ),
      })),
    };
    await createBookFromPlan(plan, ids, source.title.en);

    const book = await getBook(ids.book);
    if (!book) throw new Error("book not written");
    expect(book.name).toBe("Titus");
    expect(book.licence).toBe("CC-BY-SA-4.0");
    expect(book.provenance).toEqual({
      kind: "template",
      template: {
        id: "bible-passages:TIT",
        version: source.version,
        kind: "bible-book",
      },
      attribution: source.attribution,
    });
    expect(book.chapterIds).toEqual(ids.chapters.map((c) => c.id));

    const written = [];
    for (const chapterId of book.chapterIds) {
      const chapter = await getChapter(chapterId);
      if (!chapter) throw new Error("chapter not written");
      const segments = await getSegmentsOfChapter(chapterId);
      written.push({
        templateKey: chapter.templateKey,
        number: chapter.number,
        segments: segments.map((s) => ({
          index: s.index,
          templateKey: s.templateKey,
          reference: s.reference,
        })),
      });
    }

    expect(written.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(written).toEqual(
      source.chapters.map((chapter) => ({
        templateKey: chapter.key,
        number: chapter.number,
        segments: chapter.segments.map((segment, position) => ({
          index: position + 1,
          templateKey: segment.key,
          reference: segment.reference,
        })),
      }))
    );
  });
});
