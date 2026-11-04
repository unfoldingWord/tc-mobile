import { afterEach, describe, expect, it } from "vitest";

import { LOCALES, activeLocale, setActiveLocale } from "@/lib/locale";
import { LOCALE_OVERRIDES } from "@/lib/i18n/locales";

/**
 * `shareAllIncomplete` means chapters that went into the share only in part
 * (English: "could not be included in full"), #1897. Five AI-drafted tables
 * once said that COMPLETE chapters were NOT included, which is false and
 * different. A reader's judgement is still needed for the new wording (these
 * are AI drafts, not native-reviewed); this pins only that the "complete
 * chapter" reading does not come back, and that each wording keeps its
 * "in full" marker and the count.
 */

const original = activeLocale();
afterEach(() => setActiveLocale(original));

/** The marker of each table's "not in full" sense, per locale. */
const IN_FULL: Record<string, RegExp> = {
  id: /seluruhnya/,
  ms: /sepenuhnya/,
  pt: /por inteiro/,
  sw: /(yote|zote)/,
  vi: /chưa được đưa vào đầy đủ/,
};

/** The wrong readings: a modifier meaning "complete" on the chapter noun. */
const WRONG: Record<string, RegExp> = {
  id: /pasal lengkap/,
  ms: /bab lengkap/,
  pt: /completos?\./,
  sw: /Sura \{n\} kamili/,
  vi: /chương đầy đủ vào/,
};

describe("shareAllIncomplete keeps the 'not in full' meaning (#1897)", () => {
  for (const tag of Object.keys(IN_FULL)) {
    it(`${tag}: says not fully included, never 'complete chapters not included'`, () => {
      const locale = LOCALES.find((l) => l.tag === tag);
      if (locale === undefined) throw new Error(`no locale ${tag}`);
      setActiveLocale(locale);
      const render = LOCALE_OVERRIDES[tag]?.shareAllIncomplete;
      if (render === undefined) throw new Error(`no entry for ${tag}`);
      for (const n of [1, 2, 5]) {
        const text = render(n);
        expect(text).toContain(String(n));
        expect(text).toMatch(IN_FULL[tag] ?? /^$/);
        expect(text).not.toMatch(WRONG[tag] ?? /^$/);
      }
    });
  }
});
