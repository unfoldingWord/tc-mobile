import type { CSSProperties } from "react";

import { Icon } from "./icon";
import type { SegmentRowState } from "@/types/view";

interface O4SheetHeadProps {
  /** The book's name, the first crumb. */
  book?: string;
  /**
   * The book's resolved cover colour (#957), already turned into a hex
   * string the same way `books-screen.tsx`'s row and `O4BookHead` do
   * (`coverColourHex(resolveCoverKey(...))`) -- never a bare
   * `CoverColourKey`, so this component does not need the palette to draw
   * it. Read only in the O4 look, like every other head field. Left out (no
   * square drawn) when the caller has not threaded it, or has no `book` --
   * a call site that has not (yet) been updated to carry it renders exactly
   * as it did before this prop existed.
   */
  bookCoverHex?: string;
  /** The chapter's number, the second crumb (the workbench's `crumbs()`). */
  chapter?: number;
  /** The segment crumb, on the segment menu only: its ordinal and state. */
  segment?: { ordinal: number; state: SegmentRowState };
}

/**
 * The O4 sheet header (#949; design reference §7, "Sheet headers"): the
 * breadcrumbs a menu sheet shows so the translator can see what it acts on —
 * book, then chapter, then (on the segment menu) the segment, chevron-clipped
 * crumbs on the well, the segment crumb tinted by its state. A crumb whose
 * value the caller does not have is left out.
 *
 * Decoration only, so the whole head is `aria-hidden`: the dialog is already
 * named by `<Menu>`'s title, and every action in it already names what it
 * does ("Edit segment 3", "Share chapter"). The screen reader hears the same
 * menu in both looks.
 *
 * Used by the chapter, segment and recorder menus.
 *
 * The book's cover-colour square (#949, #957) sits before the crumb row,
 * reusing `O4BookHead`'s own unit unchanged -- the same `.books-cover.is-sm`
 * class, the same `--book-cover` custom-property boundary
 * (`lib/cover-colour.ts`'s docblock on why a cover colour is not a layer-2
 * role), the same 24px book glyph -- rather than a second, crumb-scaled size
 * decision on top of #949's own. It draws once a caller threads both `book`
 * and `bookCoverHex`; the chapter and segment-row call sites now do
 * (`use-chapter-segments.ts`'s `bookCoverHex`, resolved the same way
 * `books-screen.tsx` resolves the shelf's own covers). The recorder SCREEN's
 * own call site (`recorder.tsx`) does not thread it yet as of this PR --
 * see that PR's body -- so the recorder menu still renders without the
 * square until it does; nothing here assumes it must.
 *
 * Not drawn: the "hear this" speaker (spoken titles, #952, are after the
 * training).
 */
export function O4SheetHead({
  book,
  bookCoverHex,
  chapter,
  segment,
}: O4SheetHeadProps) {
  return (
    <div className="o4-sheet-head" aria-hidden="true">
      {book !== undefined && bookCoverHex !== undefined && (
        <span
          className="books-cover is-sm"
          style={{ "--book-cover": bookCoverHex } as CSSProperties}
        >
          <Icon name="book" size={24} />
        </span>
      )}
      <div className="o4-crumbs">
        {book !== undefined && (
          <span className="o4-crumb">
            <span>{book}</span>
          </span>
        )}
        {chapter !== undefined && (
          <span className="o4-crumb">
            <span>{chapter}</span>
          </span>
        )}
        {segment && (
          <span className="o4-crumb" data-state={segment.state}>
            <span>{segment.ordinal}</span>
          </span>
        )}
      </div>
    </div>
  );
}
