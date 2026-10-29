import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TemplateValidationError,
  parseTemplatePackage,
  parseTemplateTitleTable,
  templateRef,
  titleFor,
} from "@/lib/templates/validate";
import type { TemplatePackage } from "@/types/template";
import { stripComments } from "./support";

/**
 * Template package v0 (#1465): one source-agnostic shape and its validator.
 * The fixtures are small and invented, except `bible-passages-TIT.json`, a
 * pinned copy of a real dataset package that
 * `tests/template-bible-passages-fixture.test.ts` covers. The
 * fourth source (`hymnal-min.json`) exists to show that a source nobody wrote
 * code for goes through the same validator unchanged.
 */

const FIXTURES = path.join(__dirname, "fixtures", "templates");
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Record<
    string,
    unknown
  >;

type Step = string | number;
type Edit = readonly [readonly Step[], unknown];

/** A deep copy of a fixture with each `[path, value]` edit applied, for the validator to refuse. */
function broken(name: string, ...edits: Edit[]): unknown {
  const pkg: unknown = structuredClone(load(name));
  for (const [steps, value] of edits) {
    let at: unknown = pkg;
    for (const step of steps.slice(0, -1)) {
      at = (at as Record<Step, unknown>)[step];
    }
    (at as Record<Step, unknown>)[steps[steps.length - 1] as Step] = value;
  }
  return pkg;
}

function refusal(input: unknown): TemplateValidationError {
  try {
    parseTemplatePackage(input);
  } catch (cause) {
    expect(cause).toBeInstanceOf(TemplateValidationError);
    return cause as TemplateValidationError;
  }
  throw new Error("expected the package to be refused");
}

/** The title-table reader's refusal, which must be a `TemplateValidationError`. */
function tableRefusal(
  input: unknown,
  pkg: TemplatePackage
): TemplateValidationError {
  try {
    parseTemplateTitleTable(input, pkg);
  } catch (cause) {
    expect(cause).toBeInstanceOf(TemplateValidationError);
    return cause as TemplateValidationError;
  }
  throw new Error("expected the title table to be refused");
}

const SOURCES = [
  "obs-min.json",
  "bible-book-min.json",
  "collection-min.json",
  "hymnal-min.json",
];

describe("parseTemplatePackage: fixtures", () => {
  it.each(SOURCES)("%s parses", (name) => {
    const pkg = parseTemplatePackage(load(name));
    expect(pkg.format).toBe("tc-mobile-template");
    expect(pkg.chapters.length).toBeGreaterThan(0);
  });

  it("keeps a cross-chapter span and a null-reference intro as written", () => {
    const pkg = parseTemplatePackage(load("collection-min.json"));
    const segments = pkg.chapters.flatMap((c) => c.segments);
    expect(segments[0]?.reference).toBeNull();
    expect(segments[1]?.reference).toEqual({
      book: "PSA",
      startChapter: 17,
      startVerse: 50,
      endChapter: 18,
      endVerse: 1,
    });
  });

  it("carries the package's own chapter number through, not its position", () => {
    const pkg = parseTemplatePackage(load("hymnal-min.json"));
    expect(pkg.chapters[0]?.number).toBe(12);
  });

  it("the same code accepts a kind it has never heard of", () => {
    const pkg = parseTemplatePackage(load("hymnal-min.json"));
    expect(templateRef(pkg)).toEqual({
      id: "hymnal:fixture",
      version: "0.1.0",
      kind: "hymnal",
    });
  });

  it("every fixture on disk is covered by a case here", () => {
    const packages = readdirSync(FIXTURES).filter(
      (f) => f.endsWith(".json") && !f.startsWith("titles-")
    );
    const covered = new Set([
      ...SOURCES,
      "pair-v0.1.0.json",
      "pair-v0.2.0.json",
      // Covered in tests/template-bible-passages-fixture.test.ts (#1450).
      "bible-passages-TIT.json",
    ]);
    expect(packages.filter((f) => !covered.has(f))).toEqual([]);
  });

  it("refuses something that is not an object", () => {
    for (const input of [null, 3, "x", [], undefined]) {
      expect(refusal(input).field).toBe("package");
    }
  });
});

describe("parseTemplatePackage: each violation names its field", () => {
  const SEG0 = ["chapters", 0, "segments", 0] as const;
  const REF = [...SEG0, "reference"] as const;

  it("duplicate segment key", () => {
    const err = refusal(
      broken("obs-min.json", [["chapters", 1, "segments", 0, "key"], "01-01"])
    );
    expect(err.field).toBe("chapters[1].segments[0].key");
    expect(err.message).toContain("duplicate");
  });

  it("duplicate chapter key", () => {
    const err = refusal(broken("obs-min.json", [["chapters", 1, "key"], "01"]));
    expect(err.field).toBe("chapters[1].key");
  });

  it("span ending before it starts (verses in one chapter)", () => {
    const err = refusal(
      broken(
        "bible-book-min.json",
        [[...REF, "startChapter"], 2],
        [[...REF, "endChapter"], 2],
        [[...REF, "startVerse"], 5],
        [[...REF, "endVerse"], 3]
      )
    );
    expect(err.field).toBe("chapters[0].segments[0].reference");
    expect(err.message).toContain("2:5-2:3");
  });

  it("span ending in an earlier chapter", () => {
    const err = refusal(
      broken("collection-min.json", [
        ["chapters", 0, "segments", 1, "reference", "endChapter"],
        16,
      ])
    );
    expect(err.field).toBe("chapters[0].segments[1].reference");
  });

  it("one verse null and the other a number", () => {
    const err = refusal(
      broken("collection-min.json", [
        ["chapters", 1, "segments", 0, "reference", "endVerse"],
        3,
      ])
    );
    expect(err.field).toBe("chapters[1].segments[0].reference");
  });

  it("a zero or fractional chapter or verse", () => {
    for (const [prop, value] of [
      ["startChapter", 0],
      ["startVerse", 0],
      ["endVerse", 1.5],
    ] as const) {
      const err = refusal(
        broken("bible-book-min.json", [[...REF, prop], value])
      );
      expect(err.field).toBe(`chapters[0].segments[0].reference.${prop}`);
    }
  });

  it("recordingLicence other than CC-BY-SA-4.0", () => {
    const err = refusal(
      broken("obs-min.json", [["recordingLicence"], "CC0-1.0"])
    );
    expect(err.field).toBe("recordingLicence");
  });

  it("a package title language not in titleLanguages", () => {
    const err = refusal(broken("obs-min.json", [["title", "fr"], "Histoires"]));
    expect(err.field).toBe("title.fr");
  });

  it("an empty chapter", () => {
    const err = refusal(
      broken("obs-min.json", [["chapters", 1, "segments"], []])
    );
    expect(err.field).toBe("chapters[1].segments");
  });

  it("no chapters at all", () => {
    const err = refusal(broken("obs-min.json", [["chapters"], []]));
    expect(err.field).toBe("chapters");
  });

  it("an unknown formatVersion", () => {
    const err = refusal(broken("obs-min.json", [["formatVersion"], 1]));
    expect(err.field).toBe("formatVersion");
  });

  it("a chapter number that is not a positive integer, or is repeated", () => {
    const zero = refusal(
      broken("obs-min.json", [["chapters", 0, "number"], 0])
    );
    expect(zero.field).toBe("chapters[0].number");
    const repeat = refusal(
      broken("obs-min.json", [["chapters", 1, "number"], 1])
    );
    expect(repeat.field).toBe("chapters[1].number");
  });

  it("a missing chapter number (R7: always a real number)", () => {
    const err = refusal(
      broken("obs-min.json", [["chapters", 0, "number"], null])
    );
    expect(err.field).toBe("chapters[0].number");
  });

  it("a wrong format tag, a bad version, an empty attribution", () => {
    expect(refusal(broken("obs-min.json", [["format"], "other"])).field).toBe(
      "format"
    );
    expect(refusal(broken("obs-min.json", [["version"], "1.0"])).field).toBe(
      "version"
    );
    expect(refusal(broken("obs-min.json", [["attribution"], " "])).field).toBe(
      "attribution"
    );
  });

  it("a source url that is not http(s)", () => {
    const err = refusal(
      broken("obs-min.json", [["source", "url"], "javascript:alert(1)"])
    );
    expect(err.field).toBe("source.url");
  });

  it("a thumbnail that is neither null nor a non-empty string", () => {
    const err = refusal(broken("obs-min.json", [[...SEG0, "thumbnail"], ""]));
    expect(err.field).toBe("chapters[0].segments[0].thumbnail");
  });

  it.each([
    "https://example.org/a.jpg",
    "javascript:alert(1)",
    "/obs/01-01.jpg",
    "../x.jpg",
    "obs/../../x.jpg",
    "obs\\01-01.jpg",
  ])("a thumbnail that is not a relative asset path: %s", (value) => {
    const err = refusal(
      broken("obs-min.json", [[...SEG0, "thumbnail"], value])
    );
    expect(err.field).toBe("chapters[0].segments[0].thumbnail");
  });

  it.each([
    "1.0.0+build.1",
    "1.0.0-rc.1+sha.5114f85",
    "0.0.0-alpha-1",
    "10.20.30",
  ])("accepts a SemVer 2.0.0 version: %s", (version) => {
    const pkg = parseTemplatePackage(
      broken("obs-min.json", [["version"], version])
    );
    expect(pkg.version).toBe(version);
  });

  it.each(["01.0.0", "1.0.0-01", "1.0.0-..", "1.0.0-", "1.0.0+", "1.0.0+a..b"])(
    "refuses a version SemVer does not allow: %s",
    (version) => {
      const err = refusal(broken("obs-min.json", [["version"], version]));
      expect(err.field).toBe("version");
    }
  );

  it.each([
    "en-x-local",
    "de-DE-u-co-phonebk",
    "zh-Hant-TW",
    "es-419",
    "x-private",
    "sl-rozaj-biske",
  ])("accepts a well-formed BCP-47 tag: %s", (tag) => {
    const pkg = parseTemplatePackage(
      broken(
        "obs-min.json",
        [["titleLanguages"], [tag]],
        [["title"], { [tag]: "T" }]
      )
    );
    expect(pkg.titleLanguages).toEqual([tag]);
  });

  it.each([
    "e",
    "en-",
    "en--US",
    "en-x",
    "en-u",
    "en-US-US",
    "en_US",
    "toolongtag",
  ])("refuses a malformed BCP-47 tag: %s", (tag) => {
    const err = refusal(broken("obs-min.json", [["titleLanguages"], [tag]]));
    expect(err.field).toBe("titleLanguages[0]");
  });

  it("refuses one language listed twice in different case", () => {
    const err = refusal(
      broken("obs-min.json", [["titleLanguages"], ["en", "EN"]])
    );
    expect(err.field).toBe("titleLanguages[1]");
  });
});

describe("title tables", () => {
  const pkg = parseTemplatePackage(load("collection-min.json"));

  it("parses a table whose language the package lists", () => {
    const table = parseTemplateTitleTable(
      load("titles-collection-min.es.json"),
      pkg
    );
    expect(titleFor(table, "chapters", "songs")).toBe("Cantos");
  });

  // Each refusal is a TemplateValidationError whose `field` is asserted, as
  // the package refusals are, not a message matched by a regex (#1747).
  it("refuses something that is not an object", () => {
    for (const input of [null, 3, "x", [], undefined]) {
      expect(tableRefusal(input, pkg).field).toBe("titleTable");
    }
  });

  it("refuses a table whose language is not in titleLanguages", () => {
    const input = { ...load("titles-collection-min.es.json"), language: "de" };
    expect(tableRefusal(input, pkg).field).toBe("language");
  });

  it("refuses a table for another package or version", () => {
    const base = load("titles-collection-min.es.json");
    expect(tableRefusal({ ...base, packageId: "other" }, pkg).field).toBe(
      "packageId"
    );
    expect(tableRefusal({ ...base, version: "9.9.9" }, pkg).field).toBe(
      "version"
    );
  });

  it("refuses a title for a key the package does not have", () => {
    const input = {
      ...load("titles-collection-min.es.json"),
      segments: { intro: "Introducción", ghost: "Boo" },
    };
    expect(tableRefusal(input, pkg).field).toBe("segments.ghost");
  });

  it("refuses an empty title", () => {
    const input = {
      ...load("titles-collection-min.es.json"),
      chapters: { songs: "" },
    };
    expect(tableRefusal(input, pkg).field).toBe("chapters.songs");
  });

  it("answers null for a missing key, a null key and an inherited name", () => {
    const table = parseTemplateTitleTable(
      load("titles-collection-min.es.json"),
      pkg
    );
    expect(titleFor(table, "segments", "whole")).toBeNull();
    expect(titleFor(table, "segments", null)).toBeNull();
    expect(titleFor(table, "segments", "constructor")).toBeNull();
    expect(titleFor(null, "chapters", "songs")).toBeNull();
  });
});

describe("a key that goes missing between versions", () => {
  const v1 = parseTemplatePackage(load("pair-v0.1.0.json"));
  const v2 = parseTemplatePackage(load("pair-v0.2.0.json"));
  const t1 = parseTemplateTitleTable(load("titles-pair-v0.1.0.en.json"), v1);
  const t2 = parseTemplateTitleTable(load("titles-pair-v0.2.0.en.json"), v2);

  it("both versions are valid packages of one id", () => {
    expect(v1.id).toBe(v2.id);
    expect(v1.version).not.toBe(v2.version);
  });

  it("a book keyed s2 reads no title from v0.2.0, and nothing throws", () => {
    expect(titleFor(t1, "segments", "s2")).toBe("Two");
    expect(titleFor(t2, "segments", "s2")).toBeNull();
    expect(titleFor(t2, "segments", "s1")).toBe("One");
  });

  it("the old table is refused against the new package, not applied to it", () => {
    expect(() =>
      parseTemplateTitleTable(load("titles-pair-v0.1.0.en.json"), v2)
    ).toThrow(/version/);
  });
});

describe("source-agnostic by construction", () => {
  const ROOT = path.join(__dirname, "..");
  const files = ["src/types/template.ts", "src/lib/templates/validate.ts"].map(
    (f) => {
      const raw = readFileSync(path.join(ROOT, f), "utf8");
      return { f, raw, code: stripComments(raw) };
    }
  );

  it("reads non-empty code in both files", () => {
    for (const { code } of files) expect(code.length).toBeGreaterThan(500);
  });

  it("names no source, testament or dataset in code", () => {
    // Comments are stripped first; a name in prose explaining the rule is
    // fine, a name in a branch or a type is the defect.
    const named =
      /\bobs\b|open bible|bible|testament|\bnt\b|\bot\b|passages|stories|scripture|psalm|gospel/i;
    for (const { f, code } of files) {
      expect({ f, hit: named.exec(code)?.[0] ?? null }).toEqual({
        f,
        hit: null,
      });
    }
  });

  it("holds no `//` inside a string, so the comment strip is sound", () => {
    for (const { raw } of files) {
      expect(raw).not.toMatch(/["'`][^"'`\n]*(\/\/|\/\*)[^"'`\n]*["'`]/);
    }
  });
});

describe("hardening from the #1507 review (#1747)", () => {
  // Item 1: a string is stored exactly as it was checked, so a padded one is
  // refused rather than checked trimmed and stored padded.
  it.each([
    [["source", "url"], " https://example.org/obs", "source.url"],
    [["source", "url"], "https://example.org/obs\n", "source.url"],
    [["attribution"], "Fixture credit ", "attribution"],
    [["title", "en"], "\tStories", "title.en"],
    [["source", "revision"], " r1", "source.revision"],
  ] as const)("refuses a padded string at %j", (steps, value, field) => {
    const err = refusal(broken("obs-min.json", [steps, value]));
    expect(err.field).toBe(field);
  });

  it("refuses a padded title in a title table", () => {
    const pkg = parseTemplatePackage(load("collection-min.json"));
    const input = {
      ...load("titles-collection-min.es.json"),
      chapters: { songs: "Cantos " },
    };
    expect(tableRefusal(input, pkg).field).toBe("chapters.songs");
  });

  // Item 2: every refusal is a TemplateValidationError, even for a value
  // JSON.stringify cannot print.
  it("refuses a bigint or cyclic formatVersion with a TemplateValidationError", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    for (const value of [1n, cyclic]) {
      const err = refusal(broken("obs-min.json", [["formatVersion"], value]));
      expect(err.field).toBe("formatVersion");
    }
  });

  // Item 3: a fixture comes back whole, not just with the right tag and a
  // chapter count.
  it.each(SOURCES)("%s comes back deep-equal to the file", (name) => {
    expect(parseTemplatePackage(load(name))).toStrictEqual(load(name));
  });

  it("the code compares no kind or code with a source's own value", () => {
    // The denylist above names sources in words; this reads the fixtures'
    // own ids, kinds and codes, so `kind === "hymnal"` is caught too.
    const ROOT = path.join(__dirname, "..");
    const values = new Set<string>();
    const packages = readdirSync(FIXTURES).filter(
      (n) => n.endsWith(".json") && !n.startsWith("titles-")
    );
    for (const f of packages) {
      const p = parseTemplatePackage(load(f));
      values.add(p.id).add(p.kind);
      if (p.bookCode !== null) values.add(p.bookCode);
      for (const s of p.chapters.flatMap((c) => c.segments)) {
        if (s.reference !== null) values.add(s.reference.book);
      }
    }
    expect(values.size).toBeGreaterThan(5);
    // A comparison with a string literal, either way round, or a switch. A
    // null check (`r["bookCode"] === null`) is a shape check, not a branch.
    const branch =
      /\b(?:kind|bookCode|book)\b["'\]]*\s*[!=]==?\s*["'`]|["'`]\s*[!=]==?\s*[\w.[\]"']*\b(?:kind|bookCode|book)\b|switch\s*\(\s*[\w.[\]"']*\b(?:kind|bookCode|book)\b/;
    for (const f of [
      "src/types/template.ts",
      "src/lib/templates/validate.ts",
    ]) {
      const code = stripComments(readFileSync(path.join(ROOT, f), "utf8"));
      const literals = [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(
        (m) => m[1] ?? m[2] ?? ""
      );
      expect({ f, hits: literals.filter((l) => values.has(l)) }).toEqual({
        f,
        hits: [],
      });
      expect({ f, hit: branch.exec(code)?.[0] ?? null }).toEqual({
        f,
        hit: null,
      });
    }
  });

  // Item 4: chapter keys and segment keys are separate namespaces. Both stay
  // unique within their own set; one may equal the other.
  it("a chapter key may equal a segment key, and each title scope reads its own", () => {
    const pkg = parseTemplatePackage(
      broken("pair-v0.1.0.json", [["chapters", 0, "key"], "s1"])
    );
    expect(pkg.chapters[0]?.key).toBe("s1");
    expect(pkg.chapters[0]?.segments[0]?.key).toBe("s1");
    const table = parseTemplateTitleTable(
      {
        packageId: pkg.id,
        version: pkg.version,
        language: "en",
        chapters: { s1: "Chapter" },
        segments: { s1: "Segment" },
      },
      pkg
    );
    expect(titleFor(table, "chapters", "s1")).toBe("Chapter");
    expect(titleFor(table, "segments", "s1")).toBe("Segment");
  });

  // Item 5: the data licence is one of the ids the app knows (`LicenceId`).
  it.each(["CC-BY-SA-4.0", "CC-BY-4.0", "CC0-1.0", "all-rights-reserved"])(
    "accepts dataLicence %s",
    (id) => {
      const pkg = parseTemplatePackage(
        broken("obs-min.json", [["dataLicence"], id])
      );
      expect(pkg.dataLicence).toBe(id);
    }
  );

  it.each(["CC BY-SA 4.0", "MIT", "cc-by-sa-4.0", "toString", "constructor"])(
    "refuses dataLicence %s",
    (value) => {
      const err = refusal(broken("obs-min.json", [["dataLicence"], value]));
      expect(err.field).toBe("dataLicence");
    }
  );
});
