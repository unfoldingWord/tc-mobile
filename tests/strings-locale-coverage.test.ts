import { describe, expect, it, vi } from "vitest";

import { LOCALES } from "@/lib/locale";
import { ENGLISH_ONLY } from "@/lib/i18n/english-only";
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

/** A fixture language: all of English but the English-only keys, so complete. */
const complete = (): Partial<Strings> =>
  Object.fromEntries(
    Object.entries(stringsEn).filter(([key]) => !ENGLISH_ONLY.has(key))
  ) as Partial<Strings>;

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
      shareMissing: (n: number): string => plural(n, forms),
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

describe("the argument check and a literal-union argument (#1585)", () => {
  const armed = (text: string): Partial<Strings> => ({
    restartArmed: () => text,
  });
  const check = (fixture: Partial<Strings>) =>
    parityProblems("es", buildTable("es", fixture), ["restartArmed"]);

  it("does not demand that a translation print a switch value", () => {
    // English prints "recording" and "changes" for two members of the union;
    // a Spanish sentence that says "grabación" has dropped nothing.
    expect(check(armed("Toca de nuevo para reiniciar"))).toEqual([]);
  });

  it("still fails an entry that drops a text argument beside a union one", () => {
    const fixture: Partial<Strings> = {
      saveFailedHeld: () => "Tu grabación sigue aquí.",
    };
    expect(
      parityProblems("es", buildTable("es", fixture), ["saveFailedHeld"])
    ).toEqual(["es: saveFailedHeld drops 4243"]);
  });
});

describe("an alias resolves within its own locale table", () => {
  it("follows an overridden chapterName and trail", () => {
    const table = buildTable("fr", {
      chapterName: (n: number) => `CHAPITRE-${n}`,
      trail: (...parts: readonly string[]) => parts.join(" / "),
    });
    expect(table.chapterHeading(null, 3)).toBe("CHAPITRE-3");
    expect(table.shareFilename("Livre", 4)).toContain("CHAPITRE-4");
    expect(table.chapterBreadcrumb("A", "B")).toBe("A / B");
    expect(table.recorderBreadcrumb("A", "B", 1, null)).toMatch(/^A \/ B \/ /);
    // English is untouched by building another table over it.
    expect(stringsEn.chapterBreadcrumb("A", "B")).toBe("A > B");
  });
});

describe("the English-only keys (S11, #1483)", () => {
  const phoneKeys = Object.keys(stringsEn).filter((key) =>
    key.startsWith("phoneCheck")
  );

  it("are exactly the phoneCheck group of the table", () => {
    expect(phoneKeys.length).toBeGreaterThanOrEqual(19);
    expect([...ENGLISH_ONLY].sort()).toEqual([...phoneKeys].sort());
  });

  it("are neither missing nor pending when a locale is complete at release", () => {
    // Without the exemption each of them is a key missing at release.
    const without = keyProblems("fr", complete(), [], true, new Set());
    expect(without).toHaveLength(phoneKeys.length + 1);
    expect(without).toContain(
      `fr: ${phoneKeys.length} keys missing at release`
    );
    expect(keyProblems("fr", complete(), [], true)).toEqual([]);
  });

  it("fail a language that translates one, or lists one as pending", () => {
    expect(
      keyProblems(
        "fr",
        { ...complete(), phoneCheckTitle: "Contrôle" },
        [],
        true
      )
    ).toEqual(["fr: phoneCheckTitle is English-only and is translated"]);
    expect(
      keyProblems("fr", { phoneCheckTitle: "Contrôle" }, "all", false)
    ).toEqual(["fr: phoneCheckTitle is English-only and is translated"]);
    expect(keyProblems("fr", complete(), ["phoneCheckTitle"], true)).toEqual([
      "fr: pending key phoneCheckTitle is English-only",
    ]);
  });

  it("are carried by no real language file and listed by no pending list", () => {
    for (const tag of TAGS) {
      const own = Object.keys(LOCALE_OVERRIDES[tag] ?? {});
      const pending = PENDING[tag] ?? [];
      for (const key of ENGLISH_ONLY) {
        expect(own).not.toContain(key);
        if (pending !== "all") expect(pending).not.toContain(key);
      }
    }
  });
});
