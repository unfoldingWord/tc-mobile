import { afterEach, describe, expect, it } from "vitest";

import { LOCALES, activeLocale, setActiveLocale } from "@/lib/locale";
import { LOCALE_OVERRIDES } from "@/lib/i18n/locales";

/**
 * `shareAllIncomplete` means chapters that went into the share only in part
 * (English: "could not be included in full"), #1897. Six AI-drafted tables
 * (id, ms, pt, sw, tl, vi) once said that COMPLETE chapters were NOT included, which is false and
 * different. A reader's judgement is still needed for the new wording (these
 * are AI drafts, not native-reviewed); this pins only that the "complete
 * chapter" reading does not come back, and that each wording keeps its
 * "in full" marker and the count.
 *
 * Both patterns run on RENDERED text, digits filled in, so neither may
 * contain a `{n}`.
 */

interface Case {
  n: number;
  /** The "not in full" marker the new wording carries. */
  inFull: RegExp;
  /** The modifier that made the old wording say "complete chapters". */
  wrong: RegExp;
}

const CASES: Record<string, Case[]> = {
  id: [{ n: 2, inFull: /seluruhnya/, wrong: /lengkap/ }],
  ms: [{ n: 2, inFull: /sepenuhnya/, wrong: /lengkap/ }],
  pt: [
    { n: 1, inFull: /por inteiro/, wrong: /completos?\./ },
    { n: 2, inFull: /por inteiro/, wrong: /completos?\./ },
    // Intl.PluralRules("pt") gives "many" for 1 000 000, a slot no small
    // count reaches.
    { n: 1_000_000, inFull: /por inteiro/, wrong: /completos?\./ },
  ],
  sw: [
    { n: 1, inFull: /kikamilifu/, wrong: /kamili(?!fu)|yote|zote/ },
    { n: 2, inFull: /kikamilifu/, wrong: /kamili(?!fu)|yote|zote/ },
  ],
  tl: [{ n: 2, inFull: /nang buo/, wrong: /kumpletong/ }],
  vi: [{ n: 2, inFull: /không thể được đưa vào đầy đủ/, wrong: /đầy đủ vào/ }],
};

/** The sentences the tables used to render, for the negative matcher. */
const OLD: Record<string, string[]> = {
  id: ["2 pasal lengkap tidak dapat disertakan."],
  ms: ["2 bab lengkap tidak dapat disertakan."],
  pt: [
    "Não foi possível incluir 1 capítulo completo.",
    "Não foi possível incluir 2 capítulos completos.",
  ],
  sw: [
    "Sura 1 kamili haikuweza kujumuishwa.",
    "Sura 2 kamili hazikuweza kujumuishwa.",
  ],
  tl: ["2 kumpletong kabanata ang hindi naisama."],
  vi: ["Không thể đưa 2 chương đầy đủ vào."],
};

/**
 * Sentences that keep the "in full" marker but bring the old meaning back by
 * another word, which the old-sentence check above cannot see.
 */
const REGRESSIONS: Record<string, string[]> = {
  sw: [
    "Sura 1 yote haikuweza kujumuishwa kikamilifu.",
    "Sura 2 zote hazikuweza kujumuishwa kikamilifu.",
  ],
};

const original = activeLocale();
afterEach(() => setActiveLocale(original));

describe("shareAllIncomplete keeps the 'not in full' meaning (#1897)", () => {
  for (const [tag, cases] of Object.entries(CASES)) {
    it(`${tag}: says not fully included, never 'complete chapters not included'`, () => {
      const locale = LOCALES.find((l) => l.tag === tag);
      if (locale === undefined) throw new Error(`no locale ${tag}`);
      setActiveLocale(locale);
      const render = LOCALE_OVERRIDES[tag]?.shareAllIncomplete;
      if (render === undefined) throw new Error(`no entry for ${tag}`);
      for (const c of cases) {
        const text = render(c.n);
        expect(text).toContain(String(c.n));
        expect(text).toMatch(c.inFull);
        expect(text).not.toMatch(c.wrong);
      }
    });

    it(`${tag}: the negative matcher rejects every old sentence`, () => {
      const olds = OLD[tag];
      if (olds === undefined || olds.length === 0) {
        throw new Error(`no old-sentence fixture for ${tag}`);
      }
      for (const old of olds) {
        expect(cases.some((c) => c.wrong.test(old))).toBe(true);
        expect(cases.some((c) => c.inFull.test(old))).toBe(false);
      }
    });

    for (const bad of REGRESSIONS[tag] ?? []) {
      it(`${tag}: the negative matcher rejects the regression "${bad}"`, () => {
        expect(cases.some((c) => c.inFull.test(bad))).toBe(true);
        expect(cases.some((c) => c.wrong.test(bad))).toBe(true);
      });
    }
  }
});
