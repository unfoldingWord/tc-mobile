import { forwardRef, type ComponentProps, type ReactNode } from "react";

import { Control } from "./control";
import { TILE_GLYPH, tileClass, type TileTone } from "./o4-tile-look";
import { cn } from "@/lib/utils";

/**
 * The O4 tile-menu primitive (#941, epic #936): every O4 menu is a row of
 * large coloured tiles — a 76 × 76 box, radius 20, its caption 14px below
 * with a gap of 8 (`docs/design/o4-design-system.md` §3; workbench `tile()`).
 *
 * A tile IS a `Control` — the same button, name, `busy`, `hint` and `pressed`
 * semantics every current menu row already has — with a visible caption and
 * a tone class. Swapping a menu's `Control` rows for `Tile`s in its O4 branch
 * therefore changes no accessible name and no focus behaviour.
 *
 * THE SHEET IS NOT A SECOND SURFACE. A tile menu is still a `<Menu>`
 * (`menu.tsx`): its focus trap, Escape, scrim tap, `inert` and heading are
 * the reviewed ones. `o4/menus.css` gives any `.menu-panel` that holds a
 * `TileGrid` the O4 bottom-sheet shell (inset 8, radius 26, a 56 × 5
 * handle) — keyed on the grid's presence, so the name sheets that share
 * `<Menu>` (#943's) are untouched by it.
 *
 * ADOPTED BY the chapter and segment menus (#949: G2, 07, G8), in their O4
 * branches, and by the book, app (≡) and recorder (⋮) menus. The
 * tones, glyph size and classes live in `o4-tile-look.ts`.
 */
type ControlProps = ComponentProps<typeof Control>;

/**
 * One tile. `label` is the accessible name, exactly as the `Control` it
 * replaces had it; `caption` is the short word shown under the box, and it
 * must be a word the label already holds (label-in-name, WCAG 2.5.3), so a
 * voice-control user can say what they see.
 */
export const Tile = forwardRef<
  HTMLButtonElement,
  Omit<ControlProps, "variant" | "caption"> & {
    tone: TileTone;
    caption: string;
  }
>(function Tile({ tone, className, size = TILE_GLYPH, ...rest }, ref) {
  return (
    <Control
      ref={ref}
      {...rest}
      size={size}
      className={tileClass(tone, className)}
    />
  );
});

/**
 * The row of tiles. Its presence inside a `<Menu>` is what gives that menu
 * the bottom-sheet shell (see this file's header).
 *
 * `className` is an escape hatch for a row that cannot fit at the pinned
 * 76 × 76 token (`docs/design/o4-design-system.md`'s "Menu tile" row) — today
 * that is only the segment menu's four-real-tile case (Done, Edit, Delete,
 * Erase, #1119 round 5, George Medium 1): `o4-tiles--compact` in
 * `o4/menus.css` shrinks the tile box and the row gap for that one grid,
 * scoped by class rather than by tile COUNT, so a three-tile row (this same
 * menu with no stored clip) is untouched and stays at the documented size.
 */
export function TileGrid({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <div className={cn("o4-tiles", className)}>{children}</div>;
}

/**
 * Pushes the tiles after it to the far end of the row — where the theme tile
 * sits in every O4 menu (workbench G1, G2, G3). Decorative.
 */
export function TileSpacer() {
  return <span className="o4-tiles-gap" aria-hidden="true" />;
}
