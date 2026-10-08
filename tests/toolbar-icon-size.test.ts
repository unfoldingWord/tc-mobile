import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * #1259: the glyphs inside the round bottom-bar buttons are drawn 25% larger
 * (O4), and the circles keep their size. `Icon` writes width/height as
 * SVG attributes (22 by default, 24 for the edit bar's quiet controls); a CSS
 * declaration beats an attribute, so the size is a rule in
 * `o4/recorder.css` and a declared-value read is what can pin it here
 * (`tests/render.ts` resolves no cascade, #197). This proves the declared
 * values only, not a computed style in a browser and not a phone.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const O4 = ":root";

/** Prettier wraps long selectors; `cssRule` matches one on the opening line. */
function flatten(css: string): string {
  return stripCssComments(css).replace(
    /([;{}])\s*([^;{}]+?)\s*\{/g,
    (_, end: string, sel: string) =>
      `${end}\n  ${sel.replace(/\s+/g, " ").trim()} {`
  );
}
const CSS = flatten(read("src/app/styles/o4/recorder.css"));

describe("the O4 bottom-bar glyph size (#1259)", () => {
  const bar = cssRule(CSS, `${O4} .recorder-toolbar`);

  it("defines each token as the base size times 1.25", () => {
    expect(declarationValue(bar, "--o4-toolbar-icon")).toBe(
      "calc(22px * 1.25)"
    );
    expect(declarationValue(bar, "--o4-toolbar-icon-quiet")).toBe(
      "calc(24px * 1.25)"
    );
  });

  it("sizes every bar control's glyph from the default token", () => {
    const rule = cssRule(CSS, `${O4} .recorder-toolbar .control svg`);
    expect(declarationValue(rule, "width")).toBe("var(--o4-toolbar-icon)");
    expect(declarationValue(rule, "height")).toBe("var(--o4-toolbar-icon)");
  });

  it("sizes the edit bar's quiet glyphs from the quiet token", () => {
    const rule = cssRule(
      CSS,
      `${O4} .recorder-toolbar.edit .control--quiet svg`
    );
    expect(declarationValue(rule, "width")).toBe(
      "var(--o4-toolbar-icon-quiet)"
    );
    expect(declarationValue(rule, "height")).toBe(
      "var(--o4-toolbar-icon-quiet)"
    );
  });

  it("leaves the circles as they were", () => {
    const pair = cssRule(
      CSS,
      `${O4} .recorder-toolbar.pair .control:not(.control--record):not(.control--play)`
    );
    expect(declarationValue(pair, "width")).toBe("64px");
    expect(declarationValue(pair, "height")).toBe("64px");
    const edit = cssRule(CSS, `${O4} .recorder-toolbar.edit .control`);
    expect(declarationValue(edit, "width")).toBe("var(--o4-secondary)");
    expect(declarationValue(edit, "height")).toBe("var(--o4-secondary)");
  });

  it("keeps the largest glyph inside the smallest circle with margin", () => {
    // The edit bar's circle bottoms out at the 44px touch floor (its `max(44px,`
    // clamp); the largest glyph is the quiet token's. Both are read from the
    // stylesheet: with the glyph written here as a literal, this could not go
    // red on a larger token once the exact-string test above was updated to
    // match it (#1262's review, batched in #1278).
    const floor = Number(
      /--o4-secondary:\s*max\(\s*(\d+)px/.exec(
        cssRule(CSS, `${O4} .recorder-toolbar.edit`)
      )?.[1]
    );
    const quiet =
      /^calc\(\s*(\d+(?:\.\d+)?)px\s*\*\s*(\d+(?:\.\d+)?)\s*\)$/.exec(
        declarationValue(bar, "--o4-toolbar-icon-quiet")
      );
    expect(quiet, "the quiet token is not `calc(<n>px * <k>)`").not.toBeNull();
    const glyph = Number(quiet![1]) * Number(quiet![2]);
    expect(floor).toBe(44);
    expect((floor - glyph) / 2).toBeGreaterThanOrEqual(6);
  });

  it("adds no colour declaration to the glyph rules", () => {
    for (const sel of [
      `${O4} .recorder-toolbar .control svg`,
      `${O4} .recorder-toolbar.edit .control--quiet svg`,
    ]) {
      const rule = cssRule(CSS, sel);
      expect(rule, sel).not.toMatch(/color|fill|stroke|background/);
    }
  });
});
