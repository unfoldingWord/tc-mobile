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
import { stripComments } from "./support";

/**
 * Template package v0 (#1465): one source-agnostic shape and its validator.
 * The fixtures are small and invented; none of them is a real dataset. The
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

  it("refuses a table whose language is not in titleLanguages", () => {
    const input = { ...load("titles-collection-min.es.json"), language: "de" };
    expect(() => parseTemplateTitleTable(input, pkg)).toThrow(/language/);
  });

  it("refuses a table for another package or version", () => {
    const base = load("titles-collection-min.es.json");
    expect(() =>
      parseTemplateTitleTable({ ...base, packageId: "other" }, pkg)
    ).toThrow(/packageId/);
    expect(() =>
      parseTemplateTitleTable({ ...base, version: "9.9.9" }, pkg)
    ).toThrow(/version/);
  });

  it("refuses a title for a key the package does not have", () => {
    const input = {
      ...load("titles-collection-min.es.json"),
      segments: { intro: "Introducción", ghost: "Boo" },
    };
    expect(() => parseTemplateTitleTable(input, pkg)).toThrow(
      /segments\.ghost/
    );
  });

  it("refuses an empty title", () => {
    const input = {
      ...load("titles-collection-min.es.json"),
      chapters: { songs: "" },
    };
    expect(() => parseTemplateTitleTable(input, pkg)).toThrow(
      /chapters\.songs/
    );
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
