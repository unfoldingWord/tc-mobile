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
import { SHIPPED_LOCALE } from "./locale";

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
 * `Intl.PluralRules` construction is not free and these labels render on every
 * list row, so keep one per locale. The map is keyed by the locale string as
 * passed; there is one entry in practice.
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
 *
 * `locale` defaults to `SHIPPED_LOCALE.tag` — the build's one locale, the same
 * value `<html lang>` and the manifest are written from (`lib/locale.ts`, #697)
 * — rather than to a `"en"` of its own. An independent default would have been
 * a second source of truth the moment the first one moved, which is the exact
 * note QA and George both left on #673 while #697 was still in flight.
 */
export function plural(
  n: number,
  forms: PluralForms,
  locale: string = SHIPPED_LOCALE.tag
): string {
  const category = rulesFor(locale).select(n) as PluralCategory;
  const form = forms[category] ?? forms.other;
  // A FUNCTION replacer, not a string one. `replaceAll` reads `$&`, `` $` ``,
  // `$'`, `$$` and `$n` in a STRING replacement as substitution patterns. A
  // `number` through `String()` can only be digits, `-`, `.`, `e`, `+`, `NaN`
  // or `Infinity`, so none of them is reachable today and nothing here is a
  // live defect — which is also why no test covers this line, and saying so is
  // more honest than a case that could never have been observed red. The
  // function form makes the patterns inert for whatever the count becomes
  // later: a grouped or locale-formatted number, or a second placeholder
  // carrying something a translator typed (#713, George r1 Low 1).
  return form.replaceAll("{n}", () => String(n));
}
