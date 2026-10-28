import { readFileSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";

import { cssScope, declarationValue, stripCssComments } from "./support";

/**
 * The area stylesheets (#954), read by selector rather than sliced.
 *
 * This is the ONE place a test names the folder the area files live in.
 * Every reader goes through `readAreaCss` (or `AREA_DIR`), so the folder move
 * #954 plans is one line here, and pointing this constant at a missing folder
 * fails every reader with ENOENT instead of leaving one quietly reading a
 * copy of the old path.
 */
export const AREA_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "app",
  "styles",
  "o4"
);

/** The ten area files, by the name their file carries. */
export type Area =
  | "books"
  | "controls"
  | "dialogs"
  | "errors"
  | "menus"
  | "motion"
  | "recorder"
  | "segments"
  | "share"
  | "sheets";

/** The raw text of one area file, or of the folder's `index.css`. */
export function readAreaCss(file: Area | "index"): string {
  return readFileSync(path.join(AREA_DIR, `${file}.css`), "utf8");
}

/**
 * The prefix each area file's selectors carry today. #954's flatten slices
 * remove the standalone `:root ` from one group of files at a time; each
 * slice flips its own files' entries here, so the readers follow without
 * editing every selector string they hold. The map goes when the last file
 * is flattened.
 */
const AREA_PREFIX: Readonly<Record<Area, string>> = {
  books: ":root ",
  controls: ":root ",
  dialogs: ":root ",
  errors: ":root ",
  menus: ":root ",
  motion: ":root ",
  recorder: ":root ",
  segments: ":root ",
  share: ":root ",
  sheets: ":root ",
};

/** `selector` as `area`'s file spells it: `areaSelector("books", ".books-card")`. */
export function areaSelector(area: Area, selector: string): string {
  return `${AREA_PREFIX[area]}${selector}`;
}

/**
 * The text of one block of an area file: the components layer's own rules by
 * default, or the block at `preludes` inside it (`"@media
 * (prefers-reduced-motion: reduce)"`, `"@keyframes shake"`). `cssScope`
 * strips comments, throws when a block is missing, doubled or empty, and
 * leaves out deeper blocks — so a rule restyled under reduced motion is not
 * read as the base rule, and a second reduced-motion block fails instead of
 * being read in the first one's place.
 */
export function areaScope(area: Area, ...preludes: string[]): string {
  return cssScope(readAreaCss(area), ["@layer components", ...preludes]);
}

/** One style rule of a scope: its selectors, whitespace collapsed, and its
 *  declaration body as `cssRule` returns one. */
export interface ScopeRule {
  readonly selectors: readonly string[];
  readonly body: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Every style rule directly in `scope` (the text `areaScope` returns),
 *  comments stripped. For a sweep over a whole block. */
export function scopeRules(scope: string): ScopeRule[] {
  return postcss
    .parse(stripCssComments(scope))
    .nodes.filter((n): n is postcss.Rule => n.type === "rule")
    .map((rule) => {
      const text = rule.toString();
      return {
        selectors: rule.selectors.map(squash),
        body: text.slice(text.indexOf("{") + 1, text.lastIndexOf("}")).trim(),
      };
    });
}

/** Every declaration in `scope` (a block's rules, or one rule's body) as
 *  `[property, value]`, the value's whitespace collapsed. For a sweep. */
export function scopeDeclarations(scope: string): [string, string][] {
  const out: [string, string][] = [];
  postcss.parse(stripCssComments(scope)).walkDecls((d) => {
    out.push([d.prop, squash(d.value)]);
  });
  return out;
}

/**
 * The declaration body of the ONE rule in `scope` whose selector list holds
 * `selector` (whitespace collapsed on both sides), for `declarationValue`.
 * `cssRule` matches a selector only where it opens its rule on its own line;
 * this also finds one member of a list (`:root .books-lifted` in
 * `segments.css`'s three-selector lift rule) and a selector Prettier wrapped.
 * Throws on a missing, ambiguous or empty rule, as `cssRule` does.
 */
export function areaRule(scope: string, selector: string): string {
  const want = squash(selector);
  const hits = scopeRules(scope).filter((r) => r.selectors.includes(want));
  if (hits.length > 1) {
    throw new Error(`areaRule: ambiguous rule (${hits.length}): ${want}`);
  }
  const body = hits.at(0)?.body;
  if (body === undefined) throw new Error(`areaRule: missing rule: ${want}`);
  if (body === "") throw new Error(`areaRule: empty rule: ${want}`);
  return body;
}

/** `areaRule`'s body, read one property at a time through `declarationValue`
 *  (which throws on a missing or doubled declaration), whitespace collapsed. */
export function declsFor(
  scope: string,
  selector: string
): { get(property: string): string } {
  const body = areaRule(scope, selector);
  return { get: (property) => squash(declarationValue(body, property)) };
}
