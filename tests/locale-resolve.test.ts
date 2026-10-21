import { describe, expect, it } from "vitest";

import { resolveLocale } from "@/lib/i18n/resolve";
import { LOCALES, SHIPPED_LOCALE, type Locale } from "@/lib/locale";

/**
 * #1482: which of the ten v2 languages a phone's language list asks for.
 *
 * Each row is one rule from the issue, stated as the list a phone would give
 * and the tag the resolver must return. The Chinese rows follow the
 * requirements owner's R19 answer: "default to simplified text on Chinese
 * phones", Traditional-script tags included.
 */
const CASES: readonly (readonly [string, readonly string[], string])[] = [
  ["the first supported entry wins", ["sw-KE", "en"], "sw"],
  ["an unsupported first entry does not stop the walk", ["xx", "fr"], "fr"],
  ["several unsupported entries are skipped", ["de", "ja", "es-MX"], "es"],
  ["a supported later entry beats English", ["de-DE", "ar-EG", "en"], "ar"],
  ["a bare base tag", ["ru"], "ru"],
  ["case-insensitive base", ["FR-ca"], "fr"],
  ["case-insensitive, upper-case whole tag", ["HI-IN"], "hi"],
  ["pt-BR to pt", ["pt-BR"], "pt"],
  ["pt-PT to pt", ["pt-PT"], "pt"],
  ["legacy in to id", ["in"], "id"],
  ["legacy in-ID to id", ["in-ID"], "id"],
  ["id-ID to id", ["id-ID"], "id"],
  ["zh to Simplified", ["zh"], "zh-Hans"],
  ["zh-CN to Simplified", ["zh-CN"], "zh-Hans"],
  ["zh-SG to Simplified", ["zh-SG"], "zh-Hans"],
  ["zh-Hans to Simplified", ["zh-Hans"], "zh-Hans"],
  ["zh-Hans-CN to Simplified", ["zh-Hans-CN"], "zh-Hans"],
  ["zh-TW to Simplified (R19)", ["zh-TW"], "zh-Hans"],
  ["zh-HK to Simplified (R19)", ["zh-HK"], "zh-Hans"],
  ["zh-MO to Simplified (R19)", ["zh-MO"], "zh-Hans"],
  ["zh-Hant to Simplified (R19)", ["zh-Hant"], "zh-Hans"],
  ["zh-Hant-TW to Simplified (R19)", ["zh-Hant-TW"], "zh-Hans"],
  ["an underscore separator", ["pt_BR"], "pt"],
  ["an empty list to English", [], "en"],
  ["only unsupported entries to English", ["de", "ja"], "en"],
  ["garbage to English", ["", " ", 'en" onload="x', "--", "*"], "en"],
  ["garbage ahead of a supported entry is skipped", ["#!", "sw"], "sw"],
  ["a base that only prefixes a supported one is not it", ["ara", "eng"], "en"],
];

function entry(tag: string): Locale {
  const found = LOCALES.find((l) => l.tag === tag);
  if (found === undefined) throw new Error(`no ${tag} entry in LOCALES`);
  return found;
}

describe("resolveLocale", () => {
  it.each(CASES)("%s", (_name, languages, tag) => {
    expect(resolveLocale(languages).tag).toBe(tag);
  });

  it("returns the table's own entry, so dir comes with it", () => {
    expect(resolveLocale(["ar-SA"])).toBe(entry("ar"));
    expect(resolveLocale([])).toBe(SHIPPED_LOCALE);
  });

  it("does not throw on values the type does not allow", () => {
    // `navigator.languages` is typed, but the hook that reads it passes on
    // whatever the platform gives; a non-string must not reach `.split`.
    const hostile = [null, undefined, 42, {}] as unknown as string[];
    expect(resolveLocale(hostile)).toBe(SHIPPED_LOCALE);
    expect(resolveLocale(undefined as unknown as readonly string[])).toBe(
      SHIPPED_LOCALE
    );
  });

  it("resolves only among the candidates it is given", () => {
    // ADR 0015 (g): an incomplete locale is skipped. The completeness filter
    // is not built yet; this is the seam it passes its list through.
    const en = SHIPPED_LOCALE;
    const candidates = [en, entry("fr")];
    expect(resolveLocale(["sw", "fr"], candidates).tag).toBe("fr");
    expect(resolveLocale(["sw"], candidates)).toBe(en);
  });

  it("falls back to English even when English is not a candidate", () => {
    expect(resolveLocale(["sw"], [])).toBe(SHIPPED_LOCALE);
  });
});
