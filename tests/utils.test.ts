import { describe, expect, it } from "vitest";

import { filenameSafe, formatDuration } from "@/lib/utils";

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
