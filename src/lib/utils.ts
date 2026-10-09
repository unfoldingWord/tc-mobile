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
 * Each label is also capped by UTF-8 bytes, cut at a grapheme boundary so a
 * base letter is never parted from its combining marks (#1233 item 22): a name
 * of 80 characters is about 240 bytes in a 3-byte script (Ge'ez, most Indic),
 * and the filename holds two labels against a 255-byte filesystem limit.
 *
 * Only the EXPORT form is sanitised. The stored display name is untouched — the
 * shelf still shows exactly what was typed.
 */
export function filenameSafe(label: string): string {
  const clean = label
    .replace(/[/\\:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return capUtf8Bytes(clean, FILENAME_LABEL_MAX_BYTES).trim();
}

/**
 * Per-label byte cap. A share filename is `<book> - <chapter>.mp3`: two labels,
 * a 3-byte separator and a 4-byte extension, so 2 x 120 + 7 = 247 stays inside
 * the 255-byte limit with the extension intact (#1233 item 22).
 */
export const FILENAME_LABEL_MAX_BYTES = 120;

const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The longest whole-grapheme prefix of `text` that fits in `maxBytes` of UTF-8. */
function capUtf8Bytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const bytes = encoder.encode(segment).length;
    if (used + bytes > maxBytes) break;
    out += segment;
    used += bytes;
  }
  return out;
}
