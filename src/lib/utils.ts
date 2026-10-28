import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatNumber } from "./number-format";

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
  return `${formatNumber(minutes, { minDigits: 2 })}:${formatNumber(seconds, { minDigits: 2 })}`;
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
 * `reservedBytes` lets a caller that puts something of its own beside the
 * label (the chapter number, #1233) take those bytes out of the label's budget.
 *
 * Only the EXPORT form is sanitised. The stored display name is untouched — the
 * shelf still shows exactly what was typed.
 */
export function filenameSafe(label: string, reservedBytes = 0): string {
  const clean = label
    .replace(/[/\\:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const named = WINDOWS_RESERVED_STEM.test(clean) ? `_${clean}` : clean;
  return capUtf8Bytes(named, FILENAME_LABEL_MAX_BYTES - reservedBytes).trim();
}

/**
 * Windows device names. Windows treats them as the device whatever follows the
 * first dot (`CON.zip`, `con.txt`), so a book named `CON` could not be
 * extracted as a Share Book `.zip` or a Share your work folder. The whole-
 * filename share form `<book> - <chapter>.mp3` can never BE one of these, but
 * `shareBookFilename` and the library folder are the bare label (#163 Q-18).
 */
const WINDOWS_RESERVED_STEM =
  /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;

/**
 * Per-label byte cap. A share filename is `<book> - <chapter>.mp3`: two labels,
 * a 3-byte separator and a 4-byte extension, so 2 x 120 + 7 = 247 stays inside
 * the 255-byte limit with the extension intact (#1233 item 22). The chapter
 * label is `<number> <name>` (#1233 item 21), and the number and its space come
 * out of these 120 bytes, so the sum holds whatever the number.
 */
export const FILENAME_LABEL_MAX_BYTES = 120;

const encoder = new TextEncoder();
let graphemes: Intl.Segmenter | null = null;

/**
 * Whole-grapheme pieces of `text`, from `Intl.Segmenter` when the engine has it
 * (built lazily and cached, never at module load: the build targets Firefox 114
 * and Firefox shipped the API in 125, so a module-scope construction would stop
 * the app starting there). Without it the pieces are code points, which never
 * split a surrogate pair; a combining mark may then be parted from its base.
 * That is the documented degradation on an engine without the Segmenter.
 */
function pieces(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(graphemes.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * The longest whole-piece prefix of `text` that fits in `maxBytes` of UTF-8.
 * When the first grapheme cluster alone is over budget (one base character
 * carrying many combining marks) no whole cluster fits, and an empty result
 * would make a caller treat a real label as missing (#1233). That one case
 * falls back to the code-point walk, which keeps a valid prefix of the cluster.
 */
function capUtf8Bytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  const cut = takeWithin(pieces(text), maxBytes);
  return cut === "" ? takeWithin(Array.from(text), maxBytes) : cut;
}

function takeWithin(parts: string[], maxBytes: number): string {
  let out = "";
  let used = 0;
  for (const segment of parts) {
    const bytes = encoder.encode(segment).length;
    if (used + bytes > maxBytes) break;
    out += segment;
    used += bytes;
  }
  return out;
}
