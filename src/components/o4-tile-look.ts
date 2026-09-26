import { cn } from "@/lib/utils";

/**
 * The tile fills O4 draws (#941, #949): the three coloured action roles, the
 * erase tile (live ink on the quiet red, inside a live ring, per the
 * workbench's `del` tile), and the plain well the theme and export tiles use.
 * `done` and `doneoff` are marking done (G8): grey until the segment is done,
 * then the whole tile green. `cover` is the book menu's Cover colour tile
 * (#937 D7), filled with the book's own colour; its fill is in `o4/books.css`,
 * beside the covers, because it is not a layer-2 role.
 */
export type TileTone =
  "edit" | "name" | "send" | "erase" | "plain" | "done" | "doneoff" | "cover";

/** The glyph size a tile draws at. */
export const TILE_GLYPH = 30;

/**
 * A tile's classes. `Tile` (`o4-tile-menu.tsx`) reads this, and so does the
 * one caller that cannot swap its `Control` for a `Tile`:
 * `share-menu-section.tsx`, whose two-gesture ternary is pinned as ONE
 * `Control` per branch (`tests/share-progress.test.ts`), so it keeps its
 * element and dresses it as a tile instead (#949).
 *
 * Its own module, not `o4-tile-menu.tsx`, because a file that exports
 * components may export nothing else (`react-refresh/only-export-components`).
 */
export function tileClass(tone: TileTone, className?: string): string {
  return cn("o4-tile", `o4-tile--${tone}`, className);
}
