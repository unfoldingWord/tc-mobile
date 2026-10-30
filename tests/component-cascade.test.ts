import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";
import { AREA_DIR, readAreaCss } from "./o4-area-css";
import {
  builtCssRules,
  compareSpecificity,
  normalizeSelector,
  specificity,
  subjectCompound,
  type BuiltCssRule,
} from "./support";

/**
 * The component layer's cascade, read from the shipped `dist/assets/*.css`
 * (#954). It replaces the per-file "every selector starts with `:root`"
 * checks the area-stylesheet suites carried, and the dist half of
 * `tests/o4-cascade.test.ts`.
 *
 * Two stylesheets write into the one `@layer components`: the base,
 * `src/app/styles/3-components.css`, and the area files under
 * `src/app/styles/3-components/`, imported after it. Sharing one layer means a tie in
 * specificity goes to whichever rule comes later, and the area files rely on
 * that. A `:root ` prefix on every area selector used to hold each area rule
 * one step above the base rule it restyles; #954 takes that prefix off, and
 * this gate is what says, statically, where an area rule now loses.
 *
 * THREE CLAIMS, each on the built file, because the bundler and the minifier
 * decide the order that ships, not the source:
 *
 *   1. LAYER ORDER. There is one components block; it opens before the
 *      utilities layer; and every base rule in it comes before every area
 *      rule. Every built rule maps back to a source rule in one of the two
 *      sets, and every source rule with a declaration is found in the build,
 *      which is the non-empty floor for everything below.
 *   2. THE SENTINEL. `3-components/index.css`'s one declaration is the last thing in
 *      the components block, right before the utilities layer opens. A
 *      comment-only marker would not survive: the build strips comments, so
 *      an empty `@layer components {}` compiles to nothing.
 *   3. CONTESTED PAIRS. A contested pair is an area rule and a base rule that
 *      share a property, whose subjects (right-most compounds) can be the
 *      same box, and where the base rule wins: it is more specific, or its
 *      declaration is `!important` and the area one is not. The set of pairs
 *      found must equal `REVIEWED` below, each with a reason. A new area rule
 *      that loses to a base rule fails here until someone looks at it.
 *
 * "Can be the same box" is a static guess, on purpose wide: the two subjects
 * share a class, or one of them has no class at all; and they target the
 * same pseudo-element, or neither does. Two rules whose subjects share no
 * class can still meet on one element (`class="a b"`); the computed-style
 * diff (#954's PR 1) is the check for those.
 *
 * WHAT THIS DOES NOT SEE. It runs no browser. It compares property names
 * exactly, so a shorthand against one of its longhands (`padding` against
 * `padding-top`) is not counted as a pair. It ignores the conditions of
 * `@media` and `@supports`, so a pair counts whether or not both conditions
 * can hold at once. A pair it lists may never meet on a screen; a pair the
 * subject test drops may.
 *
 * Skip and fail follow `./dist-gate`: this runs under `npm run test:dist`,
 * after `npm run build`, and skips everywhere else.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS_DIR = path.join(ROOT, "dist", "assets");
const STYLES = path.join(ROOT, "src", "app", "styles");

/** Every built stylesheet. More than one fails inside the gated suite, not
 *  at import, so `npm test` can still skip this file. */
const CSS_FILES = existsSync(ASSETS_DIR)
  ? readdirSync(ASSETS_DIR).filter((n) => n.endsWith(".css"))
  : [];
const GATE = resolveDistGate(CSS_FILES.length > 0, "dist/assets/*.css");

const LAYER = "@layer components";

/** The minified sentinel rule `3-components/index.css` declares. */
const SENTINEL = ":root{--c-components-last:1}";

/** A source rule, in the one spelling the build is compared in. */
interface SourceRule {
  key: string;
  selector: string;
  declarations: BuiltCssRule["declarations"];
}

/** The rules of a stylesheet's text that carry at least one declaration —
 *  the minifier drops a rule with none. */
function sourceRules(css: string): SourceRule[] {
  return builtCssRules(css)
    .filter((rule) => rule.declarations.length > 0)
    .map((rule) => ({
      key: ruleKey(rule.selector, rule.context),
      selector: rule.selector,
      declarations: rule.declarations,
    }));
}

/** Source rules by key; a key a file writes twice keeps both rules'
 *  declarations. */
function byKey(rules: readonly SourceRule[]): Map<string, SourceRule> {
  const map = new Map<string, SourceRule>();
  for (const rule of rules) {
    const seen = map.get(rule.key);
    map.set(
      rule.key,
      seen
        ? {
            ...seen,
            declarations: [...seen.declarations, ...rule.declarations],
          }
        : rule
    );
  }
  return map;
}

/**
 * Which side a built rule came from, when both sources write its key (an
 * area rule restyling a base selector at the same weight, once #954 takes
 * the `:root` prefix off). Told apart by the built declarations, never by
 * order — order is what the layer-order check tests. A side fits when it
 * writes every built property at the same importance; when both fit, the
 * value decides, compared without whitespace. Undecided is `null`, which
 * the caller reports as unmapped: fail closed.
 */
function sideByDeclarations(
  built: BuiltCssRule["declarations"],
  sides: readonly ["base" | "area", SourceRule][]
): "base" | "area" | null {
  const bare = (v: string) => v.replace(/\s+/g, "").toLowerCase();
  const pick = (exact: boolean) =>
    sides.filter(([, src]) =>
      built.every((bd) =>
        src.declarations.some(
          (sd) =>
            sd.property === bd.property &&
            sd.important === bd.important &&
            (!exact || bare(sd.value) === bare(bd.value))
        )
      )
    );
  const fits = pick(false);
  if (fits.length === 1) return fits[0]![0];
  if (fits.length === 0) return null;
  const exact = pick(true);
  return exact.length === 1 ? exact[0]![0] : null;
}

/** Selector plus every at-rule inside the components layer, so a selector
 *  restyled under reduced motion is a different rule from its base. */
function ruleKey(selector: string, context: readonly string[]): string {
  const inner = context.filter((c) => c !== LAYER);
  return [...inner, normalizeSelector(selector)].join(" » ");
}

/** The area files, in `3-components/index.css`'s import order. */
function areaFiles(): string[] {
  const index = postcss.parse(readAreaCss("index"));
  const files = index.nodes
    .filter(
      (n): n is postcss.AtRule => n.type === "atrule" && n.name === "import"
    )
    .map((n) => n.params.replace(/^["']\.\/|["']$/g, ""));
  if (files.length === 0)
    throw new Error("3-components/index.css imports no files");
  return files;
}

/** One built selector with its source side resolved. */
interface Placed {
  order: number;
  key: string;
  side: "base" | "area" | "sentinel";
  /** The selector as the source writes it, for a pair's label. */
  source: string;
  /** The selector as it ships, which is what the browser weighs. */
  shipped: string;
  /** The rule's at-rules inside the layer, as the source writes them. */
  context: string[];
  declarations: BuiltCssRule["declarations"];
}

/**
 * The minifier writes a colour-mix() value twice: a fallback in the rule
 * itself, and the colour-mix() form again inside this `@supports` block,
 * which the source never wrote. A rule found only here maps to its source
 * rule outside the block.
 */
const GENERATED_SUPPORTS = "@supports (color:color-mix(in lab,red,red))";

/**
 * The source selectors one built selector stands for. The minifier can wrap
 * a whole selector list in one `:is()` (today's build does it to two lists
 * whose members use `:has()`); each member is a source selector of its own.
 * The browser weighs the wrapped form, which is `shipped`: `:is()` gives
 * every member the weight of the heaviest.
 */
function sourceMembers(selector: string): string[] {
  if (!selector.startsWith(":is(")) return [selector];
  // `:is(a) :is(b)` also starts and ends with brackets; only one `:is()`
  // whose `(` closes at the last character wraps the whole selector.
  let depth = 0;
  for (let i = 3; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    if (selector[i] === ")" && --depth === 0) {
      return i === selector.length - 1
        ? postcss.list.comma(selector.slice(4, -1))
        : [selector];
    }
  }
  return [selector];
}

/** Each built components rule, sided by its source. The sentinel's `:root`
 *  is the last rule; any other `:root` is the base's. A key both sources
 *  write is sided by `sideByDeclarations`. */
function place(
  css: string,
  baseByKey: ReadonlyMap<string, SourceRule>,
  areaByKey: ReadonlyMap<string, SourceRule>
): { placed: Placed[]; unmapped: string[] } {
  const rules = builtCssRules(css).filter((r) => r.context[0] === LAYER);
  const sentinelKey = ruleKey(":root", []);
  const placed: Placed[] = [];
  const unmapped: string[] = [];
  const lastOrder = rules.at(-1)?.order;
  for (const rule of rules) {
    for (const member of sourceMembers(rule.selector)) {
      let context = rule.context.filter((c) => c !== LAYER);
      let key = ruleKey(member, context);
      if (
        !baseByKey.has(key) &&
        !areaByKey.has(key) &&
        context.includes(GENERATED_SUPPORTS)
      ) {
        context = context.filter((c) => c !== GENERATED_SUPPORTS);
        key = ruleKey(member, context);
      }
      const inBase = baseByKey.get(key);
      const inArea = areaByKey.get(key);
      const at = {
        order: rule.order,
        key,
        shipped: rule.selector,
        context,
        declarations: rule.declarations,
      };
      if (rule.order === lastOrder && key === sentinelKey) {
        placed.push({ ...at, side: "sentinel", source: ":root" });
        continue;
      }
      const side =
        inBase !== undefined && inArea !== undefined
          ? sideByDeclarations(rule.declarations, [
              ["base", inBase],
              ["area", inArea],
            ])
          : inBase !== undefined
            ? "base"
            : inArea !== undefined
              ? "area"
              : null;
      const src = side === "base" ? inBase : side === "area" ? inArea : null;
      if (side !== null && src) {
        placed.push({ ...at, side, source: src.selector });
      } else {
        unmapped.push(
          inBase && inArea ? `${key} (written in both sources, unsided)` : key
        );
      }
    }
  }
  return { placed, unmapped };
}

/** Area rules the build writes before the last base rule. */
function earlyArea(placed: readonly Placed[]): string[] {
  const lastBase = Math.max(
    ...placed.filter((p) => p.side === "base").map((p) => p.order)
  );
  return placed
    .filter((p) => p.side === "area" && p.order < lastBase)
    .map((p) => p.source);
}

/** Source rules of one side the build never wrote on that side. */
function missing(
  rules: readonly SourceRule[],
  side: "base" | "area",
  placed: readonly Placed[]
): SourceRule[] {
  const built = new Set(
    placed.filter((p) => p.side === side).map((p) => p.key)
  );
  return rules.filter((r) => !built.has(r.key));
}

// Fixture CSS, not the build: runs under `npm test` too. A selector both
// sources write, as it ships once #954 takes the `:root` prefix off.
describe("a selector written in both sources (#954)", () => {
  const BASE = ".x{color:red;padding:1px}.y{margin:0}";
  const AREA = ".x{color:blue}";
  const sides = (baseCss: string, areaCss = AREA) => ({
    base: sourceRules(baseCss),
    baseByKey: byKey(sourceRules(baseCss)),
    areaByKey: byKey(sourceRules(areaCss)),
  });
  const wrap = (body: string) => `@layer components{${body}}`;

  it("maps an equal-weight override to both sides, and contests nothing", () => {
    const s = sides(BASE);
    const { placed, unmapped } = place(
      wrap(`${BASE}.x{color:blue}`),
      s.baseByKey,
      s.areaByKey
    );
    expect(unmapped).toEqual([]);
    expect(placed.map((p) => p.side)).toEqual(["base", "base", "area"]);
    expect(missing(s.base, "base", placed)).toEqual([]);
    expect(earlyArea(placed)).toEqual([]);
    expect(contestedPairs(placed)).toEqual([]);
  });

  it("contests the override when the base side is !important", () => {
    const baseCss = ".x{color:red!important;padding:1px}.y{margin:0}";
    const s = sides(baseCss);
    const { placed, unmapped } = place(
      wrap(`${baseCss}.x{color:blue}`),
      s.baseByKey,
      s.areaByKey
    );
    expect(unmapped).toEqual([]);
    expect(contestedPairs(placed)).toEqual([".x ⟵ .x [color]"]);
  });

  it("contests the override when a base rule is more specific", () => {
    const baseCss = `${BASE}.y .x{color:red}`;
    const s = sides(baseCss);
    const { placed } = place(
      wrap(`${baseCss}.x{color:blue}`),
      s.baseByKey,
      s.areaByKey
    );
    expect(contestedPairs(placed)).toEqual([".x ⟵ .y .x [color]"]);
  });

  it("sees the area occurrence written before the base occurrence", () => {
    const s = sides(BASE);
    const { placed, unmapped } = place(
      wrap(`.x{color:blue}${BASE}`),
      s.baseByKey,
      s.areaByKey
    );
    expect(unmapped).toEqual([]);
    expect(earlyArea(placed)).toEqual([".x"]);
  });

  it("fails closed when the build merged the two, or cannot tell them apart", () => {
    // Merged into one rule: it fits only the base, so the area rule is
    // never found on its side.
    const s = sides(BASE);
    const merged = place(
      wrap(".x{color:blue;padding:1px}.y{margin:0}"),
      s.baseByKey,
      s.areaByKey
    ).placed;
    expect(missing(sourceRules(AREA), "area", merged)).toHaveLength(1);
    const same = sides(".x{color:red}", ".x{color:red}");
    expect(
      place(wrap(".x{color:red}.x{color:red}"), same.baseByKey, same.areaByKey)
        .unmapped
    ).toHaveLength(2);
  });
});

describe.skipIf(GATE === "skip")(
  "the component layer's cascade (dist/assets/*.css, requires a prior `npm run build`)",
  () => {
    // Guarded: vitest still runs this factory when the gate skips; more
    // than one stylesheet fails the first case below, not the import.
    const css =
      CSS_FILES.length === 1
        ? readFileSync(path.join(ASSETS_DIR, CSS_FILES[0]!), "utf8")
        : "";

    const read = (file: string) => sourceRules(readFileSync(file, "utf8"));
    const base = read(path.join(STYLES, "3-components.css"));
    const area = areaFiles().flatMap((name) => read(path.join(AREA_DIR, name)));
    const { placed, unmapped } =
      css === ""
        ? { placed: [], unmapped: [] }
        : place(css, byKey(base), byKey(area));

    it("reads one built stylesheet", () => {
      expect(CSS_FILES).toHaveLength(1);
    });

    describe("layer order", () => {
      it("has one components block, opened before the utilities layer", () => {
        const layers = postcss
          .parse(css)
          .nodes.filter(
            (n): n is postcss.AtRule =>
              n.type === "atrule" && n.name === "layer"
          )
          .map((n) => n.params);
        expect(layers.filter((name) => name === "components")).toHaveLength(1);
        expect(layers.indexOf("components")).toBeLessThan(
          layers.indexOf("utilities")
        );
      });

      it("maps every built component rule to exactly one source rule", () => {
        expect(placed.length).toBeGreaterThan(0);
        expect(unmapped).toEqual([]);
      });

      it("finds every base and area source rule in the build", () => {
        expect(base.length).toBeGreaterThan(0);
        expect(area.length).toBeGreaterThan(0);
        expect(missing(base, "base", placed)).toEqual([]);
        expect(missing(area, "area", placed)).toEqual([]);
      });

      it("writes every base rule before every area rule", () => {
        expect(earlyArea(placed)).toEqual([]);
      });
    });

    describe("the sentinel", () => {
      it("survives the build and closes the components block", () => {
        expect(placed.at(-1)?.side).toBe("sentinel");
        expect(css).toContain(`${SENTINEL}}@layer utilities{`);
      });
    });

    describe("contested pairs", () => {
      const pairs = contestedPairs(placed);

      it("finds only the pairs that have been reviewed", () => {
        expect(pairs).toEqual(Object.keys(REVIEWED).sort());
      });

      it("gives every reviewed pair a reason", () => {
        const bare = Object.entries(REVIEWED)
          .filter(([, reason]) => reason.trim() === "")
          .map(([pair]) => pair);
        expect(bare).toEqual([]);
      });
    });
  }
);

/**
 * Each contested pair as `area ⟵ base [properties]`, sorted, with at-rule
 * context written before a selector it applies to. See this file's header
 * for what counts.
 */
function contestedPairs(placed: readonly Placed[]): string[] {
  const bases = placed.filter((p) => p.side === "base");
  const pairs = new Map<string, Set<string>>();
  for (const a of placed.filter((p) => p.side === "area")) {
    const aSubject = subjectCompound(a.source);
    const aWeight = specificity(a.shipped);
    for (const b of bases) {
      const bSubject = subjectCompound(b.source);
      if (aSubject.pseudoElement !== bSubject.pseudoElement) continue;
      const shareClass =
        aSubject.classes.length === 0 ||
        bSubject.classes.length === 0 ||
        aSubject.classes.some((c) => bSubject.classes.includes(c));
      if (!shareClass) continue;
      const bWeight = specificity(b.shipped);
      for (const ad of a.declarations) {
        const baseWins = b.declarations.some(
          (bd) =>
            bd.property === ad.property &&
            (bd.important !== ad.important
              ? bd.important
              : compareSpecificity(bWeight, aWeight) > 0)
        );
        if (!baseWins) continue;
        const pair = `${label(a)} ⟵ ${label(b)}`;
        const props = pairs.get(pair) ?? new Set<string>();
        props.add(ad.property);
        pairs.set(pair, props);
      }
    }
  }
  return [...pairs]
    .map(([pair, props]) => `${pair} [${[...props].sort().join(", ")}]`)
    .sort();
}

function label(rule: Placed): string {
  return [...rule.context, rule.source].join(" » ");
}

/**
 * The contested pairs on develop when this gate landed, each with why it is
 * allowed to stand. The target, once #954's flatten slices land, is empty.
 *
 * Every entry below is one the subject test lets through only because one
 * side's subject has no class. Each reason says why the two subjects still
 * cannot be one element, from the markup that renders them; if that markup
 * changes, the reason is what to re-check.
 */
const DOT =
  "The progress dots are bare <i> elements with no class (books-screen.tsx, " +
  "inside .books-dots), so a base rule whose subject needs a class can " +
  "never match one.";
const NOT_AN_ICON =
  "Only <Icon> sets data-rtl-mirror (icon.tsx), and only on its own <svg>.";

const REVIEWED: Record<string, string> = {
  ':root .books-dots > [data-state="finished"] ⟵ .recorder-sheet--finished .recorder-toolbar.pair .control--play [background]':
    DOT,
  ':root .books-dots > [data-state="recorded"] ⟵ .recorder-sheet--finished .recorder-toolbar.pair .control--play [background]':
    DOT,
  ":root .books-dots > i ⟵ .control--quiet:disabled:hover [background]": DOT,
  ':root .books-dots > i ⟵ .control--quiet[aria-disabled="true"]:hover [background]':
    DOT,
  ":root .books-dots > i ⟵ .recorder-sheet--finished .recorder-toolbar.pair .control--play [background]":
    DOT,
  ":root .books-dots > i ⟵ .recorder-toolbar.pair .control--play [height, width]":
    DOT,
  ":root .books-dots > i ⟵ .recorder-toolbar.pair .control--record [height, width]":
    DOT,
  ':root .books-dots > i ⟵ .vu-meter[data-state="unavailable"] .vu-meter__track [background]':
    DOT,
  ":root .language-row [lang] ⟵ .recorder-sheet--finished .recorder-toolbar.pair .control--play [color]":
    "The [lang] element is the autonym <span> inside a language row " +
    "(language-ask.tsx), which carries no class, so .control--play cannot " +
    "match it.",
  ':root .recorder-cut .cut-anchor ⟵ :root[dir="rtl"] svg[data-rtl-mirror] [transform]': `.cut-anchor is a <div> (cut-anchor.tsx), and the base rule needs an <svg>. ${NOT_AN_ICON}`,
  ':root .share-o4-ring ⟵ :root[dir="rtl"] svg[data-rtl-mirror] [transform]': `.share-o4-ring is an <svg> drawn by share-progress-panel.tsx, not by <Icon>. ${NOT_AN_ICON}`,
  ':root [data-sheet-drag] ⟵ :root[dir="rtl"] svg[data-rtl-mirror] [transform]':
    "Only menu.tsx writes data-sheet-drag, and only on the menu panel, " +
    `which is a <div>. ${NOT_AN_ICON}`,
};
