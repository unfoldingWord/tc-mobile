import type { SegmentRowState } from "@/types/view";

interface O4SheetHeadProps {
  /** The book's name, the first crumb. */
  book?: string;
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
 * named by `<Menu>`'s title, and every action in it already names its target
 * ("Edit segment 3", "Share chapter"). The screen reader hears the same menu
 * in both looks.
 *
 * Not drawn: the book's cover square (the cover colour is #957/#942's, not
 * on this base) and the "hear this" speaker (spoken titles, #952, are after
 * the training).
 */
export function O4SheetHead({ book, chapter, segment }: O4SheetHeadProps) {
  return (
    <div className="o4-sheet-head" aria-hidden="true">
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
