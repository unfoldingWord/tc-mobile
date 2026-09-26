import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import { CoverPicker } from "./cover-picker";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { Tile, TileGrid } from "./o4-tile-menu";
import type { CoverColourKey } from "@/lib/cover-colour";
import { strings } from "@/lib/strings";

/**
 * The O4 book menu's own pieces (#949: state 04; #937 D7), mounted by
 * `books-screen.tsx` in its O4 branch. The sheet itself is still that
 * screen's `<Menu>`, so the focus trap, Escape, scrim and Back are the ones
 * already reviewed; these are presentational and every outcome arrives by
 * prop.
 *
 * A book's cover colour is its identity, not a themed role
 * (`lib/cover-colour.ts`), so it reaches the stylesheet as the `--book-cover`
 * custom property set inline, the boundary the shelf's covers and the delete
 * ask already use.
 */

/**
 * 04's sheet head: the book's small cover and name, then `children` (the
 * Rename pencil) at the end of the row, as the workbench draws it. The cover
 * and name are decoration (`aria-hidden`), as `O4SheetHead` is on the other
 * menus: the dialog is named by `<Menu>`, and every action names what it
 * does. The children sit outside the hidden part.
 */
export function O4BookHead({
  name,
  coverHex,
  children,
}: {
  name: string;
  coverHex: string;
  children?: ReactNode;
}) {
  return (
    <div className="o4-sheet-bar">
      <div className="o4-sheet-head books-menu-head" aria-hidden="true">
        <span
          className="books-cover is-sm"
          style={{ "--book-cover": coverHex } as CSSProperties}
        >
          <Icon name="book" size={24} />
        </span>
        <span className="books-sheet-name">{name}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The Cover colour tile (#937 D7: "the book menu (04 / G1) gets a 'Cover
 * colour' tile that opens #957's picker"). Its box is filled with the book's
 * own colour, so the tile shows what it changes. The spoken name and the
 * caption are the picker's own group name, so the name holds the caption.
 */
export const CoverTile = forwardRef<
  HTMLButtonElement,
  { coverHex: string; onClick: () => void }
>(function CoverTile({ coverHex, onClick }, ref) {
  return (
    // `display: contents`: the custom property reaches the tile without the
    // holder taking a place in the grid.
    <span
      className="contents"
      style={{ "--book-cover": coverHex } as CSSProperties}
    >
      <Tile
        ref={ref}
        tone="cover"
        icon="book"
        label={strings.coverColourLabel}
        caption={strings.coverColourLabel}
        onClick={onClick}
      />
    </span>
  );
});

/**
 * #957's picker, in the book sheet where the tiles were. It sits inside the
 * tile grid so the sheet keeps its bottom-sheet shell (`o4/menus.css` keys
 * the shell on the grid). Focus lands on the book's own colour when it
 * appears: the sheet's `<Menu>` only focuses on its open edge, and it did not
 * close.
 *
 * The swatches are never disabled while a write is in flight. A disabled
 * swatch under the focus would drop it out of the sheet's trap; the hook
 * refuses a second write instead (`useBookCoverColour`'s `"busy"`).
 */
export function O4CoverPick({
  selected,
  onSelect,
  error,
}: {
  selected: CoverColourKey;
  onSelect: (key: CoverColourKey) => void;
  /** A failed write, already worded; `null` says nothing. */
  error: string | null;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    holder.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
  }, []);
  return (
    <>
      <TileGrid>
        <div ref={holder} className="books-cover-pick">
          <CoverPicker selected={selected} onSelect={onSelect} />
        </div>
      </TileGrid>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
