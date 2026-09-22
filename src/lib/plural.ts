/**
 * Count-varying wording, chosen by the locale's plural rule rather than by an
 * English `n === 1` ternary.
 *
 * Six labels in `components/strings.ts` used to branch on `n === 1` inline.
 * That reads as a formatting detail and is in fact a *rule*, and an English
 * one: it says a language has exactly two count forms and that the split falls
 * between one and two. Russian has three (1, 2–4, 5+), Arabic six, Japanese
 * one. So a second UI language could not have been a data change while the
 * rule was spelled out at each call site — every one of them would have had to
 * be rewritten, which is the state #169 exists to leave.
 *
 * Here the rule is `Intl.PluralRules`, which is CLDR's, and the *forms* are the
 * data: a table keyed by category. English supplies `one` and `other`; a
 * locale that needs `few`/`many` adds those keys and changes no code. Anything
 * the locale selects that the table does not carry falls back to `other`, so a
 * partly-translated table renders a real sentence rather than `undefined`.
 *
 * `lib/` rather than beside the table, because `hooks/` and `lib/` cannot
 * import upward (AGENTS.md's onion rule) and the sentences those layers return
 * have the same counts in them.
 */

/**
 * CLDR's plural categories — the keys a forms table may carry.
 *
 * Spelled out rather than taken from `Intl.LDMLPluralRule`, which TypeScript
 * only declares alongside the DOM-bearing `Intl` typings in some lib
 * configurations; `npm run typecheck:lib` compiles this file with no DOM lib at
 * all.
 *
 * Neither this nor `PluralForms` is exported: every table today is an object
 * literal at a `plural` call, so the parameter type checks it by inference and
 * an exported alias would be surface nothing imports (knip, AGENTS.md's "no
 * sprawl"). A locale module that wants to annotate its own tables is what
 * would export them, and it can when it exists.
 */
type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * The wording for each count form. `other` is required and is the fallback, so
 * a table can never select its way to nothing.
 *
 * Each form is a WHOLE phrase with `{n}` where the count goes, not a fragment
 * to be concatenated with a number by the caller: "{n} chapter" and
 * "{n} chapters" are two sentences of one table, and a language that puts its
 * numeral last can say so without the call site changing.
 */
type PluralForms = {
  readonly other: string;
} & {
  readonly [K in Exclude<PluralCategory, "other">]?: string;
};

/**
 * The UI's one locale today.
 *
 * `index.html`'s `<html lang>` and the manifest's `lang` still say "en"
 * separately — wiring all three to one source is the rest of #169 and is not
 * this module's to do. This default is the plural half of that: one place the
 * rule comes from, not six.
 */
const DEFAULT_LOCALE = "en";

/**
 * `Intl.PluralRules` construction is not free and these labels render on every
 * list row, so keep one per locale. The map is keyed by the locale string as
 * passed; there is one entry in practice.
 */
const rules = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string): Intl.PluralRules {
  const cached = rules.get(locale);
  if (cached) return cached;
  const made = new Intl.PluralRules(locale);
  rules.set(locale, made);
  return made;
}

/**
 * The phrase for `n`, with `{n}` replaced by the count.
 *
 * The count is interpolated as plain ASCII digits (`String(n)`), NOT
 * `toLocaleString`. Digit shaping is a separate decision this repo has already
 * made in the other direction — `formatDuration`'s clock is ASCII "because
 * digits read across scripts" (`lib/utils.ts`) — and changing it here would
 * quietly restyle every count in the app under cover of a plural fix. When a
 * locale that wants Arabic-Indic digits arrives, that is its own change, made
 * for both surfaces at once.
 *
 * Every `{n}` is replaced, not just the first: a form is free to name the count
 * twice.
 */
export function plural(
  n: number,
  forms: PluralForms,
  locale: string = DEFAULT_LOCALE
): string {
  const category = rulesFor(locale).select(n) as PluralCategory;
  const form = forms[category] ?? forms.other;
  return form.replaceAll("{n}", String(n));
}
