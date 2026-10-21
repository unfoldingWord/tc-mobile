import { describe, expect, it } from "vitest";

import { licenceLabel, licenceTag } from "@/lib/export/licence-tag";
import { strings } from "@/lib/strings";
import type { LicenceId } from "@/types/template";

/**
 * #1566 (D5, S19): a shared file's name carries the book's licence when it is
 * one of the three Creative Commons ids, and nothing otherwise.
 */

const CC: ReadonlyArray<[LicenceId, string]> = [
  ["CC-BY-SA-4.0", "CC BY-SA 4.0"],
  ["CC-BY-4.0", "CC BY 4.0"],
  ["CC0-1.0", "CC0 1.0"],
];
const bytes = (s: string): number => new TextEncoder().encode(s).length;

describe("licenceLabel / licenceTag", () => {
  it.each(CC)("%s has the label %s", (id, label) => {
    expect(licenceLabel(id)).toBe(label);
    expect(licenceTag(id)).toBe(` (${label})`);
  });
  it("has no label for null and for all-rights-reserved", () => {
    expect(licenceLabel(null)).toBeNull();
    expect(licenceLabel("all-rights-reserved")).toBeNull();
    expect(licenceTag(null)).toBe("");
    expect(licenceTag("all-rights-reserved")).toBe("");
  });
});

describe("share filenames carry the tag before the extension", () => {
  it.each(CC)("chapter file, %s", (id, label) => {
    expect(strings.shareFilename("Mark", 6, "The sower", 6, id)).toBe(
      `Mark - 06 The sower (${label}).mp3`
    );
  });
  it.each(CC)("book zip, %s", (id, label) => {
    expect(strings.shareBookFilename("Mark", id)).toBe(`Mark (${label}).zip`);
  });
  it("the default chapter name takes the tag too", () => {
    expect(strings.shareFilename("Mark", 3, null, 3, "CC0-1.0")).toBe(
      `Mark - 03 ${strings.chapterName(3)} (CC0 1.0).mp3`
    );
  });
  it("is byte-identical to the untagged name for null and all-rights-reserved", () => {
    for (const id of [null, "all-rights-reserved"] as const) {
      expect(strings.shareFilename("Mark", 6, "The sower", 6, id)).toBe(
        strings.shareFilename("Mark", 6, "The sower")
      );
      expect(strings.shareBookFilename("Mark", id)).toBe(
        strings.shareBookFilename("Mark")
      );
    }
  });
  it("stays within 255 bytes with two long labels and the longest tag", () => {
    const long = "ሀ".repeat(200);
    for (const id of ["CC-BY-SA-4.0", "CC-BY-4.0", "CC0-1.0"] as const) {
      const name = strings.shareFilename(long, 7, long, 150, id);
      expect(bytes(name)).toBeLessThanOrEqual(255);
      expect(name.endsWith(`${licenceTag(id)}.mp3`)).toBe(true);
      expect(bytes(strings.shareBookFilename(long, id))).toBeLessThanOrEqual(
        255
      );
    }
  });
});
