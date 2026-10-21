/**
 * The registry of UI languages and the table each one has (#1481).
 *
 * One file per language beside this one, each holding only the keys that
 * language has translated (`Partial<Strings>`). `buildTable` lays that under
 * the English table, so a key not yet translated reads English, and
 * `pending.ts` is the list that says which keys are allowed to be in that
 * state. `tests/strings-locale-coverage.test.ts` is the build-time check.
 *
 * `installLocale` is the one place a table and its locale are installed;
 * `hooks/phone-locale.ts` chooses which (ADR 0015).
 */

import {
  LOCALES,
  SHIPPED_LOCALE,
  setActiveLocale,
  type Locale,
} from "../locale";
import { installStrings, stringsEn, type Strings } from "../strings";

import { table as ar } from "./ar";
import { table as es } from "./es";
import { table as fr } from "./fr";
import { table as hi } from "./hi";
import { table as id } from "./id";
import { table as pt } from "./pt";
import { table as ru } from "./ru";
import { table as sw } from "./sw";
import { table as zhHans } from "./zh-Hans";

/** What each non-English language has translated, by `Locale["tag"]`. */
export const LOCALE_OVERRIDES: Readonly<Record<string, Partial<Strings>>> = {
  ar,
  es,
  fr,
  hi,
  id,
  pt,
  ru,
  sw,
  "zh-Hans": zhHans,
};

/**
 * The full table for `tag`: English, with the language's own entries over it.
 *
 * Entries that embed another entry reach it through `this` (#1480), and the
 * result is one object, so `this` is the merged table: a locale that overrides
 * `chapterName` changes every entry that embeds it. Call entries through the
 * returned table, never detached.
 *
 * `overrides` is a parameter so the coverage test can build a table from a
 * fixture; callers pass a registered tag.
 */
export function buildTable(
  tag: string,
  overrides: Partial<Strings> | undefined = LOCALE_OVERRIDES[tag]
): Strings {
  if (!LOCALES.some((locale) => locale.tag === tag)) {
    throw new Error(`buildTable: "${tag}" is not a supported locale`);
  }
  return { ...stringsEn, ...overrides };
}

/**
 * The locales the resolver may pick: English, and each language whose table
 * has every English key (ADR 0015 (g): a screen is wholly in one language, so
 * an incomplete locale is skipped rather than shown half English).
 *
 * Read from the tables themselves, not from `pending.ts`: the tables are the
 * fact, and the pending list is the ratchet the coverage test keeps in step
 * with them. Called at each resolution, so it is never a stale snapshot.
 */
export function completeLocales(): Locale[] {
  const keys = Object.keys(stringsEn);
  return LOCALES.filter((locale) => {
    if (locale === SHIPPED_LOCALE) return true;
    const overrides = LOCALE_OVERRIDES[locale.tag];
    if (overrides === undefined) return false;
    const entries = overrides as Readonly<Record<string, unknown>>;
    // Own and defined: `buildTable` spreads own entries, and an `undefined`
    // would replace the English one with nothing.
    return keys.every(
      (key) => Object.hasOwn(entries, key) && entries[key] !== undefined
    );
  });
}

/**
 * Make `locale` the running one: its table becomes `strings`, and it becomes
 * `activeLocale()`, which `plural()` counts by. One call, so the words and the
 * count rule cannot come from two locales.
 */
export function installLocale(locale: Locale): void {
  installStrings(buildTable(locale.tag));
  setActiveLocale(locale);
}
