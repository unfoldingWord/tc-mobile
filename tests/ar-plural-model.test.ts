import { describe, expect, it, vi } from "vitest";

import { table as ar } from "@/lib/i18n/ar";
import { buildTable } from "@/lib/i18n/locales";

import { FUNCTION_ENTRIES, argVectors, call } from "./i18n-coverage";

/**
 * One plural model for every Arabic count entry (#1458; #1870, George r1
 * Low 2; #1874, George r1 Low 2).
 *
 * With a figure, Arabic counts the noun three ways. 3 to 10 (CLDR `few`)
 * take the plural ("3 فصول"). 11 to 99 (`many`) take the singular in the
 * accusative, which is written: "11 فصلًا", "11 دقيقةً". 100, 1000 and the
 * rest of `other` take the singular as the second term of a construct ("100
 * فصل", read "مئة فصلٍ"), which is genitive, and unwritten. After 0, 1 and 2
 * the bare singular is a compromise. That is `counted` in `ar.ts`, and the
 * cases below hold each category to it, one form against another, so a form
 * that drifts from the model fails however many marks it carries. A count
 * with no counted noun (all six forms one text) has nothing to check.
 *
 * #1870's review read `other` as accusative too. This model does not: the
 * noun after 100 and 1000 is genitive. That disagreement is for the native
 * speaker; flipping it is one line in `counted` and the `other` case below.
 *
 * The model is an AI reading of Arabic grammar. A native speaker has not
 * checked it, and that review is a condition of lifting the go-live hold.
 * This test reads the forms the table hands to `plural()`; it does not check
 * how they read, or render right to left.
 */

type Forms = Readonly<Record<string, string>>;

const recorded: Forms[] = [];

vi.mock("@/lib/plural", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/plural")>();
  return {
    ...real,
    plural: (...args: Parameters<typeof real.plural>): string => {
      recorded.push(args[1] as Forms);
      return real.plural(...args);
    },
  };
});

/** Fathatan, U+064B: the written accusative ending. */
const MARK = "ً";
/** Taa marbuta, U+0629: a noun ending in it takes the mark with no alif. */
const TAA_MARBUTA = "ة";
/** An Arabic letter, hamza to yaa: the mark sits on one, never on punctuation. */
const LETTER = /[ء-ي]/u;

/** Every forms object an `ar` entry of its own hands to `plural()`. */
function arabicForms(): Forms[] {
  const table = buildTable("ar");
  recorded.length = 0;
  for (const key of FUNCTION_ENTRIES) {
    if (!Object.hasOwn(ar, key)) continue;
    for (const args of argVectors(key, 11)) call(table, key, args);
  }
  // `zero` is a category only Arabic selects here, so it marks a form set
  // drafted for Arabic rather than one an English delegate passed in.
  return recorded.filter((forms) => Object.hasOwn(forms, "zero"));
}

/** The form sets with a counted noun: their forms are not all one text. */
const withNoun = (all: Forms[]): Forms[] =>
  all.filter((forms) => new Set(Object.values(forms)).size > 1);

/**
 * What `many` adds to `other`: the text between their common prefix and
 * suffix, and the character before it. `null` when `many` also drops text.
 */
function insertion(
  other: string,
  many: string
): { added: string; before: string } | null {
  let start = 0;
  while (start < other.length && other[start] === many[start]) start++;
  let end = 0;
  while (
    end < other.length - start &&
    other[other.length - 1 - end] === many[many.length - 1 - end]
  )
    end++;
  if (start + end !== other.length) return null;
  return {
    added: many.slice(start, many.length - end),
    before: other.slice(0, start).slice(-1),
  };
}

describe("the Arabic plural model", () => {
  it("finds the count entries it checks", () => {
    // Floor: a derivation that found none would pass every case below. The
    // twelve entries with a counted noun when this was written give at least
    // twelve distinct form sets.
    const distinct = new Set(
      withNoun(arabicForms()).map((f) => JSON.stringify(f))
    );
    expect(distinct.size).toBeGreaterThanOrEqual(12);
  });

  it("gives every count all six categories", () => {
    for (const forms of arabicForms())
      expect(Object.keys(forms).sort(), JSON.stringify(forms)).toEqual(
        ["few", "many", "one", "other", "two", "zero"].sort()
      );
  });

  it("gives zero, one, two and other the bare singular: one text", () => {
    for (const forms of withNoun(arabicForms())) {
      const label = JSON.stringify(forms);
      expect(forms.zero, label).toBe(forms.other);
      expect(forms.one, label).toBe(forms.other);
      expect(forms.two, label).toBe(forms.other);
      expect(forms.other, label).not.toContain(MARK);
    }
  });

  it("gives few the plural: its own word, unmarked", () => {
    for (const forms of withNoun(arabicForms())) {
      expect(forms.few, JSON.stringify(forms)).not.toBe(forms.other);
      expect(forms.few, JSON.stringify(forms)).not.toContain(MARK);
    }
  });

  it("gives many the singular in the accusative: other with the ending on the noun", () => {
    for (const forms of withNoun(arabicForms())) {
      const label = `${forms.other} -> ${forms.many}`;
      const change = insertion(forms.other ?? "", forms.many ?? "");
      expect(change, label).not.toBeNull();
      if (change === null) continue;
      expect(change.before, label).toMatch(LETTER);
      expect(change.added, label).toBe(
        change.before === TAA_MARBUTA ? MARK : `${MARK}ا`
      );
    }
  });
});
