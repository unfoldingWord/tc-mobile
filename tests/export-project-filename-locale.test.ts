import { describe, expect, it } from "vitest";

import { buildTable } from "@/lib/i18n/locales";
import { stringsEn } from "@/lib/strings";
import { FILENAME_LABEL_MAX_BYTES } from "@/lib/utils";

/**
 * #1627, the first half of the requirements owner's decision
 * ("phone-language"): the suffix after the book name in the Export project
 * file name follows the phone's language, the way Share Book's chapter file
 * names do. The book name from the dataset is the other half and is not built.
 * The suffix words are AI drafts, like the rest of each table.
 */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["es", "Mark - proyecto.zip"],
  ["fr", "Mark - projet.zip"],
  ["hi", "Mark - प्रोजेक्ट.zip"],
  ["id", "Mark - proyek.zip"],
  ["pt", "Mark - projeto.zip"],
  ["ru", "Mark - проект.zip"],
  ["sw", "Mark - mradi.zip"],
];

describe("Export project file name follows the app's language (#1627)", () => {
  it("keeps the English name on English", () => {
    expect(stringsEn.exportProjectFilename("Mark")).toBe("Mark - project.zip");
  });

  it.each(EXPECTED)("%s gets its own suffix", (tag, name) => {
    expect(buildTable(tag).exportProjectFilename("Mark")).toBe(name);
  });

  it("stays filename-safe and inside the byte cap on a long book name", () => {
    for (const [tag] of EXPECTED) {
      const name = buildTable(tag).exportProjectFilename(
        "///" + "é".repeat(300)
      );
      expect(name).not.toMatch(/[/\\:*?"<>|]/);
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(
        FILENAME_LABEL_MAX_BYTES * 2 + 7
      );
    }
  });
});
