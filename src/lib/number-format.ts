/**
 * The one entry through which a number reaches the screen (#1458, ADR 0015
 * (h), R19).
 *
 * The requirements owner's answer on digits (R19): "Use Arabic numerals;
 * default to simplified text on Chinese phones." Every language shows `0-9`,
 * so the Latin numbering system is named explicitly (`numberingSystem:
 * "latn"`) rather than left to the locale or to a phone's regional setting. A
 * call site that formats a count, a position or a clock reads this, so no locale
 * can leak Arabic-Indic, Devanagari or any other digits, and there is one place
 * to change if that answer ever does.
 *
 * Grouping is off: the app shows counts and clocks, never amounts, and a
 * grouping separator inside a `{n}` phrase is a second decision no table asked
 * for. `Intl` is available in plain Node and in a Worker, so this stays in
 * `lib/` (no DOM).
 *
 * The default locale is `"en"`, which fixes the decimal separator as well as the
 * digits for a value that has fractions; pass a locale only for a surface that
 * should follow the phone's separator.
 */

export interface NumberFormatOptions {
  /** Left-pad the integer part with zeros to at least this many digits. */
  readonly minDigits?: number;
  /** Exact number of fraction digits. Omitted: as many as the value needs. */
  readonly fractionDigits?: number;
  /** BCP 47 tag; only the separator follows it, never the digits. */
  readonly locale?: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(
  locale: string,
  minDigits: number,
  fractionDigits: number | null
): Intl.NumberFormat {
  const key = `${locale}|${String(minDigits)}|${String(fractionDigits)}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const made = new Intl.NumberFormat(locale, {
    numberingSystem: "latn",
    useGrouping: false,
    minimumIntegerDigits: minDigits,
    minimumFractionDigits: fractionDigits ?? 0,
    maximumFractionDigits: fractionDigits ?? 20,
  });
  formatters.set(key, made);
  return made;
}

/** `value` as text in Latin digits: `formatNumber(7, { minDigits: 2 })` → `"07"`. */
export function formatNumber(
  value: number,
  options: NumberFormatOptions = {}
): string {
  const { minDigits = 1, fractionDigits = null, locale = "en" } = options;
  return formatterFor(locale, minDigits, fractionDigits).format(value);
}
