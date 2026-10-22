import { describe, expect, it } from "vitest";

import { ENGLISH_ONLY } from "@/lib/i18n/english-only";
import { LOCALE_OVERRIDES, completeLocales } from "@/lib/i18n/locales";
import { resolveLocale } from "@/lib/i18n/resolve";
import { stringsEn } from "@/lib/strings";

/**
 * What `completeLocales` counts as complete (#1585, DRI pick "On, in the next
 * tester build"): every translatable key, and not the English-only ones, which
 * no language file may carry (S11, #1563). Before this, a language could never
 * be complete, so the resolver kept serving English to every phone.
 */

const tags = (): string[] => completeLocales().map((locale) => locale.tag);

/** Run `body` with `es` temporarily replaced, and put the real table back. */
function withEs(next: Record<string, unknown>, body: () => void): void {
  const table = LOCALE_OVERRIDES as Record<string, unknown>;
  const real = table.es;
  table.es = next;
  try {
    body();
  } finally {
    table.es = real;
  }
}

describe("completeLocales and the English-only keys", () => {
  it("counts es complete: every translatable key, none of the English-only", () => {
    expect(tags()).toContain("es");
    const es = LOCALE_OVERRIDES.es as Record<string, unknown>;
    // The premise the skip rests on: an unfiltered check could never pass.
    expect(ENGLISH_ONLY.size).toBeGreaterThan(0);
    for (const key of ENGLISH_ONLY) {
      expect(Object.keys(stringsEn)).toContain(key);
      expect(Object.hasOwn(es, key)).toBe(false);
    }
  });

  it("still skips a locale missing one translatable key", () => {
    const es = { ...(LOCALE_OVERRIDES.es as Record<string, unknown>) };
    delete es.tryAgain;
    withEs(es, () => expect(tags()).not.toContain("es"));
  });

  it("never lets an English-only key stand in for a missing translatable one", () => {
    const es = { ...(LOCALE_OVERRIDES.es as Record<string, unknown>) };
    delete es.tryAgain;
    es.phoneCheckTitle = "x";
    withEs(es, () => expect(tags()).not.toContain("es"));
  });

  it("does not count an undefined entry as translated", () => {
    const es = { ...(LOCALE_OVERRIDES.es as Record<string, unknown>) };
    es.tryAgain = undefined;
    withEs(es, () => expect(tags()).not.toContain("es"));
  });

  it("resolves a Spanish phone, and an unfinished language to English", () => {
    expect(resolveLocale(["es-419"], completeLocales()).tag).toBe("es");
    expect(resolveLocale(["es"], completeLocales()).tag).toBe("es");
    expect(resolveLocale(["ru-RU"], completeLocales()).tag).toBe("en");
    expect(resolveLocale(["ru-RU", "es-MX"], completeLocales()).tag).toBe("es");
  });

  it("counts fr complete, and resolves a French phone to fr (#1590)", () => {
    expect(tags()).toContain("fr");
    const fr = LOCALE_OVERRIDES.fr as Record<string, unknown>;
    for (const key of ENGLISH_ONLY) expect(Object.hasOwn(fr, key)).toBe(false);
    expect(resolveLocale(["fr-FR"], completeLocales()).tag).toBe("fr");
    expect(resolveLocale(["fr-CA", "es"], completeLocales()).tag).toBe("fr");
  });

  it("counts pt complete, and resolves a Brazilian or European Portuguese phone to pt (#1597)", () => {
    expect(tags()).toContain("pt");
    const pt = LOCALE_OVERRIDES.pt as Record<string, unknown>;
    for (const key of ENGLISH_ONLY) expect(Object.hasOwn(pt, key)).toBe(false);
    expect(resolveLocale(["pt-BR"], completeLocales()).tag).toBe("pt");
    expect(resolveLocale(["pt-PT", "es"], completeLocales()).tag).toBe("pt");
  });

  it("counts id complete, and resolves an Indonesian phone to id (#1619)", () => {
    expect(tags()).toContain("id");
    const id = LOCALE_OVERRIDES.id as Record<string, unknown>;
    for (const key of ENGLISH_ONLY) expect(Object.hasOwn(id, key)).toBe(false);
    expect(resolveLocale(["id-ID"], completeLocales()).tag).toBe("id");
    expect(resolveLocale(["id", "es"], completeLocales()).tag).toBe("id");
  });

  it("counts sw complete, and resolves a Swahili phone to sw (#1625)", () => {
    expect(tags()).toContain("sw");
    const sw = LOCALE_OVERRIDES.sw as Record<string, unknown>;
    for (const key of ENGLISH_ONLY) expect(Object.hasOwn(sw, key)).toBe(false);
    expect(resolveLocale(["sw-KE"], completeLocales()).tag).toBe("sw");
    expect(resolveLocale(["sw", "es"], completeLocales()).tag).toBe("sw");
  });
});
