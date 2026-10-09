import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FILENAME_LABEL_MAX_BYTES,
  filenameSafe,
  formatDuration,
} from "@/lib/utils";

/**
 * `formatDuration` is the recorder clock. The property under test is width
 * stability, not just correctness: the live `.t-timer` is `tabular-nums`, so a
 * change in the STRING LENGTH shifts the clock mid-record (#94). Every value
 * from the first minute up to 99:59 must render five characters.
 */
describe("formatDuration", () => {
  it("zero-pads both fields", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(5_000)).toBe("00:05");
    expect(formatDuration(65_000)).toBe("01:05");
  });

  it("holds five characters across the 10:00 rollover (the #94 regression)", () => {
    // 9:59 → 10:00 was 4 chars → 5 chars unpadded, which grew the clock.
    expect(formatDuration(9 * 60_000 + 59_000)).toBe("09:59");
    expect(formatDuration(10 * 60_000)).toBe("10:00");
    expect(formatDuration(9 * 60_000 + 59_000)).toHaveLength(5);
    expect(formatDuration(10 * 60_000)).toHaveLength(5);
  });

  it("floors to whole seconds and clamps negatives to zero", () => {
    expect(formatDuration(1_999)).toBe("00:01");
    expect(formatDuration(-5_000)).toBe("00:00");
  });

  it("rolls minutes past 99 rather than truncating (accepted width growth)", () => {
    // No oral-translation segment reaches this; asserted so the behaviour is
    // recorded rather than assumed.
    expect(formatDuration(100 * 60_000)).toBe("100:00");
  });
});

/**
 * `filenameSafe` guards the export boundary (G3). A book name is free text
 * since #264, and it flows into the Share `.mp3` filename, the Share-Book `.zip`
 * File name, and every zip entry name. A `/` in "Mark/Luke" would otherwise
 * split a zip entry into a folder — a corrupt archive — and `: * ? " < > |`
 * are illegal filename characters on common filesystems.
 */
describe("filenameSafe", () => {
  it("replaces path separators so a name cannot become a folder", () => {
    // The vector this whole helper exists for: a `/` or `\` in a zip entry name
    // is a path separator, not a character.
    expect(filenameSafe("Mark/Luke")).toBe("Mark Luke");
    expect(filenameSafe("Mark\\Luke")).toBe("Mark Luke");
  });

  it("replaces the filesystem-reserved characters", () => {
    expect(filenameSafe('a:b*c?d"e<f>g|h')).toBe("a b c d e f g h");
  });

  it("strips control characters", () => {
    // Built with fromCharCode so no literal control byte sits in this source.
    const withControls = `Mark${String.fromCharCode(0, 31)}6`;
    expect(filenameSafe(withControls)).toBe("Mark 6");
  });

  it("keeps ordinary letters, digits, spaces, hyphens, and brackets", () => {
    expect(filenameSafe("Mark 6")).toBe("Mark 6");
    expect(filenameSafe("1 John - part 2")).toBe("1 John - part 2");
  });

  it("collapses the whitespace it introduces and trims the ends", () => {
    expect(filenameSafe("  Mark // Luke  ")).toBe("Mark Luke");
  });
});

/** #1233 item 22: a label is capped by UTF-8 bytes, at a grapheme boundary. */
describe("filenameSafe byte cap", () => {
  const bytes = (s: string): number => new TextEncoder().encode(s).length;

  it("caps an 80-character Ge'ez label inside the per-label byte budget", () => {
    const geez = "ሰላም".repeat(27).slice(0, 80);
    expect(bytes(geez)).toBeGreaterThan(FILENAME_LABEL_MAX_BYTES);
    const out = filenameSafe(geez);
    expect(bytes(out)).toBeLessThanOrEqual(FILENAME_LABEL_MAX_BYTES);
    expect(out.length).toBeGreaterThan(0);
    expect(geez.startsWith(out)).toBe(true);
  });

  it("keeps a worst-case book and chapter filename under 255 bytes with .mp3 intact", () => {
    const geez = "ሰላም".repeat(27).slice(0, 80);
    const name = `${filenameSafe(geez)} - ${filenameSafe(geez)}.mp3`;
    expect(bytes(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith(".mp3")).toBe(true);
  });

  it("never cuts between a base letter and its combining marks", () => {
    // Each grapheme is "e" + U+0301 = 3 bytes; 41 of them is 123 bytes, so the
    // cap (120) falls exactly after the 40th grapheme, and a cut at a code-unit
    // or code-point boundary would strand a bare accent or split the pair.
    const accented = "é".repeat(41);
    const out = filenameSafe(accented);
    expect(out).toBe("é".repeat(40));
    // A budget that lands mid-grapheme: 119 bytes of ASCII then one pair.
    const mid = `${"a".repeat(119)}é`;
    expect(filenameSafe(mid)).toBe("a".repeat(119));
  });

  it("leaves a label within the cap untouched", () => {
    const exact = "a".repeat(FILENAME_LABEL_MAX_BYTES);
    expect(filenameSafe(exact)).toBe(exact);
  });

  it("does not leave a trailing space where the cut falls", () => {
    const label = `${"a".repeat(FILENAME_LABEL_MAX_BYTES - 1)} bcd`;
    expect(filenameSafe(label)).toBe("a".repeat(FILENAME_LABEL_MAX_BYTES - 1));
  });
});

/**
 * The build targets Firefox 114, which has no `Intl.Segmenter` (shipped in
 * 125): the module must load without it, and the cap must still hold.
 */
describe("filenameSafe without Intl.Segmenter", () => {
  const bytes = (s: string): number => new TextEncoder().encode(s).length;

  async function loadWithoutSegmenter(): Promise<typeof import("@/lib/utils")> {
    vi.resetModules();
    vi.stubGlobal(
      "Intl",
      Object.create(Intl, { Segmenter: { value: undefined } })
    );
    return import("@/lib/utils");
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("importing the module does not throw", async () => {
    await expect(loadWithoutSegmenter()).resolves.toBeDefined();
  });

  it("still caps by bytes, keeps .mp3, and never emits a lone surrogate", async () => {
    const mod = await loadWithoutSegmenter();
    // 4-byte astral code points: 31 of them is 124 bytes, over the cap.
    const label = "\u{1F600}".repeat(31);
    const out = mod.filenameSafe(label);
    expect(bytes(out)).toBeLessThanOrEqual(mod.FILENAME_LABEL_MAX_BYTES);
    expect(out).toBe("\u{1F600}".repeat(30));
    expect(out).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    );
    const name = `${out} - ${mod.filenameSafe("ሰላም".repeat(27))}.mp3`;
    expect(bytes(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith(".mp3")).toBe(true);
  });
});
