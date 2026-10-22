import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contentAttribution, licenseTexts } from "@/components/licenses";
import committed from "@/data/language-list.json";
import {
  foldForSearch,
  indexLanguageList,
  loadLanguageList,
  searchLanguages,
} from "@/lib/languages/list";

import {
  LANGTAGS_VERSION,
  buildLanguageList,
  serialiseLanguageList,
} from "../scripts/build-language-list.mjs";

/**
 * The bundled language list (#1492, ADR 0017): the generator's output shape,
 * the committed file it produced, and the search the language ask runs.
 */

const ROWS = [
  { tag: "_globalvar", variants: ["simple"] },
  {
    tag: "fr",
    full: "fr-Latn-FR",
    name: "French",
    localname: "français",
    names: ["Francés"],
    regions: ["BE"],
  },
  { tag: "en", name: "English", localname: "English" },
  { tag: "aak", name: "Ankave", localnames: ["Aga pɨ'ne'"] },
  { tag: "xx-old", name: "Old", obsolete: true },
  { tag: "noname" },
  { tag: "sr-Latn", name: "Serbian", localname: "srpski" },
  { tag: "sr", name: "Serbian", localname: "српски" },
  { tag: "ewe", name: "Éwé" },
  { tag: "kud", name: "’Auhelawa" },
];

describe("buildLanguageList", () => {
  it("keeps tag, name and autonym only, drops bookkeeping, obsolete and nameless rows, and orders by folded name (leading punctuation ignored) then tag", () => {
    expect(buildLanguageList(ROWS, "1.0")).toEqual({
      source: "SIL langtags 1.0",
      languages: [
        ["aak", "Ankave", "Aga pɨ'ne'"],
        ["kud", "’Auhelawa"],
        ["en", "English"],
        ["ewe", "Éwé"],
        ["fr", "French", "français"],
        ["sr", "Serbian", "српски"],
        ["sr-Latn", "Serbian", "srpski"],
      ],
    });
  });

  it("refuses a release that repeats a tag", () => {
    expect(() =>
      buildLanguageList([
        { tag: "en", name: "English" },
        { tag: "en", name: "English" },
      ])
    ).toThrow(/repeats the tag en/);
  });

  it("writes one language per line", () => {
    expect(
      serialiseLanguageList({
        source: "SIL langtags 1.0",
        languages: [
          ["en", "English"],
          ["fr", "French", "français"],
        ],
      })
    ).toBe(
      '{"source":"SIL langtags 1.0","languages":[\n["en","English"],\n["fr","French","français"]\n]}\n'
    );
  });
});

describe("the committed list", () => {
  const file = committed as { source: string; languages: string[][] };

  it("was built from the pinned release", () => {
    expect(file.source).toBe(`SIL langtags ${LANGTAGS_VERSION}`);
  });

  it("holds rows of two or three non-empty strings, unique tags, none of them bookkeeping", () => {
    expect(file.languages.length).toBeGreaterThan(9000);
    const tags = new Set<string>();
    for (const row of file.languages) {
      expect([2, 3]).toContain(row.length);
      for (const cell of row) expect(cell.trim()).not.toBe("");
      const [tag] = row as [string];
      expect(tag.startsWith("_")).toBe(false);
      expect(tags.has(tag)).toBe(false);
      tags.add(tag);
    }
    for (const tag of ["en", "fr", "es", "pt", "id", "sw", "tpi"]) {
      expect(tags.has(tag), tag).toBe(true);
    }
  });
});

describe("searchLanguages", () => {
  const list = indexLanguageList(buildLanguageList(ROWS, "1.0"));
  const tags = (query: string, limit = 50) =>
    searchLanguages(list, query, limit).matches.map((m) => m.tag);

  it("folds case and accents", () => {
    expect(foldForSearch("  Français ")).toBe("francais");
    expect(tags("FRANCAIS")).toEqual(["fr"]);
    expect(tags("ewe")).toEqual(["ewe"]);
  });

  it("matches the tag, the English name and the autonym", () => {
    expect(tags("aak")).toEqual(["aak"]);
    expect(tags("ankave")).toEqual(["aak"]);
    expect(tags("aga")).toEqual(["aak"]);
    expect(tags("срп")).toEqual(["sr"]);
  });

  it("ranks the exact tag first, then name starts, then words, then tag starts, then the rest", () => {
    // "sr": the tag itself, then sr-Latn by its tag's start and its autonym.
    expect(tags("sr")).toEqual(["sr", "sr-Latn"]);
    // "en": the tag, then French, which only contains it.
    expect(tags("en")).toEqual(["en", "fr"]);
    // A word inside the autonym ("Aga pɨ'ne'") starts with "ne".
    expect(tags("ne")).toEqual(["aak"]);
  });

  it("caps the rows and still counts every match", () => {
    const all = searchLanguages(list, "", 2);
    expect(all.matches.map((m) => m.tag)).toEqual(["aak", "kud"]);
    expect(all.total).toBe(7);
    const some = searchLanguages(list, "e", 2);
    expect(some.matches).toHaveLength(2);
    expect(some.total).toBeGreaterThan(2);
    expect(searchLanguages(list, "zzz", 2)).toEqual({ matches: [], total: 0 });
  });

  it("returns the autonym, or null where the list has none", () => {
    const [english] = searchLanguages(list, "english", 1).matches;
    expect(english).toEqual(
      expect.objectContaining({ tag: "en", name: "English", autonym: null })
    );
  });
});

describe("loadLanguageList", () => {
  it("loads the committed list once", async () => {
    const first = await loadLanguageList();
    expect(await loadLanguageList()).toBe(first);
    expect(first.entries.length).toBe(
      (committed as { languages: unknown[] }).languages.length
    );
    expect(searchLanguages(first, "swahili", 5).matches[0]?.tag).toMatch(/^sw/);
  });
});

describe("the list's licence (ADR 0017)", () => {
  it("ships SIL's MIT text and lists it, with an attribution, in About & licenses", () => {
    const href = "/licenses/SIL-LANGTAGS-MIT.txt";
    expect(licenseTexts.map((t) => t.href)).toContain(href);
    const text = readFileSync(`public${href}`, "utf8");
    expect(text).toContain("Copyright (c) 2019-2025 SIL International");
    expect(text).toContain("Released under the MIT license");
    expect(text).toContain("Permission is hereby granted, free of charge");
    expect(contentAttribution).toContainEqual(
      expect.objectContaining({
        what: "Language data",
        holder: expect.stringContaining("SIL International"),
        license: "MIT",
      })
    );
  });
});
