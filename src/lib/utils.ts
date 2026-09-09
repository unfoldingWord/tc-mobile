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

/**
 * Make a free-text label safe to sit inside a filename or a zip entry name.
 *
 * Since #264 a book can be renamed to anything a facilitator types, and that
 * name flows into the Share filenames and the zip entry names (G3). A `/` (or
 * `\`) in a name like "Mark/Luke" would otherwise split a zip entry into a
 * folder — a corrupt-or-ambiguous archive — and the reserved characters
 * `: * ? " < > |` are illegal in filenames on common filesystems. Each of those,
 * plus any control character (`\p{Cc}`), is replaced with a space; runs of
 * whitespace then collapse and the ends are trimmed, so the result is a readable
 * label and never a path.
 *
 * Only the EXPORT form is sanitised. The stored display name is untouched — the
 * shelf still shows exactly what was typed.
 */
export function filenameSafe(label: string): string {
  return label
    .replace(/[/\\:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
