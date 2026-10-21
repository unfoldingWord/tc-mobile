import type { Book, Chapter, Segment } from "@/types/domain";
import type { TemplatePackage } from "@/types/template";

import { templateRef } from "./validate";

/**
 * Plan one book from a validated template package (#253, part of #1450): the
 * ordered chapter and segment rows a writer turns into IndexedDB rows. Pure:
 * no storage, no DOM, and no clock or random source of its own, so the same
 * input always gives a deep-equal plan.
 *
 * It reads the package's shape only. It never branches on the package's kind
 * or book code, so a source nobody wrote code for plans the same as the rest
 * (`tests/template-plan.test.ts` reads this file to hold that).
 *
 * What the plan settles:
 * - Order and numbers. Chapters come in package order and each carries the
 *   package's own `number` (R7: "Every chapter carries the number someone
 *   types or the template gives"), never its position. A segment's `index`
 *   is its 1-based position in its chapter, which is what `Segment.index`
 *   is (a mirror of `Chapter.segmentIds` order).
 * - Where a segment lives. Each segment is planned once, in the chapter the
 *   package lists it under, and a span that crosses a chapter boundary is not
 *   copied or moved to the chapter it ends in (R6: "The chapter it starts
 *   in; it plays and exports there").
 * - The book's provenance stamp and licence. A book made from a template is
 *   CC BY-SA 4.0 (D5), which is the package's `recordingLicence`.
 *
 * What it leaves to the caller:
 * - Ids. The plan carries none; the writer mints them in its transaction. An
 *   id derived from the package id and key would make a second book from the
 *   same template collide with the first, and a random id here would break
 *   determinism.
 * - Titles. Each row's `title` is whatever the caller's resolver returns, or
 *   `null`. Whether a title is written into the book (as `Chapter.name` or
 *   `Segment.label`) or rendered in the phone's language at read time from
 *   `templateKey` is open with the DRI (#1450), so this module decides
 *   neither. A resolver that has no title gives `null`, never an error.
 * - `thumbnail`. Carried from the package; no domain row has a field for it
 *   yet, so the writer decides where it goes.
 */

/**
 * A chapter or segment title for a template key, or `undefined` for none.
 *
 * @pivotpending #253: supplied by the storage half's caller, as
 * {@link planBookFromTemplate}.
 */
export type TitleResolver = (
  kind: "chapter" | "segment",
  key: string
) => string | undefined;

type TemplateProvenance = Extract<Book["provenance"], { kind: "template" }>;

/** The domain row's own field names, typed as set: a planned row has a time. */
type Stamped<T, K extends keyof T> = { readonly [P in K]: NonNullable<T[P]> };

/** @pivotpending #253: read by the storage half, as {@link planBookFromTemplate}. */
export interface PlannedSegment
  extends
    Pick<Segment, "index" | "reference">,
    Stamped<Segment, "createdAt" | "modifiedAt"> {
  readonly templateKey: string;
  readonly thumbnail: string | null;
  readonly title: string | null;
}

/** @pivotpending #253: read by the storage half, as {@link planBookFromTemplate}. */
export interface PlannedChapter
  extends
    Pick<Chapter, "number">,
    Stamped<Chapter, "createdAt" | "modifiedAt"> {
  readonly templateKey: string;
  readonly title: string | null;
  readonly segments: readonly PlannedSegment[];
}

/** @pivotpending #253: read by the storage half, as {@link planBookFromTemplate}. */
export interface BookPlan extends Stamped<
  Book,
  "createdAt" | "updatedAt" | "modifiedAt"
> {
  readonly provenance: TemplateProvenance;
  readonly licence: TemplatePackage["recordingLicence"];
  readonly chapters: readonly PlannedChapter[];
}

/**
 * @pivotpending #253: the storage half (one idempotent transaction that
 * writes the book, its chapters and its segments) consumes this plan; it waits
 * on open PR #1550, which changes `lib/storage/books.ts`.
 */
export function planBookFromTemplate(
  pkg: TemplatePackage,
  resolveTitle: TitleResolver,
  now: number
): BookPlan {
  const chapters = pkg.chapters.map((chapter): PlannedChapter => ({
    number: chapter.number,
    templateKey: chapter.key,
    title: resolveTitle("chapter", chapter.key) ?? null,
    createdAt: now,
    modifiedAt: now,
    segments: chapter.segments.map((segment, position): PlannedSegment => ({
      index: position + 1,
      templateKey: segment.key,
      reference: segment.reference === null ? null : { ...segment.reference },
      thumbnail: segment.thumbnail,
      title: resolveTitle("segment", segment.key) ?? null,
      createdAt: now,
      modifiedAt: now,
    })),
  }));
  return {
    provenance: {
      kind: "template",
      template: templateRef(pkg),
      attribution: pkg.attribution,
    },
    licence: pkg.recordingLicence,
    createdAt: now,
    updatedAt: now,
    modifiedAt: now,
    chapters,
  };
}
