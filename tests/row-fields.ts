/**
 * The v12 fields (#1462, docs/design/v12-schema.md) a hand-built row needs,
 * shared so a test that builds a `Book`, `Chapter` or `Segment` by hand spreads
 * one definition instead of restating it. Values are what the v12 backfill
 * writes on a pre-v12 row; a test about a field's value sets it itself.
 */

import type { Book, Chapter, Segment } from "@/types/domain";

export const BOOK_V12_FIELDS: Pick<
  Book,
  "provenance" | "licence" | "modifiedAt"
> = { provenance: { kind: "blank" }, licence: null, modifiedAt: null };

export const ROW_V12_FIELDS: Pick<
  Chapter & Segment,
  "createdAt" | "modifiedAt" | "templateKey"
> = { createdAt: null, modifiedAt: null, templateKey: null };
