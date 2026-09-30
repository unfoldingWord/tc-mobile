import type { CSSProperties, ReactNode } from "react";

import { Icon } from "./icon";
import { strings } from "@/lib/strings";
import type { SegmentRowState } from "@/types/view";

export interface O4CrumbsProps {
  /** The book's name, the first crumb. */
  book?: string;
  /**
   * The second crumb: the chapter's resolved name (`strings.chapterHeading`:
   * the typed name, else "Chapter N", #1230), from every caller in `src/`.
   * A number still renders, as a bare ordinal.
   */
  chapter?: string | number;
  /** The segment crumb, on the segment menu and the recorder header only. */
  segment?: { ordinal: number; state: SegmentRowState };
  /**
   * The crumbs that navigate (#1269), each drawn as a button named for its
   * destination. Only a screen header passes these; a menu's sheet head
   * never does, so its crumbs stay decoration.
   */
  links?: { book?: O4CrumbLink; chapter?: O4CrumbLink };
  /**
   * Disables every linked crumb, for a header whose Back control is disabled
   * in the same state (the recorder's held take and close window).
   */
  disabled?: boolean;
  /** The crumb for the screen being shown, marked `aria-current="page"`. */
  current?: "chapter" | "segment";
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
 * that, and every caller now passes the chapter's resolved name
 * (`strings.chapterHeading`): the chapter-screen and recorder headers, and
 * (the DRI's pick on #1263, "Names in menus too") the sheet heads of the
 * chapter, segment and recorder menus, so a header and its menu always
 * match. A crumb too long for its share of the row is elided with "…" by
 * `o4/menus.css`, which also sets how the crumbs share that row.
 *
 * The book and chapter chips' text carries `dir="auto"` (#1267): both are
 * names the facilitator typed, so each takes its direction from its own
 * content, and the "…" elision and the alignment follow it (an RTL name is cut
 * at its left end, the logical end). The chapter chip receives the resolved
 * heading, so an unnamed chapter's default "Chapter N" also gets `auto`; that
 * resolves the same way the app locale does, so nothing changes for it. The
 * segment chip is a bare number and carries none.
 *
 * Without `links` it is decoration (no own `aria-hidden`, no own `role`) —
 * a caller in a menu wraps it in `O4SheetHead`'s `aria-hidden` div, and
 * `O4SheetHead` passes no links, so a menu's crumbs stay decoration.
 *
 * With `links` (#1269, the requirements owner: "Yes, make the header crumbs
 * tappable for navigation"), a screen header turns each crumb that names a
 * place above the current screen into a button named for its destination,
 * and marks the current place's crumb `aria-current="page"`, which stays a
 * plain span. The header hands each link its own Back handler, so a crumb
 * never leaves by a path Back does not take. A linked crumb is a 44px
 * target drawn as the same 40px chip (`o4/menus.css`, `button.o4-crumb`).
 */
export function O4Crumbs({
  book,
  chapter,
  segment,
  links,
  disabled,
  current,
  className,
}: O4CrumbsProps) {
  return (
    <div className={className ? `o4-crumbs ${className}` : "o4-crumbs"}>
      {book !== undefined && (
        <Crumb link={links?.book} disabled={disabled}>
          <span dir="auto">{book}</span>
        </Crumb>
      )}
      {chapter !== undefined && (
        <Crumb
          link={links?.chapter}
          disabled={disabled}
          current={current === "chapter"}
        >
          <span dir="auto">{chapter}</span>
        </Crumb>
      )}
      {segment && (
        <Crumb state={segment.state} current={current === "segment"}>
          <span>{segment.ordinal}</span>
        </Crumb>
      )}
    </div>
  );
}

/** A crumb that navigates: its spoken name, and the header's own handler. */
interface O4CrumbLink {
  label: string;
  onClick: () => void;
}

function Crumb({
  link,
  disabled,
  current,
  state,
  children,
}: {
  link?: O4CrumbLink;
  disabled?: boolean;
  current?: boolean;
  state?: SegmentRowState;
  children: ReactNode;
}) {
  if (link) {
    return (
      <button
        type="button"
        className="o4-crumb"
        aria-label={link.label}
        disabled={disabled}
        onClick={link.onClick}
      >
        {children}
      </button>
    );
  }
  return (
    <span
      className="o4-crumb"
      data-state={state}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </span>
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
  /**
   * The second crumb: the chapter's resolved name (`strings.chapterHeading`,
   * #1230), the same text the header the menu was opened from shows.
   */
  chapter?: string | number;
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
 * The chips are decoration, so the head is `aria-hidden`: the dialog is
 * named by `<Menu>`'s title, and every action in it names what it does
 * ("Edit segment 3", "Share chapter"). Neither of those names the chapter,
 * though, so beside the hidden head sits one screen-reader-only line
 * (`.o4-sheet-place`) with the same place in words — the book, the chapter's
 * name and the segment, the trail `strings.chapterBreadcrumb` /
 * `strings.recorderBreadcrumb` spell (#1230). It is drawn only when both the
 * book and the chapter are given, as every call site in `src/` gives them.
 * The dialog's own name is left alone: the e2e suite and the current look
 * find these menus by it.
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
  const place =
    book === undefined || chapter === undefined
      ? null
      : segment
        ? strings.recorderBreadcrumb(
            book,
            String(chapter),
            segment.ordinal,
            null
          )
        : strings.chapterBreadcrumb(book, String(chapter));
  return (
    <>
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
      {place !== null && (
        <p className="o4-sheet-place sr-only" dir="auto">
          {place}
        </p>
      )}
    </>
  );
}
