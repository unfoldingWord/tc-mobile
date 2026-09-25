import { forwardRef, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Control } from "./control";

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
 */
type ControlProps = ComponentProps<typeof Control>;

/**
 * The tile fills O4 draws: the three coloured action roles, the erase tile
 * (live ink on the quiet red, inside a live ring, per the workbench's `del`
 * tile), and the plain well the theme and export tiles use.
 */
type TileTone = "edit" | "name" | "send" | "erase" | "plain";

/**
 * One tile. `label` is the accessible name, exactly as the `Control` it
 * replaces had it; `caption` is the short word shown under the box.
 */
export const Tile = forwardRef<
  HTMLButtonElement,
  Omit<ControlProps, "variant" | "caption"> & {
    tone: TileTone;
    caption: string;
  }
>(function Tile({ tone, className, size = 30, ...rest }, ref) {
  return (
    <Control
      ref={ref}
      {...rest}
      size={size}
      className={cn("o4-tile", `o4-tile--${tone}`, className)}
    />
  );
});

/**
 * The row of tiles. Its presence inside a `<Menu>` is what gives that menu
 * the bottom-sheet shell (see this file's header).
 */
export function TileGrid({ children }: { children?: ReactNode }) {
  return <div className="o4-tiles">{children}</div>;
}

/**
 * Pushes the tiles after it to the far end of the row — where the theme tile
 * sits in every O4 menu (workbench G1, G2, G3). Decorative.
 */
export function TileSpacer() {
  return <span className="o4-tiles-gap" aria-hidden="true" />;
}
