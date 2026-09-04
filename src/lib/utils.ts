import { clsx, type ClassValue } from "clsx";

/**
 * Joins conditional class names. Plain `clsx`, not `tailwind-merge` (#161):
 * every `cn(` call site was audited and none combines two Tailwind utilities
 * from the same group where the caller relies on "last one wins" — the
 * variable half of each call is either a static custom class (`row--finished`,
 * `control--quiet`) or a caller `className` prop that, at every current call
 * site, is never actually passed alongside a conflicting utility. If a future
 * call site needs real conflict resolution, reach for `tailwind-merge` again
 * rather than assuming `clsx` still covers it.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * mm:ss — the only "text" allowed on the primary path, because digits read
 * across scripts.
 *
 * Minutes are zero-padded, not just seconds (#94): the live recorder clock
 * (`.t-timer`) is `tabular-nums`, which holds each glyph's width but not the
 * string's length, so an unpadded `9:59 → 10:00` grew the clock by a digit and
 * shifted it mid-record. Padding to two digits keeps the width constant through
 * that rollover. Past 99:59 it grows again, but no oral-translation segment runs
 * a hundred minutes, so that case is left alone.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
