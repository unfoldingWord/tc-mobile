import { describe, expect, it, vi } from "vitest";

import { LOCALES } from "@/lib/locale";
import { LOCALE_OVERRIDES, buildTable } from "@/lib/i18n/locales";
import { ENFORCE_COMPLETE, PENDING } from "@/lib/i18n/pending";
import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";

import {
  FUNCTION_ENTRIES,
  keyProblems,
  parityProblems,
  pluralProblems,
} from "./i18n-coverage";

/**
 * The build-time proof that a locale is complete (#1481, #357): every key is
 * present or pending, every plural covers the language's categories, and no
 * function entry drops an argument. Each check runs on the real tables and on
 * fixtures, one per defect, so a gate that cannot go red is seen failing.
 */

const recorded = vi.hoisted(() => [] as Array<Record<string, string>>);

vi.mock("@/lib/plural", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/plural")>();
  return {
    ...original,
    plural: (...args: Parameters<typeof original.plural>) => {
      recorded.push({ ...args[1] });
      return original.plural(...args);
    },
  };
});

const TAGS = LOCALES.map((locale) => locale.tag).filter((tag) => tag !== "en");

/** A fixture language: all of English, so it is complete. */
const complete = (): Partial<Strings> => ({ ...stringsEn });

describe("the registry", () => {
  it("has a table and a pending entry for each of the nine other languages", () => {
    expect(TAGS).toHaveLength(9);
    expect(Object.keys(LOCALE_OVERRIDES).sort()).toEqual([...TAGS].sort());
    expect(Object.keys(PENDING).sort()).toEqual([...TAGS].sort());
  });

  it("covers every function entry, so the checks below cannot be vacuous", () => {
    expect(FUNCTION_ENTRIES.length).toBeGreaterThan(60);
  });

  it("refuses a tag that is not a supported locale", () => {
    expect(() => buildTable("xx")).toThrow(/not a supported locale/);
  });
});

describe("the real tables", () => {
  for (const tag of TAGS) {
    const overrides = LOCALE_OVERRIDES[tag] ?? {};
    it(`${tag}: keys are present or pending, plurals and arguments hold`, () => {
      const table = buildTable(tag);
      const own = Object.keys(overrides);
      expect(
        keyProblems(tag, overrides, PENDING[tag] ?? [], ENFORCE_COMPLETE)
      ).toEqual([]);
      expect(pluralProblems(tag, table, own, recorded)).toEqual([]);
      expect(parityProblems(tag, table, own)).toEqual([]);
    });
  }

  it("the release gate is a plain constant", () => {
    // Flipping it is one reviewed commit; while false, pending may be set.
    if (ENFORCE_COMPLETE) {
      expect(
        Object.values(PENDING).every((p) => p !== "all" && p.length === 0)
      ).toBe(true);
    } else {
      expect(typeof ENFORCE_COMPLETE).toBe("boolean");
    }
  });
});

describe("the key check, in both states", () => {
  it("passes English only, a complete locale, and a locale with a pending list", () => {
    expect(keyProblems("fr", {}, "all", false)).toEqual([]);
    expect(keyProblems("fr", complete(), [], true)).toEqual([]);
    const { newBook, menuOpen, ...rest } = complete();
    void newBook;
    void menuOpen;
    expect(keyProblems("fr", rest, ["newBook", "menuOpen"], false)).toEqual([]);
  });

  it("fails a locale with an extra key", () => {
    expect(
      keyProblems(
        "fr",
        { ...complete(), bogus: "x" } as Partial<Strings>,
        [],
        false
      )
    ).toEqual(["fr: extra key bogus"]);
  });

  it("fails a key that is neither present nor pending", () => {
    const { newBook, ...rest } = complete();
    void newBook;
    expect(keyProblems("fr", rest, [], false)).toEqual([
      "fr: key newBook is neither present nor pending",
    ]);
  });

  it("fails a pending key that is present", () => {
    expect(keyProblems("fr", complete(), ["newBook"], false)).toEqual([
      "fr: pending key newBook is present",
    ]);
    expect(keyProblems("fr", { newBook: "Nouveau" }, "all", false)).toEqual([
      "fr: pending key newBook is present",
    ]);
  });

  it("fails an incomplete locale once the release gate is on", () => {
    const { newBook, ...rest } = complete();
    void newBook;
    expect(keyProblems("fr", rest, ["newBook"], true)).toEqual([
      "fr: 1 keys missing at release",
    ]);
  });
});

describe("the plural check, in both states", () => {
  const withForms = (forms: Record<string, string> & { other: string }) =>
    ({
      ...complete(),
      shareMissing(this: Strings, n: number): string {
        return this.couldNotBeIncluded(plural(n, forms));
      },
    }) as Partial<Strings>;

  it("passes French forms that carry one, many and other", () => {
    const fixture = withForms({
      one: "{n} segment",
      many: "{n} de segments",
      other: "{n} segments",
    });
    expect(
      pluralProblems(
        "fr",
        buildTable("fr", fixture),
        ["shareMissing"],
        recorded
      )
    ).toEqual([]);
  });

  it("fails French forms with no many", () => {
    const fixture = withForms({ one: "{n} segment", other: "{n} segments" });
    expect(
      pluralProblems(
        "fr",
        buildTable("fr", fixture),
        ["shareMissing"],
        recorded
      )
    ).toEqual(['fr: shareMissing has no "many" form']);
  });

  it("does not blame an entry for the forms of an English entry it calls", () => {
    // George r1 #1531: the callee's `plural()` is its own row's concern.
    const fixture = {
      shareBookPartial(this: Strings, n: number): string {
        const own = plural(n, { one: "un", many: "beaucoup", other: "des" });
        return `${own} ${this.shareMissing(n)}`;
      },
    } as Partial<Strings>;
    expect(
      pluralProblems(
        "fr",
        buildTable("fr", fixture),
        ["shareBookPartial"],
        recorded
      )
    ).toEqual([]);
  });
});

describe("the argument check, in both states", () => {
  it("passes an entry that keeps its argument", () => {
    const fixture: Partial<Strings> = {
      chapterName: (n: number) => `Chapitre ${n}`,
    };
    expect(
      parityProblems("fr", buildTable("fr", fixture), ["chapterName"])
    ).toEqual([]);
  });

  it("fails an entry that drops its argument", () => {
    const fixture: Partial<Strings> = { chapterName: () => "Chapitre" };
    expect(
      parityProblems("fr", buildTable("fr", fixture), ["chapterName"])
    ).toEqual(["fr: chapterName drops 4242"]);
  });

  it("tells two numeric arguments apart (Frank r1 #1531)", () => {
    const check = (fixture: Partial<Strings>) =>
      parityProblems("fr", buildTable("fr", fixture), ["shareItemsGoOut"]);
    expect(
      check({ shareItemsGoOut: (out: number, all: number) => `${out}/${all}` })
    ).toEqual([]);
    expect(
      check({ shareItemsGoOut: (out: number) => `${out} sortent` })
    ).toEqual(["fr: shareItemsGoOut drops 4243"]);
    expect(
      check({ shareItemsGoOut: (_out: number, all: number) => `sur ${all}` })
    ).toEqual(["fr: shareItemsGoOut drops 4242"]);
  });
});

describe("an alias resolves within its own locale table", () => {
  it("follows an overridden chapterName, couldNotBeIncluded and trail", () => {
    const table = buildTable("fr", {
      chapterName: (n: number) => `CHAPITRE-${n}`,
      couldNotBeIncluded: (subject: string) => `${subject} : manquant.`,
      trail: (...parts: readonly string[]) => parts.join(" / "),
    });
    expect(table.chapterHeading(null, 3)).toBe("CHAPITRE-3");
    expect(table.shareFilename("Livre", 4)).toContain("CHAPITRE-4");
    expect(table.shareMissing(1)).toMatch(/ : manquant\.$/);
    expect(table.shareAllMissing(1)).toMatch(/ : manquant\.$/);
    expect(table.chapterBreadcrumb("A", "B")).toBe("A / B");
    expect(table.recorderBreadcrumb("A", "B", 1, null)).toMatch(/^A \/ B \/ /);
    // English is untouched by building another table over it.
    expect(stringsEn.chapterBreadcrumb("A", "B")).toBe("A > B");
  });
});
