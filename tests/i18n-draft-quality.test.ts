import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LOCALES, activeLocale, setActiveLocale } from "@/lib/locale";
import { LOCALE_OVERRIDES } from "@/lib/i18n/locales";
import { plural } from "@/lib/plural";
import { stringsEn, type RestartSubject, type Strings } from "@/lib/strings";

import {
  FUNCTION_ENTRIES,
  UNION_DOMAINS,
  argVectors,
  call,
  countsFor,
  unionMembers,
} from "./i18n-coverage";

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
 * A draft may be at most this many times the English length (with the floor
 * below). Calibrated from the first real draft, Spanish (#1585): measured over
 * every text entry and every rendered count of every function entry, the
 * longest Spanish text is 2.2 times its English one, and only short captions
 * reach it ("Reset" to "Restablecer", "Play {heading}" to "Reproducir
 * {heading}"). 2.5 leaves a little room above that and still catches a
 * paragraph where a caption belongs. It is calibrated from languages that
 * run longer than English, not from all nine: the next draft that measures
 * above it raises it here, with its own measurement and reason.
 *
 * Raised from 2.5 to 2.7 for French (#1590). The French draft needs more room
 * in two places, both short English captions: "Pause {heading}" to "Mettre
 * {heading} en pause" (16 characters against 6, a ratio of 2.67) and the tile
 * caption "Reset" to "Réinitialiser" (13 against 5, 2.6; the glossary's term,
 * row 11). Both keep the glossary word. "Mettre en pause" is the plain French
 * verb phrase for pausing, and a bare "Pause" would read as a noun on a screen
 * reader. The longest French text measures 2.67; 2.7 leaves little room above.
 */
const LENGTH_RATIO_MAX = 2.7;

/** Short English texts get at least this many characters of room. */
const LENGTH_FLOOR_CHARS = 12;

/**
 * English texts a draft may legitimately repeat verbatim, by locale tag and
 * then key, each with the reason, so one entry silences one locale only.
 * Empty until a draft needs one. A text with no letters left once
 * placeholders and brand words are removed never needs an entry.
 */
type Reasons = Readonly<Record<string, string>>;
const ALLOW_ENGLISH: Readonly<Record<string, Reasons>> = {
  es: {
    shareFilename:
      "Builds a file name from the book's own name, the chapter number and the licence tag; with a typed chapter name the whole result is the user's text, so it equals English by design. The default chapter name, the only drafted words, is `chapterName`.",
    shareBookFilename:
      "Builds `<book name><licence tag>.zip`; the only words are the book's own name and the extension, which are never translated (glossary section 7).",
    exportProjectFilename:
      "Builds `<book name> - project.zip`: ADR 0014 point 8 fixes the suffix in English on every phone language until #1627 is answered, so it equals English by design.",
  },
  fr: {
    menuTitle:
      "The French word for a menu is spelled the same as the English one (glossary section 5, row 17: `Menu`).",
    eraseConfirmPreviewPause:
      "The French caption for pausing is spelled the same as the English one (glossary section 5, row 8: `Pause`).",
    coverColourRose:
      "The French colour name is spelled the same as the English one (`Rose`).",
    coverColourOlive:
      "The French colour name is spelled the same as the English one (`Olive`).",
    shareFilename:
      "Builds a file name from the book's own name, the chapter number and the licence tag; with a typed chapter name the whole result is the user's text, so it equals English by design. The default chapter name, the only drafted words, is `chapterName`.",
    shareBookFilename:
      "Builds `<book name><licence tag>.zip`; the only words are the book's own name and the extension, which are never translated (glossary section 7).",
    exportProjectFilename:
      "Builds `<book name> - project.zip`: ADR 0014 point 8 fixes the suffix in English on every phone language until #1627 is answered, so it equals English by design.",
  },
  hi: {
    shareFilename:
      "Builds a file name from the book's own name, the chapter number and the licence tag; with a typed chapter name the whole result is the user's text, so it equals English by design. The default chapter name, the only drafted words, is `chapterName`.",
    shareBookFilename:
      "Builds `<book name><licence tag>.zip`; the only words are the book's own name and the extension, which are never translated (glossary section 7).",
    exportProjectFilename:
      "Builds `<book name> - project.zip`: ADR 0014 point 8 fixes the suffix in English on every phone language until #1627 is answered, so it equals English by design.",
  },
  id: {
    menuTitle:
      "The Indonesian word for a menu is spelled the same as the English one (glossary section 5, row 17: `Menu`).",
    tileEdit:
      "The Indonesian word for editing is spelled the same as the English one (glossary section 5, row 15: `Edit`).",
    shareFilename:
      "Builds a file name from the book's own name, the chapter number and the licence tag; with a typed chapter name the whole result is the user's text, so it equals English by design. The default chapter name, the only drafted words, is `chapterName`.",
    shareBookFilename:
      "Builds `<book name><licence tag>.zip`; the only words are the book's own name and the extension, which are never translated (glossary section 7).",
    exportProjectFilename:
      "Builds `<book name> - project.zip`: ADR 0014 point 8 fixes the suffix in English on every phone language until #1627 is answered, so it equals English by design.",
  },
  sw: {
    shareFilename:
      "Builds a file name from the book's own name, the chapter number and the licence tag; with a typed chapter name the whole result is the user's text, so it equals English by design. The default chapter name, the only drafted words, is `chapterName`.",
    shareBookFilename:
      "Builds `<book name><licence tag>.zip`; the only words are the book's own name and the extension, which are never translated (glossary section 7).",
    exportProjectFilename:
      "Builds `<book name> - project.zip`: ADR 0014 point 8 fixes the suffix in English on every phone language until #1627 is answered, so it equals English by design.",
  },
  pt: {
    menuTitle:
      "The Portuguese word for a menu is spelled the same as the English one (glossary section 5, row 17: `Menu`).",
    shareFilename:
      "Builds a file name from the book's own name, the chapter number and the licence tag; with a typed chapter name the whole result is the user's text, so it equals English by design. The default chapter name, the only drafted words, is `chapterName`.",
    shareBookFilename:
      "Builds `<book name><licence tag>.zip`; the only words are the book's own name and the extension, which are never translated (glossary section 7).",
    exportProjectFilename:
      "Builds `<book name> - project.zip`: ADR 0014 point 8 fixes the suffix in English on every phone language until #1627 is answered, so it equals English by design.",
  },
};

/** Latin words a non-Latin draft may carry beyond the brand words. */
const ALLOW_LATIN: ReadonlySet<string> = new Set([
  // The licence the app itself is offered under; the glossary keeps licence
  // names as they are (section 4).
  "MIT",
  // A proper name: where the source of this build is opened.
  "GitHub",
]);

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

/**
 * Exempt by rule, not by listing: placeholders, probe sentinels, brand words,
 * and the Export project file name's fixed English suffix (ADR 0014 point 8,
 * open on #1627).
 */
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;
const SENTINEL = /SENT[ab]?\d+/g;
// The ISO 639-3 name and its registrar's address are kept as written: the
// code terms ask for attribution "to iso639-3.sil.org" (ADR 0017).
const BRAND =
  /tC Mobile|MP3|ZIP|PWA|\.mp3|- project\.zip|\.zip|CC BY-SA 4\.0|CC BY 4\.0|CC0 1\.0|ISO 639-3|iso639-3\.sil\.org/g;

function exempt(text: string): string {
  return text
    .replace(PLACEHOLDER, " ")
    .replace(SENTINEL, " ")
    .replace(BRAND, " ");
}

const letters = (text: string): string[] => text.match(/\p{L}+/gu) ?? [];

/** (a) A draft equal to its English text is an untranslated one. */
function englishLeak(
  tag: string,
  key: string,
  en: string,
  value: string
): string[] {
  if (value !== en) return [];
  if (letters(exempt(en)).length === 0) return [];
  if (Object.hasOwn(ALLOW_ENGLISH[tag] ?? {}, key)) return [];
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
  if (letters(exempt(value)).length === 0 && letters(exempt(en)).length > 0)
    return [`${key}: no letters outside placeholders and brand words`];
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
  // Legitimate empty output (both heading arguments null) has nothing to check.
  if (en === "" && value === "") return [];
  return [
    ...englishLeak(tag, key, en, value),
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
      // Every count, rendered under its own locale's plural rule, so a defect
      // confined to `two`/`few`/`many` is reached.
      for (const n of countsFor(tag)) {
        for (const args of argVectors(key, n)) {
          problems.push(
            ...draftProblems(
              tag,
              key,
              renderIn("en", stringsEn, key, args),
              renderIn(tag, merged, key, args)
            )
          );
        }
      }
    } else problems.push(`${key}: type mismatch`);
  }
  return problems;
}

/** `call` with `tag` as the active locale, restored afterwards. */
function renderIn(
  tag: string,
  table: Strings,
  key: string,
  args: unknown[]
): string {
  const locale = LOCALES.find((l) => l.tag === tag);
  if (locale === undefined) throw new Error(`no locale ${tag}`);
  const before = activeLocale();
  setActiveLocale(locale);
  try {
    return call(table, key, args);
  } finally {
    setActiveLocale(before);
  }
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
    for (const [tag, entries] of Object.entries(ALLOW_ENGLISH)) {
      expect(TAGS).toContain(tag);
      for (const [key, why] of Object.entries(entries)) {
        expect(Object.keys(stringsEn)).toContain(key);
        expect(why.trim().length).toBeGreaterThan(0);
      }
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
    expect(englishLeak("ar", "k", "MP3 {n}", "MP3 {n}")).toEqual([]);
  });

  it("(c) fails a draft with no letters where English has some", () => {
    for (const value of ["   ", "???"])
      expect(lengthProblems("k", "Try again", value)).toEqual([
        "k: no letters outside placeholders and brand words",
      ]);
    expect(lengthProblems("k", "MP3 {n}", "MP3 {n}")).toEqual([]);
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
    expect(scriptProblems("fr", "k", "Повторить")).toEqual([
      'k: stray "Повторить" outside Latin',
    ]);
  });

  it("(c) fails a draft over the length budget", () => {
    const problems = tableProblems("ar", fixture("ar-overflow.json"));
    expect(
      problems.some((p) => p.startsWith("tryAgain:") && p.includes("budget"))
    ).toBe(true);
  });

  it("(c) holds the calibrated ratio exactly: 2.7 times English passes, a character more fails", () => {
    const en = "a".repeat(20);
    expect(lengthProblems("k", en, "a".repeat(54))).toEqual([]);
    expect(lengthProblems("k", en, "a".repeat(55))).toHaveLength(1);
  });

  it("(d) fails an invented placeholder and null-ish text", () => {
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
      expect(leakProblems("k", p.en, p.value), p.why).toHaveLength(1);
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

  it("renders plural entries under the draft's own locale and counts", () => {
    const shareMissing = (few: string): Partial<Strings> =>
      ({
        shareMissing: (n: number) =>
          plural(n, {
            zero: "لم يتم تضمين أي مقطع.",
            one: "مقطع {n} لم يتم تضمينه.",
            two: "مقطعان {n} لم يتم تضمينهما.",
            few,
            many: "{n} مقطعًا لم يتم تضمينها.",
            other: "{n} مقطع لم يتم تضمينه.",
          }),
      }) as unknown as Partial<Strings>;
    const correct = shareMissing("{n} مقاطع لم يتم تضمينها.");
    expect(tableProblems("ar", correct)).toEqual([]);
    expect(tableProblems("ar", shareMissing("{n} undefined"))).toContain(
      "shareMissing: leaked null-ish text"
    );
    expect(activeLocale().tag).toBe("en");
  });

  it("exercises nullable parameters: untranslated fallback fails, translated passes", () => {
    const bookHeading = (fallback: (n: number) => string): Partial<Strings> =>
      ({
        bookHeading: (name: string | null, number: number | null) =>
          name ?? (number === null ? "" : fallback(number)),
      }) as unknown as Partial<Strings>;
    const untranslated = tableProblems(
      "ar",
      bookHeading((n) => `Book ${String(n).padStart(3, "0")}`)
    );
    expect(untranslated).toContain("bookHeading: equals the English text");
    expect(
      tableProblems(
        "ar",
        bookHeading((n) => `الكتاب ${String(n).padStart(3, "0")}`)
      )
    ).toEqual([]);
  });

  it("declares a domain for every function entry and every union equals its type", () => {
    for (const name of FUNCTION_ENTRIES)
      expect(() => argVectors(name, 1), name).not.toThrow();
    for (const [name, members] of Object.entries(UNION_DOMAINS))
      expect([...members].sort(), name).toEqual(unionMembers(name).sort());
    expect(argVectors("shareBookFilename", 1)).toContainEqual(["SENT0", null]);
    const vectors = argVectors("restartArmed", 1);
    for (const subject of unionMembers("RestartSubject"))
      expect(vectors.map((v) => v[0])).toContain(subject);
  });

  it("exercises every literal-union member: an untranslated restart branch fails, a full translation passes", () => {
    const lose = "اضغط مرة أخرى لإعادة البدء وفقدان";
    const cut = "والصوت الذي قطعته";
    const restart = (translated: readonly string[]): Partial<Strings> => {
      const text = (subject: string, also: boolean): string => {
        if (subject === "cutAudio") return `${lose} الصوت الذي قطعته`;
        const what = subject === "recording" ? "هذا التسجيل" : "هذه التغييرات";
        return also ? `${lose} ${what} ${cut}` : `${lose} ${what}`;
      };
      return {
        restartArmed: (subject: RestartSubject, also: boolean) =>
          translated.includes(subject)
            ? text(subject, also)
            : stringsEn.restartArmed(subject, also),
      } as unknown as Partial<Strings>;
    };
    expect(
      tableProblems("ar", restart(["recording", "changes", "cutAudio"]))
    ).toEqual([]);
    for (const missing of ["changes", "cutAudio"])
      expect(
        tableProblems(
          "ar",
          restart(
            ["recording", "changes", "cutAudio"].filter((s) => s !== missing)
          )
        ),
        missing
      ).toContain("restartArmed: equals the English text");
    expect(tableProblems("ar", restart(["recording"])).length).toBeGreaterThan(
      0
    );
  });

  it("generates null for a nullable parameter and counts for every category", () => {
    const vectors = argVectors("bookHeading", 3);
    expect(vectors).toContainEqual([null, null]);
    expect(vectors).toContainEqual([null, 3]);
    expect(vectors).toContainEqual(["SENT0", null]);
    for (const tag of ["en", "ar", "ru", "fr"]) {
      const rules = new Intl.PluralRules(tag);
      const reached = new Set(countsFor(tag).map((n) => rules.select(n)));
      for (let n = 0; n <= 1000; n++)
        expect(reached).toContain(rules.select(n));
    }
  });

  describe("real tables (green while a table is empty)", () => {
    for (const tag of TAGS) {
      it(`${tag} has no draft-quality problems`, () => {
        expect(tableProblems(tag, LOCALE_OVERRIDES[tag] ?? {})).toEqual([]);
      });
    }
  });
});
