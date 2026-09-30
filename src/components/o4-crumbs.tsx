import type { CSSProperties } from "react";

import { Icon } from "./icon";
import type { SegmentRowState } from "@/types/view";

export interface O4CrumbsProps {
  /** The book's name, the first crumb. */
  book?: string;
  /**
   * The second crumb. The chapter-screen and recorder headers pass the
   * chapter's resolved name (`strings.chapterHeading`: the typed name, else
   * "Chapter N", #1230); the menus' sheet heads pass its number.
   */
  chapter?: string | number;
  /** The segment crumb, on the segment menu and the recorder header only. */
  segment?: { ordinal: number; state: SegmentRowState };
  /**
   * Extra classes for the row itself (`.o4-crumbs` is always applied) — a
   * header threads its own flex-shrink utilities (`min-w-0 flex-1`) here so
   * the chips truncate the same way the menu's own row does, without this
   * component needing to know it sits in a header rather than a sheet head.
   */
  className?: string;
}

/**
 * The breadcrumb CHIPS on their own (#1105): chevron-clipped `.o4-crumb`
 * spans, book then chapter then (if given) the segment, the segment's own
 * crumb tinted by its state. Split out of `O4SheetHead` below so the
 * segments and recorder headers (`segments-screen.tsx`, `recorder.tsx`) can
 * render the exact same markup the O4 menus do, rather than a second
 * hand-written reading of `.o4-crumb`'s chevron clip-path.
 *
 * The chapter crumb shows whatever the caller passes. #1105 made it the
 * number everywhere; the requirements owner's decision on #1230 supersedes
 * that for the chapter-screen and recorder headers, which now pass the
 * chapter's name. The menus' sheet heads (`O4SheetHead` below) are not named
 * in that decision and still pass the number. A crumb too long for its share
 * of the row is elided with "…" by `o4/menus.css`, which also sets how the
 * crumbs share that row.
 *
 * Decoration only wherever it renders (no own `aria-hidden`, no own
 * `role`) — a caller in a menu wraps it in `O4SheetHead`'s `aria-hidden`
 * div; a caller in a screen header wraps it itself and supplies whatever
 * accessible name the surrounding control needs, because a plain header
 * (unlike a `<Menu>`) has no dialog title standing in for it.
 */
export function O4Crumbs({ book, chapter, segment, className }: O4CrumbsProps) {
  return (
    <div className={className ? `o4-crumbs ${className}` : "o4-crumbs"}>
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
  );
}

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
 * and `bookCoverHex`; the chapter, segment-row and recorder call sites all
 * do now (`use-chapter-segments.ts`'s and `use-recorder-segment.ts`'s own
 * `bookCoverHex`, each resolved the same way `books-screen.tsx` resolves
 * the shelf's own covers). A caller that has not (yet) been updated to
 * carry it still renders exactly as before this prop existed.
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
      <O4Crumbs book={book} chapter={chapter} segment={segment} />
    </div>
  );
}
