import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/locale";
import { LOCALE_OVERRIDES } from "@/lib/i18n/locales";
import { stringsEn, type Strings } from "@/lib/strings";

import { FUNCTION_ENTRIES, argVectors, call } from "./i18n-coverage";

/**
 * Machine gates for AI-drafted translations (#1485): a draft that left English
 * behind, used the wrong script, overflowed, or leaked a brace is caught by
 * the build. Meaning is out of scope; only a reader can judge it.
 *
 * Each check is a function over one English text and one draft text that
 * returns its problems. The test runs every check on a correct fixture and on
 * a defect fixture (`tests/fixtures/i18n-draft/`), and then over the real
 * tables. A real table that is empty has nothing to fail, so the real-table
 * runs below are green by being empty until the first draft lands.
 */

/**
 * PROVISIONAL. A draft may be at most this many times the English length
 * (with the floor below). It is a placeholder to be re-checked against the
 * first real draft, not a calibrated value; #1485 says to choose it from that
 * draft.
 */
const LENGTH_RATIO_MAX = 3;

/** Short English texts get at least this many characters of room. */
const LENGTH_FLOOR_CHARS = 12;

/**
 * English texts a draft may legitimately repeat verbatim, by key, each with
 * the reason. Empty until a draft needs one. A text with no letters left once
 * placeholders and brand words are removed never needs an entry.
 */
const ALLOW_ENGLISH: Readonly<Record<string, string>> = {};

/** Latin words a non-Latin draft may carry beyond the brand words. */
const ALLOW_LATIN: ReadonlySet<string> = new Set();

/** The script each locale's letters must come from. */
const SCRIPT_BY_TAG: Readonly<Record<string, string>> = {
  ar: "Arabic",
  es: "Latin",
  fr: "Latin",
  hi: "Devanagari",
  id: "Latin",
  pt: "Latin",
  ru: "Cyrillic",
  sw: "Latin",
  "zh-Hans": "Han",
};

/** Exempt by rule, not by listing: placeholders, probe sentinels, brand words. */
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;
const SENTINEL = /SENT[ab]?\d+/g;
const BRAND = /tC Mobile|MP3|ZIP|PWA/g;

function exempt(text: string): string {
  return text
    .replace(PLACEHOLDER, " ")
    .replace(SENTINEL, " ")
    .replace(BRAND, " ");
}

const letters = (text: string): string[] => text.match(/\p{L}+/gu) ?? [];

/** (a) A draft equal to its English text is an untranslated one. */
function englishLeak(key: string, en: string, value: string): string[] {
  if (value !== en) return [];
  if (letters(exempt(en)).length === 0) return [];
  if (Object.hasOwn(ALLOW_ENGLISH, key)) return [];
  return [`${key}: equals the English text`];
}

/** (b) Every letter is of the locale's script, or an allowlisted Latin word. */
function scriptProblems(tag: string, key: string, value: string): string[] {
  const script = SCRIPT_BY_TAG[tag];
  if (script === undefined) return [`${key}: no script known for ${tag}`];
  const words = letters(exempt(value));
  if (words.length === 0) return [];
  const own = new RegExp(`^\\p{Script=${script}}+$`, "u");
  const problems: string[] = [];
  let hasOwn = false;
  for (const word of words) {
    if (own.test(word)) hasOwn = true;
    else if (!ALLOW_LATIN.has(word))
      problems.push(`${key}: stray "${word}" outside ${script}`);
  }
  if (!hasOwn && problems.length === 0)
    problems.push(`${key}: no ${script} letters`);
  return problems;
}

/** (c) Length within the budget against English. */
function lengthProblems(key: string, en: string, value: string): string[] {
  const budget = Math.max(en.length * LENGTH_RATIO_MAX, LENGTH_FLOOR_CHARS);
  if (value.length === 0) return [`${key}: empty`];
  return value.length > budget
    ? [`${key}: ${value.length} characters over a budget of ${budget}`]
    : [];
}

/** (d) Placeholders equal English's; no stray braces; no null-ish text. */
function leakProblems(key: string, en: string, value: string): string[] {
  const problems: string[] = [];
  const names = (s: string): string =>
    [...new Set(s.match(PLACEHOLDER) ?? [])].sort().join(",");
  if (names(en) !== names(value))
    problems.push(
      `${key}: placeholders [${names(value)}] differ from English [${names(en)}]`
    );
  if (/[{}]/.test(value.replace(PLACEHOLDER, "")))
    problems.push(`${key}: stray brace`);
  if (/\b(undefined|null|NaN)\b|\[object /i.test(value))
    problems.push(`${key}: leaked null-ish text`);
  return problems;
}

/** Every check over one English/draft pair. */
function draftProblems(
  tag: string,
  key: string,
  en: string,
  value: string
): string[] {
  return [
    ...englishLeak(key, en, value),
    ...scriptProblems(tag, key, value),
    ...lengthProblems(key, en, value),
    ...leakProblems(key, en, value),
  ];
}

/** Every problem in one locale's table: text entries, and function entries rendered. */
function tableProblems(tag: string, overrides: Partial<Strings>): string[] {
  const merged = { ...stringsEn, ...overrides } as unknown as Strings;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const en = (stringsEn as Record<string, unknown>)[key];
    if (typeof value === "string" && typeof en === "string") {
      problems.push(...draftProblems(tag, key, en, value));
    } else if (typeof value === "function" && typeof en === "function") {
      for (const n of [1, 5]) {
        for (const args of argVectors(key, n)) {
          problems.push(
            ...draftProblems(
              tag,
              key,
              call(stringsEn, key, args),
              call(merged, key, args)
            )
          );
        }
      }
    }
  }
  return problems;
}

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "fixtures/i18n-draft", name),
      "utf8"
    )
  ) as T;

const TAGS = LOCALES.map((l) => l.tag).filter((tag) => tag !== "en");

describe("i18n draft quality gates (#1485)", () => {
  it("covers every non-English locale with a known script", () => {
    expect(TAGS.length).toBeGreaterThan(0);
    for (const tag of TAGS) expect(SCRIPT_BY_TAG[tag]).toBeDefined();
    expect(Object.keys(LOCALE_OVERRIDES).sort()).toEqual([...TAGS].sort());
  });

  it("keeps every allowlist entry reasoned and real", () => {
    for (const [key, why] of Object.entries(ALLOW_ENGLISH)) {
      expect(Object.keys(stringsEn)).toContain(key);
      expect(why.trim().length).toBeGreaterThan(0);
    }
    expect(FUNCTION_ENTRIES.length).toBeGreaterThan(0);
  });

  it("passes on a correct fixture", () => {
    expect(tableProblems("ar", fixture("ar-correct.json"))).toEqual([]);
  });

  it("(a) fails a draft that left English behind", () => {
    const problems = tableProblems("ar", fixture("ar-english-leak.json"));
    expect(problems).toContain("tryAgain: equals the English text");
  });

  it("(a) exempts text with no letters outside placeholders and brand words", () => {
    expect(englishLeak("k", "MP3 {n}", "MP3 {n}")).toEqual([]);
  });

  it("(b) fails a draft in the wrong script", () => {
    const problems = tableProblems("ar", fixture("ar-wrong-script.json"));
    expect(problems.some((p) => p.startsWith("tryAgain: stray"))).toBe(true);
  });

  it("(b) fails stray Latin in a non-Latin draft, but not brand words or placeholders", () => {
    const problems = tableProblems("ar", fixture("ar-stray-latin.json"));
    expect(problems).toContain('tryAgain: stray "again" outside Arabic');
    expect(scriptProblems("ar", "k", "ملف MP3 {n} tC Mobile")).toEqual([]);
  });

  it("(b) requires the script's letters in a Latin-script locale too", () => {
    expect(scriptProblems("fr", "k", "Réessayer")).toEqual([]);
    expect(scriptProblems("fr", "k", "Повторить")).not.toEqual([]);
  });

  it("(c) fails a draft over the length budget", () => {
    const problems = tableProblems("ar", fixture("ar-overflow.json"));
    expect(
      problems.some((p) => p.startsWith("tryAgain:") && p.includes("budget"))
    ).toBe(true);
  });

  it("(d) fails leaked braces and null-ish text", () => {
    const problems = tableProblems("ar", fixture("ar-leak.json"));
    expect(
      problems.some(
        (p) => p.startsWith("tryAgain:") && p.includes("placeholders")
      )
    ).toBe(true);
    expect(problems).toContain("loadingBooks: leaked null-ish text");
  });

  it("(d) compares placeholder sets with English", () => {
    const pairs = fixture<{
      correct: Array<{ en: string; value: string }>;
      defect: Array<{ en: string; value: string; why: string }>;
    }>("placeholder-pairs.json");
    for (const p of pairs.correct)
      expect(leakProblems("k", p.en, p.value)).toEqual([]);
    for (const p of pairs.defect)
      expect(leakProblems("k", p.en, p.value), p.why).not.toEqual([]);
  });

  it("checks rendered function entries, correct and defective", () => {
    const table = (fn: (n: number) => string): Partial<Strings> =>
      ({ chapterName: fn }) as unknown as Partial<Strings>;
    expect(
      tableProblems(
        "ar",
        table((n) => `الفصل ${n}`)
      )
    ).toEqual([]);
    expect(
      tableProblems(
        "ar",
        table((n) => `Chapter ${n}`)
      ).some((p) => p.includes("equals the English"))
    ).toBe(true);
    expect(
      tableProblems(
        "ar",
        table((n) => `الفصل ${n} undefined`)
      ).some((p) => p.includes("null-ish"))
    ).toBe(true);
  });

  describe("real tables (green while a table is empty)", () => {
    for (const tag of TAGS) {
      it(`${tag} has no draft-quality problems`, () => {
        expect(tableProblems(tag, LOCALE_OVERRIDES[tag] ?? {})).toEqual([]);
      });
    }
  });
});
