import { afterEach, describe, expect, it } from "vitest";

import { LOCALES, activeLocale, setActiveLocale } from "@/lib/locale";
import { buildTable } from "@/lib/i18n/locales";

/**
 * The Tok Pisin share report, PR #1930 round 1: the partial clause of
 * `shareBookMissingAndPartial` once put "i go insait" (went in) into a
 * template ending "i no inap i go insait" (could not go in), so one sentence
 * claimed both. The first test pins the shape: no rendered sentence of the
 * share counts says "i go insait" twice. Whether the wording is right is a Tok
 * Pisin reader's call (the table is an AI draft).
 *
 * The later `it`s pin exact AI-draft text (the missing-and-partial sentence,
 * and the two cover-colour words `tpi.ts`'s docblock names), not a
 * native-reviewed wording, so a deliberate rewording updates them.
 */

const original = activeLocale();
afterEach(() => setActiveLocale(original));

const sentencesOf = (text: string): string[] =>
  text.split(/(?<=\.)\s+/).filter((s) => s.length > 0);

const goesIn = (sentence: string): number =>
  sentence.split("i go insait").length - 1;

describe("tpi share counts say one thing per sentence", () => {
  const locale = LOCALES.find((l) => l.tag === "tpi");
  if (locale === undefined) throw new Error("no locale tpi");
  const table = buildTable("tpi");

  const rendered = (): string[] => [
    ...[
      [2, 3, 1],
      [2, 3, 4],
      [1, 1, 1],
      [0, 5, 0],
    ].map(([c, s, p]) => table.shareBookMissingAndPartial(c!, s!, p!)),
    table.shareBookPartial(3),
    table.shareMissing(2),
    table.shareBookMissing(2),
    table.shareAllMissing(2),
    table.shareAllIncomplete(2),
  ];

  it("never says 'i go insait' twice in one sentence", () => {
    setActiveLocale(locale);
    const texts = rendered();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts)
      for (const sentence of sentencesOf(text))
        expect(goesIn(sentence), sentence).toBeLessThanOrEqual(1);
  });

  it("catches the round-1 sentence", () => {
    expect(
      goesIn("3 hap bilong wanpela sapta i go insait i no inap i go insait.")
    ).toBe(2);
  });

  it("pins the exact text of the missing-and-partial sentence, one partial chapter", () => {
    setActiveLocale(locale);
    expect(table.shareBookMissingAndPartial(2, 3, 1)).toBe(
      "2 sapta i no inap i go insait. Long wanpela sapta i stap insait, 3 hap i no inap i go insait."
    );
  });

  it("pins the exact text of the missing-and-partial sentence, several partial chapters", () => {
    setActiveLocale(locale);
    expect(table.shareBookMissingAndPartial(2, 3, 4)).toBe(
      "2 sapta i no inap i go insait. Long 4 sapta i stap insait, 3 hap i no inap i go insait."
    );
  });

  it("pins the two cover-colour words that tpi.ts's docblock contrasts", () => {
    expect(table.coverColourRust).toBe("Ros");
    expect(table.coverColourRose).toBe("Pinkpela");
  });
});
