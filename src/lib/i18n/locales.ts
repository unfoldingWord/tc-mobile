/**
 * The registry of UI languages and the table each one has (#1481).
 *
 * One file per language beside this one, each holding only the keys that
 * language has translated (`Partial<Strings>`). `buildTable` lays that under
 * the English table, so a key not yet translated reads English, and
 * `pending.ts` is the list that says which keys are allowed to be in that
 * state. `tests/strings-locale-coverage.test.ts` is the build-time check.
 *
 * Nothing selects a table at runtime yet (ADR 0015 owns that): this module
 * only builds and names them.
 */

import { LOCALES } from "../locale";
import { stringsEn, type Strings } from "../strings";

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
