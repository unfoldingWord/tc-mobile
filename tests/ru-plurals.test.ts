import { afterEach, describe, expect, it } from "vitest";

import { LOCALES, activeLocale, setActiveLocale } from "@/lib/locale";
import { buildTable } from "@/lib/i18n/locales";
import type { Strings } from "@/lib/strings";

/**
 * Russian is the first language here with more than two count forms (#1635):
 * `one`, `few`, `many` and `other`, with `one` covering 21 and `few` covering
 * 22. Each form is a whole phrase with `{n}`. These tests render the real
 * table at the counts where the categories differ and read the noun each count
 * lands on, so a missing `few` or a form keyed off an English rule fails here
 * as a wrong word, not only as a missing key in the coverage gate.
 *
 * The categories are read from `Intl.PluralRules("ru")` on the Node running
 * the suite, not from a phone's engine.
 */

const RU = LOCALES.find((locale) => locale.tag === "ru");
const before = activeLocale();

function ru(): Strings {
  if (RU === undefined) throw new Error("no ru locale");
  setActiveLocale(RU);
  return buildTable("ru");
}

afterEach(() => setActiveLocale(before));

const CATEGORY_AT: ReadonlyArray<readonly [number, string]> = [
  [0, "many"],
  [1, "one"],
  [2, "few"],
  [5, "many"],
  [11, "many"],
  [21, "one"],
  [22, "few"],
];

describe("Russian plural categories (#1635)", () => {
  it.each(CATEGORY_AT)("Intl.PluralRules(ru) selects %i -> %s", (n, kind) => {
    expect(new Intl.PluralRules("ru").select(n)).toBe(kind);
  });

  it("renders the right noun form at 0, 1, 2, 5, 11, 21 and 22", () => {
    const t = ru();
    const nouns = (n: number): string => t.shareBookMissing(n);
    expect(nouns(0)).toBe("Не удалось включить 0 глав.");
    expect(nouns(1)).toBe("Не удалось включить 1 главу.");
    expect(nouns(2)).toBe("Не удалось включить 2 главы.");
    expect(nouns(5)).toBe("Не удалось включить 5 глав.");
    expect(nouns(11)).toBe("Не удалось включить 11 глав.");
    expect(nouns(21)).toBe("Не удалось включить 21 главу.");
    expect(nouns(22)).toBe("Не удалось включить 22 главы.");
  });

  it("gives every count entry a defined, digit-bearing form at every probed count", () => {
    const t = ru();
    const entries: Array<(n: number) => string> = [
      (n) => t.takeCapWarning(n),
      (n) => t.shareMissing(n),
      (n) => t.shareBookMissing(n),
      (n) => t.shareAllMissing(n),
      (n) => t.shareAllIncomplete(n),
      (n) => t.failuresMarker(n),
      (n) => t.menuOpenWithFailures(n),
      (n) => t.bookRow("SENT", n, true),
      (n) => t.bookRow("SENT", n, false),
      (n) => t.shareItemsGoOut(n, 30),
    ];
    for (const [n] of CATEGORY_AT)
      for (const entry of entries) {
        const text = entry(n);
        expect(text, `${n}`).toContain(String(n));
        expect(text, `${n}`).not.toMatch(/undefined|[{}]/);
      }
  });

  it("uses three different wordings across one, few and many", () => {
    const t = ru();
    const forms = new Set([1, 2, 5].map((n) => t.failuresMarker(n)));
    expect(forms.size).toBe(3);
    expect(t.takeCapWarning(1)).toBe("Осталась 1 минута");
    expect(t.takeCapWarning(2)).toBe("Осталось 2 минуты");
    expect(t.takeCapWarning(5)).toBe("Осталось 5 минут");
    expect(t.takeCapWarning(21)).toBe("Осталась 21 минута");
  });

  it("keeps 'an included chapter' for exactly one, never for 21", () => {
    const t = ru();
    expect(t.shareBookMissingAndPartial(0, 2, 1)).toContain(
      "из включённой главы"
    );
    const twentyOne = t.shareBookMissingAndPartial(0, 2, 21);
    expect(twentyOne).toContain("из 21 включённой главы");
    expect(twentyOne).not.toContain("из включённой главы");
    expect(t.shareBookMissingAndPartial(0, 2, 22)).toContain(
      "из 22 включённых глав"
    );
    expect(t.shareBookMissingAndPartial(0, 5, 5)).toContain(
      "5 фрагментов из 5 включённых глав"
    );
  });
});
