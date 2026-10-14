import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Notice } from "@/components/notice";
import { noticePresentation, type NoticeTone } from "@/components/notice-tone";
import { one, render } from "./render";
import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * `notice-tone.ts` is the SPECIFICATION; `.notice` in layer 3 is the
 * implementation — and this is what makes the second honour the first
 * (#164 L-14).
 *
 * Before this, `Notice` painted itself with four inline `style` declarations.
 * That was not a tidiness question: an inline `style` outranks every `@layer`,
 * so while it was there this component could not HAVE a rule in layer 3 at all
 * — anything written for it would have lost to the element. Moving the box into
 * the stylesheet fixes the bridge, but it moves three claims the tone table
 * makes (`failure`, `muted`, `glyph`) out of the code path that used to consume
 * them, into CSS that AGENTS.md says nothing in this repo reads:
 *
 *   "Nothing in this repo reads CSS at all. There is no stylelint and no CSS
 *    plugin. An orphaned custom property or component token is invisible to
 *    every check."
 *
 * So the naive move would have left `tests/notice-tone.test.ts` pinning a table
 * that nothing renders from — a test passing about a fact with no consequence,
 * which is worse than the inline styles it replaced. This test closes that: it
 * reads the stylesheet and fails if the two disagree, which is what keeps those
 * three fields load-bearing rather than decorative.
 *
 * Bounded honestly: it compares DECLARED values in source, a rule-by-rule text
 * read, not a computed style in a browser. The #197 harness (`tests/render.ts`)
 * does not close that gap and is not meant to — it renders markup, and has no
 * stylesheet and no cascade. What a mounted `Notice` actually resolves to is a
 * browser question, and the Playwright suite is where it would be asked.
 */
const CSS = readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "src",
    "app",
    "styles",
    "3-components.css"
  ),
  "utf8"
);

const TONES: NoticeTone[] = ["alert", "busy", "info"];

/**
 * Every property a rule `body` declares, lower-cased, in order. Strings and
 * `url(…)` are masked first, as `declarationValue` masks them, so a `color:`
 * inside a quoted value is not read as a declaration.
 */
function declaredProperties(body: string): string[] {
  const masked = stripCssComments(body).replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\burl\([^)]*\)/g,
    "_"
  );
  return [...masked.matchAll(/(?<=^|;)\s*(-?[\w-]+)\s*:/g)].map((m) =>
    m[1]!.toLowerCase()
  );
}

/** A declaration that paints an edge: any `border*` but the radius, which is
 *  shape. */
const isEdge = (property: string): boolean =>
  property.startsWith("border") && !property.endsWith("radius");

/**
 * The base `.notice` box, held to the neutral edge, surface and ink as the
 * WHOLE of what it declares for each (#1092 item 1): one `border` shorthand
 * and no other edge declaration after it, one `background`, one `color`. A
 * later `border-color: var(--s-live)` in the same rule would otherwise give
 * every tone the failure edge while the shorthand still read neutral.
 */
function baseBox(): void {
  const base = cssRule(CSS, ".notice");
  expect(declarationValue(base, "border")).toBe("1px solid var(--s-edge)");
  expect(declaredProperties(base).filter(isEdge)).toEqual(["border"]);
  expect(declarationValue(base, "background")).toBe("var(--s-surface)");
  expect(
    declaredProperties(base).filter((p) => p.startsWith("background"))
  ).toEqual(["background"]);
  expect(declarationValue(base, "color")).toBe("var(--s-ink)");
}

/**
 * `cssRule` (`./support`, #533) already throws — rather than returning `""`
 * or `null` — when a rule is absent or ambiguous, which is what closed this
 * file's own vacuous-`info` finding (#533): `ruleBody(...) ?? ""` used to
 * coerce a miss into an empty string that both `info` assertions below then
 * regexed and compared to `false`, green and proving nothing. `info` has no
 * base override BY DESIGN, so its two per-tone tests must not ask "is the
 * override empty" (a `cssRule` throw can't answer that) — they assert the
 * MISSING-rule throw specifically, an honest "this rule does not exist", via
 * `toneOverride`; an ambiguous or empty `info` rule must still go red.
 */
function toneOverride(tone: NoticeTone): string {
  // Two policies here are deliberately fail-closed (#1092 items 2 and 3).
  // `cssRule` matches a rule nested in `@media`/`@supports` too, so a second,
  // conditional rule for a tone reads as ambiguous and goes red: a legitimate
  // one has to bring its own assertion. And `info` may have NO override, not
  // merely no edge or ink one: a non-colour override is a state decision, not
  // a free change.
  const selector = `.notice[data-tone="${tone}"]`;
  if (tone !== "info") return cssRule(CSS, selector);
  // Info intentionally uses the base box; its glyph has a separate rule.
  expect(
    () => cssRule(CSS, selector),
    "info must keep the base edge and ink"
  ).toThrow(`cssRule: missing rule: ${selector}`);
  return "";
}

describe("the .notice rule honours the tone table (#164 L-14)", () => {
  it("has a base rule at all, which is the thing inline styles made impossible", () => {
    // The box the component used to paint on itself.
    baseBox();
  });

  // Rendered, not read as text (#822): a comment in `notice.tsx` carrying
  // `className="notice"` kept the old source pin green over a live element
  // that no longer had the class. The markup cannot be satisfied by prose.
  for (const tone of TONES) {
    it(`${tone}: the component no longer paints itself, or layer 3 could not win`, () => {
      const box = one(
        render(createElement(Notice, { tone, children: "said once" })),
        '[role="alert"], [role="status"]'
      );
      // The whole reason this lane exists. An inline `style` beats every
      // layer, so one reintroduced here silently voids every assertion above.
      expect(box.hasAttribute("style")).toBe(false);
      expect(box.getAttribute("class")).toBe("notice");
      // The attribute every tone override below is keyed on.
      expect(box.getAttribute("data-tone")).toBe(tone);
    });
  }

  for (const tone of TONES) {
    const spec = noticePresentation(tone);

    it(`${tone}: the glyph colour matches the table's \`glyph\``, () => {
      // `glyph` is in the table rather than the JSX because, for a translator
      // who cannot read, the colour is the second half of what tells the three
      // marks apart (George G3). That claim only means something if the
      // stylesheet actually paints it.
      // The `color` declaration, exactly: the pattern this replaced was also
      // satisfied by a `background-color`, or by the first of two `color`
      // declarations when a later one overrides it (#533).
      const body = cssRule(CSS, `.notice[data-tone="${tone}"] .notice-glyph`);
      expect(declarationValue(body, "color")).toBe(spec.glyph);
    });

    it(`${tone}: \`failure\` decides the live edge, and only for a failure`, () => {
      baseBox();
      const body = toneOverride(tone);
      if (spec.failure) {
        expect(declarationValue(body, "border-color")).toBe("var(--s-live)");
        expect(declaredProperties(body).filter(isEdge)).toEqual([
          "border-color",
        ]);
      } else {
        expect(declaredProperties(body).filter(isEdge)).toEqual([]);
      }
    });

    it(`${tone}: \`muted\` decides the muted ink, and only for a wait`, () => {
      baseBox();
      const body = toneOverride(tone);
      if (spec.muted) {
        expect(declarationValue(body, "color")).toBe("var(--s-ink-muted)");
      } else {
        expect(declaredProperties(body)).not.toContain("color");
      }
    });
  }
});
