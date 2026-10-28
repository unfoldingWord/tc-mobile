/**
 * Count-varying wording, chosen by the locale's plural rule rather than by an
 * English `n === 1` ternary.
 *
 * Six labels in `lib/strings.ts` used to branch on `n === 1` inline.
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
import { activeLocale } from "./locale";
import { formatNumber } from "./number-format";

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
  /**
   * An EXACT-1 arm, ICU's `=1`: chosen when `n === 1` and for no other count,
   * ahead of the category. It is not `one`. CLDR's `one` is a category the
   * locale defines — Russian, Ukrainian and Lithuanian select it for 21, 31
   * and 101 too, and some locales select it for 0 — so wording that means
   * "exactly one" ("an included chapter") keyed off `one` would assert one of
   * a count that is not one. A table that carries `"=1"` states that claim
   * outright; the category forms then only have to agree with their count.
   */
  readonly "=1"?: string;
} & {
  readonly [K in Exclude<PluralCategory, "other">]?: string;
};

/**
 * `Intl.PluralRules` construction is not free and these labels render on every
 * list row, so keep one per locale. The map is keyed by the locale string as
 * passed, so it grows by one entry per locale the app has counted in.
 */
const rules = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string): Intl.PluralRules {
  const cached = rules.get(locale);
  if (cached) return cached;
  // `cardinal` is the default, and relying on a default is how a reader ends
  // up having to know it. These are counts of things ("3 chapters"), never
  // positions ("the 3rd chapter"), and the two select differently — English
  // ordinals use `one`/`two`/`few`/`other` where its cardinals use only
  // `one`/`other`. Saying which makes the day someone wants an ordinal phrase
  // visible at the construction instead of inferred (#713, George r1 Low 2).
  const made = new Intl.PluralRules(locale, { type: "cardinal" });
  rules.set(locale, made);
  return made;
}

/**
 * The phrase for `n`, with `{n}` replaced by the count.
 *
 * The count is interpolated through `formatNumber` (`lib/number-format.ts`),
 * which forces Latin digits (R19, ADR 0015 (h)) and no grouping, the same entry
 * `formatDuration`'s clock uses. A locale cannot restyle the digits here.
 *
 * Every `{n}` is replaced, not just the first: a form is free to name the count
 * twice.
 *
 * `locale` defaults to `activeLocale().tag`, the locale whose table is
 * installed (`lib/locale.ts`, ADR 0015 (b)), rather than to a `"en"` or a build
 * constant of its own. An independent default would be a second source of
 * truth: a French table counting by English rules the moment the phone's
 * language moved, which is the note QA and George both left on #673.
 */
export function plural(
  n: number,
  forms: PluralForms,
  locale: string = activeLocale().tag
): string {
  const category = rulesFor(locale).select(n) as PluralCategory;
  // The exact arm is matched on the number, never on the locale's category.
  const exact = n === 1 ? forms["=1"] : undefined;
  const form = exact ?? forms[category] ?? forms.other;
  // A FUNCTION replacer, not a string one. `replaceAll` reads `$&`, `` $` ``,
  // `$'`, `$$` and `$n` in a STRING replacement as substitution patterns. A
  // `number` through `String()` can only be digits, `-`, `.`, `e`, `+`, `NaN`
  // or `Infinity`, so none of them is reachable today and nothing here is a
  // live defect — which is also why no test covers this line, and saying so is
  // more honest than a case that could never have been observed red. The
  // function form makes the patterns inert for whatever the count becomes
  // later: a grouped or locale-formatted number, or a second placeholder
  // carrying something a translator typed (#713, George r1 Low 1).
  return form.replaceAll("{n}", () => formatNumber(n));
}
