/**
 * Which language the shipped UI is written in, and which way it reads (#169) —
 * the decision alone, DOM-free, so it is a table rather than a browser.
 *
 * #169's fourth fix item: "Set `<html lang>`/`dir` and the manifest language
 * from the locale." Before this, `en` was written twice as a literal —
 * `index.html`'s `<html lang="en">` and `vite.config.ts`'s manifest `lang` —
 * and `dir` was written nowhere at all. Two copies of one fact drift; the
 * missing one is worse, because `dir` is not cosmetic. A right-to-left UI with
 * no `dir` is not a left-aligned UI, it is a broken one: the browser lays the
 * whole document out the wrong way round, and no amount of translated copy in
 * `strings.ts` fixes it. For an app whose users are speakers of languages the
 * UI does not have — Arabic, Persian, Urdu and Hebrew among the ones Bible
 * translation actually reaches — that attribute is the difference between a
 * second language being a data change and being a rewrite.
 *
 * So this module is the one place either fact is stated, and both consumers
 * derive from it: `withLocaleAttributes` rewrites the document's own `<html>`
 * tag, and `vite.config.ts`'s manifest reads the same two fields.
 *
 * WHY BUILD TIME AND NOT A RUNTIME APPLIER, which is the shape
 * `hooks/use-theme.ts` uses for the neighbouring problem. A theme is a stored
 * per-translator choice, so it cannot be known until the app runs. The shipped
 * UI language is a constant of the build, and `dir` in particular must be
 * right in the first byte the parser reads: flipping it after the first paint
 * would reflow the entire document, which is a far louder version of the dark
 * flash that hook's docblock names as its own residual. There is no stored
 * locale to read, so there is nothing a runtime pass could learn that the
 * build does not already know.
 *
 * WHAT THIS DOES NOT DO. It does not make the app multilingual. Selecting a
 * locale, and `strings[locale]` behind it, is the rest of #169 and is in
 * flight separately; this slice only removes the hard-coded `en` and supplies
 * the `dir` that was missing, so that when a second locale does land it is an
 * entry here rather than an edit in three files. Nothing about the running app
 * changes today: the shipped locale is still English, still left-to-right.
 */

/**
 * The two values `<html dir>` and the manifest's `dir` member both take.
 *
 * `auto` is the third value the HTML and manifest specs allow and is
 * deliberately absent: it asks the browser to guess the direction from the
 * first strongly-directional character in the content, which is a guess about
 * *data* being used to lay out *chrome*. A locale knows its own direction, so
 * stating it is always available and always right.
 *
 * Not exported: nothing outside this file names the type today, and knip's
 * `types` check fails an exported type nothing imports (AGENTS.md, "no
 * sprawl"). `Locale["dir"]` is the spelling for a caller that needs it, which
 * is why exporting this buys nothing.
 */
type Direction = "ltr" | "rtl";

/** A UI language, and which way it reads. */
export interface Locale {
  /** BCP 47 language tag, as `<html lang>` and the manifest both want it. */
  readonly tag: string;
  readonly dir: Direction;
}

/**
 * The locale this build ships.
 *
 * `dir` is carried as data rather than derived from the tag on purpose. A
 * tag-to-direction function has to encode a script table, and an incomplete
 * one is worse than none: it answers confidently and wrongly for the tag it
 * has not heard of. An entry states its own direction, so adding a language
 * cannot be half-right.
 *
 * `index.html` ships these same two values statically, as the fallback for
 * anything that reads the file without running the build.
 * `tests/locale.test.ts` pins the two together so they cannot drift.
 */
export const SHIPPED_LOCALE: Locale = { tag: "en", dir: "ltr" };

/**
 * A language tag that is safe to write into an attribute without escaping.
 *
 * BCP 47 is alphanumerics and hyphens (`en`, `pt-BR`, `az-Cyrl-AZ`), so
 * anything outside that set is a typo or an injection, and either way this
 * refuses rather than emits it — see `withLocaleAttributes` for why a throw is
 * the right failure here.
 */
const LANGUAGE_TAG = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/**
 * The runtime twin of `Direction` (#711). The type is erased at runtime, so
 * without this `dir` was the one input that reached the attribute text
 * unchecked — the tag has `LANGUAGE_TAG`, the direction had nothing. A locale
 * table that grows by data entry is exactly the caller the type cannot guard.
 * Exact and lower-case on purpose: the attribute is written as given, and
 * `withLocaleAttributes` refuses rather than normalises.
 */
const DIRECTION = /^(ltr|rtl)$/;

/** The document's opening tag, whatever attributes it already carries. */
const HTML_OPEN_TAG = /<html\b([^>]*)>/i;

/**
 * Put `lang` and `dir` on a document's `<html>` tag, replacing whatever was
 * there.
 *
 * A string transform rather than a DOM one so it stays in `lib/` and is a
 * table in Node: `vite.config.ts` calls it from a `transformIndexHtml` hook,
 * which is the only place in the build that sees the document as text. Vite
 * runs that hook in dev and in `build` alike, so the dev server and `dist/`
 * cannot disagree about the language.
 *
 * IT THROWS RATHER THAN PASSING THE DOCUMENT THROUGH. A build that cannot find
 * the tag it was asked to rewrite has not produced a correctly-labelled
 * document, and the failure it would otherwise ship is silent and invisible in
 * the one direction that matters — an untagged or mislabelled document looks
 * completely normal to whoever built it, reading the language they already
 * speak, and is wrong only on the phone of the person this attribute exists
 * for. AGENTS.md asks a gate to fail on the state it exists to catch; a
 * `transformIndexHtml` that quietly returned its input would be the half-gate
 * that file's "gate is tested in both states" rule is about.
 */
export function withLocaleAttributes(html: string, locale: Locale): string {
  if (!LANGUAGE_TAG.test(locale.tag)) {
    throw new Error(`withLocaleAttributes: not a language tag: ${locale.tag}`);
  }
  if (!DIRECTION.test(locale.dir)) {
    throw new Error(`withLocaleAttributes: not a direction: ${locale.dir}`);
  }
  const match = HTML_OPEN_TAG.exec(html);
  if (match === null) {
    throw new Error("withLocaleAttributes: no <html> tag to label");
  }
  const attributes = setAttribute(
    setAttribute(match[1] ?? "", "lang", locale.tag),
    "dir",
    locale.dir
  );
  return (
    html.slice(0, match.index) +
    `<html${attributes}>` +
    html.slice(match.index + match[0].length)
  );
}

/**
 * Replace one attribute inside an opening tag's attribute text, or append it
 * if it is not there yet.
 *
 * Quoted, unquoted and single-quoted spellings are all matched because this
 * runs over a file a human edits, and `dir=ltr` is valid HTML that a
 * hand-written tag can easily carry. Matching only the double-quoted form
 * would leave the old value in place beside the new one — two `dir`
 * attributes, first one winning, which is exactly the silent wrong answer the
 * caller's throw refuses elsewhere.
 *
 * The replacement is a FUNCTION, not a string (#711): `String.prototype.replace`
 * expands `$&`, `` $` ``, `$'` and `$n` inside a replacement string, so a value
 * carrying one would be spliced with pieces of the match instead of written
 * literally. The caller's two allowlists keep `$` out today; this keeps the
 * write literal if one of them is ever loosened.
 */
function setAttribute(attributes: string, name: string, value: string): string {
  const existing = new RegExp(
    `\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]*)`,
    "i"
  );
  const replacement = ` ${name}="${value}"`;
  return existing.test(attributes)
    ? attributes.replace(existing, () => replacement)
    : attributes + replacement;
}
