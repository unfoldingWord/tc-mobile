/**
 * Counted phrases, chosen by the locale's own plural rules rather than by an
 * English `=== 1` ternary (#169).
 *
 * English has two forms and a ternary is right for it, which is exactly why
 * the ternaries survived: they are correct until the first catalog that is not
 * English, and then they are wrong everywhere at once, in a language nobody on
 * this repo reads. `Intl.PluralRules` knows the categories each language
 * actually uses, so a catalog declares the forms it has and this picks between
 * them.
 *
 * `{n}` in a form is replaced with the count. Every form is a WHOLE phrase —
 * "1 chapter", "{n} chapters" — never a noun the caller glues a number onto,
 * because where the number goes is part of what a translation decides.
 */
import { LOCALE_META, type Locale } from "./locale";

/**
 * The forms a catalog offers for one counted phrase.
 *
 * `other` is required and is the fallback: `Intl.PluralRules` can return a
 * category this phrase has no form for (a catalog added for a language with
 * `few`/`many` and a phrase that did not spell them out), and a missing form
 * must degrade to a readable sentence rather than to `undefined`.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  readonly other: string;
};

/**
 * Resolvers are cached because `Intl.PluralRules` construction is not free and
 * these run inside render — `bookRow` alone is called once per shelf row.
 */
const rules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  const cached = rules.get(locale);
  if (cached) return cached;
  const made = new Intl.PluralRules(LOCALE_META[locale].tag);
  rules.set(locale, made);
  return made;
}

/** The phrase for `count`, in `locale`'s plural category, with `{n}` filled. */
export function plural(
  locale: Locale,
  count: number,
  forms: PluralForms
): string {
  const form = forms[rulesFor(locale).select(count)] ?? forms.other;
  return form.replaceAll("{n}", String(count));
}
