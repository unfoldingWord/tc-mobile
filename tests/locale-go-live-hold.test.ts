import { describe, expect, it } from "vitest";

import { ENGLISH_ONLY } from "@/lib/i18n/english-only";
import {
  GO_LIVE_HELD,
  LOCALE_OVERRIDES,
  completeLocales,
} from "@/lib/i18n/locales";
import { resolveLocale } from "@/lib/i18n/resolve";
import { LOCALES } from "@/lib/locale";
import { stringsEn } from "@/lib/strings";

/**
 * The go-live hold (#1458): a language on the hold is never offered to the
 * resolver, however complete its table is. Arabic is on it until the
 * right-to-left device pass clears it (DRI, 2026-11-03: "Draft now, gate
 * go-live").
 *
 * The real `ar` table is not complete yet, so each case below swaps in a
 * stub that is: every translatable key, own and defined (the English value
 * stands in; only completeness is under test here, and the draft gates read
 * the real table, not this one).
 */

const tags = (held?: ReadonlySet<string>): string[] =>
  completeLocales(held).map((locale) => locale.tag);

function completeStub(): Record<string, unknown> {
  const stub: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stringsEn))
    if (!ENGLISH_ONLY.has(key)) stub[key] = value;
  return stub;
}

/** Run `body` with `ar` replaced by a complete stub, and put the real table back. */
function withCompleteAr(body: () => void): void {
  const table = LOCALE_OVERRIDES as Record<string, unknown>;
  const real = table.ar;
  table.ar = completeStub();
  try {
    body();
  } finally {
    table.ar = real;
  }
}

describe("the go-live hold", () => {
  it("holds Arabic, and only Arabic, and only a registered locale", () => {
    expect([...GO_LIVE_HELD]).toEqual(["ar"]);
    for (const tag of GO_LIVE_HELD)
      expect(LOCALES.map((locale) => locale.tag)).toContain(tag);
  });

  it("keeps a complete Arabic table off: an Arabic phone gets English", () => {
    withCompleteAr(() => {
      expect(tags()).not.toContain("ar");
      expect(resolveLocale(["ar-EG"], completeLocales()).tag).toBe("en");
      expect(resolveLocale(["ar", "es"], completeLocales()).tag).toBe("es");
    });
  });

  it("lets the same table go live once Arabic is off the hold", () => {
    withCompleteAr(() => {
      expect(tags(new Set())).toContain("ar");
      expect(resolveLocale(["ar-EG"], completeLocales(new Set())).tag).toBe(
        "ar"
      );
    });
  });

  it("changes no other locale", () => {
    // Premise: there are other complete locales for the hold to leave alone.
    expect(tags().length).toBeGreaterThan(2);
    expect(tags()).toEqual(tags(new Set()).filter((tag) => tag !== "ar"));
    withCompleteAr(() =>
      expect(tags()).toEqual(tags(new Set()).filter((tag) => tag !== "ar"))
    );
  });

  it("cannot be added to by a caller (#1870, George r1 Low 1)", () => {
    // Every way a caller could reach for: the Set and Array methods, called
    // on the value and through the prototypes. A frozen hold refuses each
    // one with a TypeError; a live Set would take the first and hold Spanish
    // for every caller of the default argument.
    const attempts: ReadonlyArray<() => unknown> = [
      () => (GO_LIVE_HELD as unknown as Set<string>).add("es"),
      () => Set.prototype.add.call(GO_LIVE_HELD, "es"),
      () => (GO_LIVE_HELD as unknown as string[]).push("es"),
      () => Array.prototype.push.call(GO_LIVE_HELD, "es"),
    ];
    const refused = attempts.filter((attempt) => {
      try {
        attempt();
        return false;
      } catch (cause) {
        return cause instanceof TypeError;
      }
    });
    try {
      expect([...GO_LIVE_HELD]).toEqual(["ar"]);
      expect(tags()).toContain("es");
      expect(refused).toHaveLength(attempts.length);
      expect(Object.isFrozen(GO_LIVE_HELD)).toBe(true);
    } finally {
      // Undo a mutation that got through, so a red run here does not hold
      // Spanish for the cases after it.
      if (GO_LIVE_HELD instanceof Set) GO_LIVE_HELD.delete("es");
    }
  });

  it("never holds English, the fallback", () => {
    expect(tags(new Set(["en"]))).toContain("en");
  });
});
