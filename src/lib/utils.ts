import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
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
