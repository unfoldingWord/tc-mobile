import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { noticePresentation, type NoticeTone } from "@/components/notice-tone";

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

/** Exact, standalone rules only; comments cannot supply a selector or value. */
function ruleBody(selector: string): string | null {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [
    ...css.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{([^{}]*)\\}`, "gm")),
  ];
  expect(rules.length, `ambiguous rule: ${selector}`).toBeLessThanOrEqual(1);
  const declarations = rules.at(0)?.[1];
  if (declarations === undefined) return null;
  const body = declarations.trim();
  expect(body, `empty rule: ${selector}`).not.toBe("");
  return body;
}

function requiredRule(selector: string): string {
  const body = ruleBody(selector);
  if (body === null) throw new Error(`missing rule: ${selector}`);
  return body;
}

function toneOverride(tone: NoticeTone): string {
  const selector = `.notice[data-tone="${tone}"]`;
  if (tone !== "info") return requiredRule(selector);
  // Info intentionally uses the base box; its glyph has a separate rule.
  expect(ruleBody(selector), "info must keep the base edge and ink").toBeNull();
  return "";
}

describe("the .notice rule honours the tone table (#164 L-14)", () => {
  it("has a base rule at all, which is the thing inline styles made impossible", () => {
    const base = requiredRule(".notice");
    // The box the component used to paint on itself.
    expect(base).toMatch(/background:\s*var\(--s-surface\)/);
    expect(base).toMatch(/border:\s*1px solid var\(--s-edge\)/);
    expect(base).toMatch(/color:\s*var\(--s-ink\)/);
  });

  it("the component no longer paints itself, or layer 3 could not win", () => {
    const notice = readFileSync(
      path.resolve(
        import.meta.dirname,
        "..",
        "src",
        "components",
        "notice.tsx"
      ),
      "utf8"
    );
    // The whole reason this lane exists. An inline `style` beats every layer,
    // so one reintroduced here silently voids every assertion above.
    expect(notice).not.toMatch(/style=\{\{/);
    expect(notice).toMatch(/className="notice"/);
    expect(notice).toMatch(/data-tone=\{tone\}/);
  });

  for (const tone of TONES) {
    const spec = noticePresentation(tone);

    it(`${tone}: the glyph colour matches the table's \`glyph\``, () => {
      // `glyph` is in the table rather than the JSX because, for a translator
      // who cannot read, the colour is the second half of what tells the three
      // marks apart (George G3). That claim only means something if the
      // stylesheet actually paints it.
      const body = requiredRule(`.notice[data-tone="${tone}"] .notice-glyph`);
      expect(body).toMatch(
        new RegExp(`color:\\s*${spec.glyph.replace(/[()]/g, "\\$&")}`)
      );
    });

    it(`${tone}: \`failure\` decides the live edge, and only for a failure`, () => {
      expect(requiredRule(".notice")).toMatch(
        /(?:^|;)\s*border:\s*1px solid var\(--s-edge\)\s*;/
      );
      const body = toneOverride(tone);
      if (spec.failure) {
        expect(body).toMatch(/(?:^|;)\s*border-color:\s*var\(--s-live\)\s*;/);
      } else {
        expect(body).not.toMatch(/(?:^|;)\s*border(?:-[\w-]+)?:/);
      }
    });

    it(`${tone}: \`muted\` decides the muted ink, and only for a wait`, () => {
      expect(requiredRule(".notice")).toMatch(
        /(?:^|;)\s*color:\s*var\(--s-ink\)\s*;/
      );
      const body = toneOverride(tone);
      if (spec.muted) {
        expect(body).toMatch(/(?:^|;)\s*color:\s*var\(--s-ink-muted\)\s*;/);
      } else {
        expect(body).not.toMatch(/(?:^|;)\s*color:/);
      }
    });
  }
});
