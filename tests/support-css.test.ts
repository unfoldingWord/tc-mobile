import { describe, expect, it } from "vitest";

import {
  builtCssRules,
  compareSpecificity,
  cssRule,
  cssScope,
  declarationValue,
  normalizeSelector,
  specificity,
  subjectCompound,
} from "./support";

/**
 * `declarationValue` is a gate other suites lean on, so it is tested in both
 * states (AGENTS.md): it returns the value for every legitimate body shape,
 * and throws — rather than returning something a `toBe` could match — for
 * each shape a bare `/color:\s*X/` used to let through (#533).
 */
describe("declarationValue (#533)", () => {
  it("reads the one declaration, wherever it sits in the body", () => {
    expect(declarationValue("color: var(--s-send);", "color")).toBe(
      "var(--s-send)"
    );
    expect(
      declarationValue("display: flex;\n    color: var(--s-ink);", "color")
    ).toBe("var(--s-ink)");
    // The last declaration of a rule may omit its semicolon.
    expect(declarationValue("gap: 0; color: var(--s-ink)", "color")).toBe(
      "var(--s-ink)"
    );
  });

  it("reads a real rule through cssRule", () => {
    const css = `
      /* .glyph { color: var(--p-cool-500); } — prose, not a rule */
      .glyph {
        background-color: var(--s-surface);
        color: var(--s-warn);
      }
    `;
    expect(declarationValue(cssRule(css, ".glyph"), "color")).toBe(
      "var(--s-warn)"
    );
  });

  it("is not satisfied by a longer property that ends in the name", () => {
    expect(() =>
      declarationValue("background-color: var(--s-send);", "color")
    ).toThrow("declarationValue: no color declaration");
    expect(() =>
      declarationValue("border-color: var(--s-live);", "color")
    ).toThrow("declarationValue: no color declaration");
  });

  it("returns the whole value, so a prefix of it cannot pass a toBe", () => {
    expect(declarationValue("color: var(--s-live-ink);", "color")).toBe(
      "var(--s-live-ink)"
    );
  });

  it("is not satisfied by declaration-shaped text inside a string or url()", () => {
    expect(() =>
      declarationValue('content: "; color: var(--s-send);"; gap: 0;', "color")
    ).toThrow("declarationValue: no color declaration");
    expect(() =>
      declarationValue("mask: url(data:x;color:red); gap: 0;", "color")
    ).toThrow("declarationValue: no color declaration");
    expect(
      declarationValue("content: 'a;b'; color: var(--s-ink);", "color")
    ).toBe("var(--s-ink)");
  });

  it("throws when a later declaration overrides the first", () => {
    expect(() =>
      declarationValue(
        "color: var(--s-send); color: var(--p-cool-500);",
        "color"
      )
    ).toThrow("declarationValue: color declared 2 times");
  });

  it("ignores a declaration that only a comment names", () => {
    expect(() =>
      declarationValue("/* color: var(--s-send); */ display: flex;", "color")
    ).toThrow("declarationValue: no color declaration");
  });

  it("throws on an empty value", () => {
    expect(() => declarationValue("color: ;", "color")).toThrow(
      "declarationValue: no color declaration"
    );
  });
});

/**
 * `cssScope` reads the body of ONE at-rule block, found by its path of
 * preludes (#954). `cssRule` alone matches a rule at any depth, so a selector
 * restyled inside a reduced-motion block throws "ambiguous", and a test that
 * wants the rule inside the block can only slice the file by hand.
 */
describe("cssScope (#954)", () => {
  const css = `
    /* @media (prefers-reduced-motion: reduce) { .a { gap: 9px; } } */
    @layer components {
      .a { gap: 1px; }
      @media (prefers-reduced-motion: reduce) {
        .a { gap: 2px; }
        @supports (display: grid) {
          .a { gap: 3px; }
        }
      }
    }
  `;

  it("returns the block's own rules, so cssRule reads the one inside it", () => {
    const motion = cssScope(css, [
      "@layer components",
      "@media (prefers-reduced-motion: reduce)",
    ]);
    expect(declarationValue(cssRule(motion, ".a"), "gap")).toBe("2px");
  });

  it("blanks deeper blocks, so a rule nested below the scope is not read", () => {
    const layer = cssScope(css, ["@layer components"]);
    expect(declarationValue(cssRule(layer, ".a"), "gap")).toBe("1px");
  });

  it("matches a prelude however its whitespace is written", () => {
    const motion = cssScope(css, [
      "@layer   components",
      "@media (prefers-reduced-motion:reduce)",
    ]);
    expect(declarationValue(cssRule(motion, ".a"), "gap")).toBe("2px");
  });

  it("throws on a missing prelude, not on a commented-out one", () => {
    expect(() =>
      cssScope(css, ["@media (prefers-reduced-motion: reduce)"])
    ).toThrow(
      "cssScope: missing block: @media (prefers-reduced-motion:reduce)"
    );
  });

  it("throws when a prelude appears twice at its level", () => {
    const twice = `${css}
      @layer components {
        @media (prefers-reduced-motion: reduce) { .b { gap: 0; } }
      }`;
    expect(() => cssScope(twice, ["@layer components"])).toThrow(
      "cssScope: block appears 2 times: @layer components"
    );
  });

  it("throws on a block with no rules of its own", () => {
    const hollow = `@layer components { @media print { .a { gap: 0; } } }`;
    expect(() => cssScope(hollow, ["@layer components"])).toThrow(
      "cssScope: empty block: @layer components"
    );
  });
});

/**
 * Selectors Level 4 specificity (#954), so the cascade gate can say which of
 * two rules wins without a browser.
 */
describe("specificity (#954)", () => {
  it.each([
    [":root .a", [0, 2, 0]],
    [".a::before", [0, 1, 1]],
    [".a:before", [0, 1, 1]],
    ["#a .b > li", [1, 1, 1]],
    ["a[href]", [0, 1, 1]],
    ['[data-x="a]b"]', [0, 1, 0]],
    ["*", [0, 0, 0]],
    ["* + *", [0, 0, 0]],
    [".x:has(.a .b)", [0, 3, 0]],
    [".x:is(.a, #b)", [1, 1, 0]],
    [":not(.a, .b.c)", [0, 2, 0]],
    [":where(.a .b) .c", [0, 1, 0]],
    [":nth-child(2n of .a.b)", [0, 3, 0]],
    [":nth-child(2n + 1)", [0, 1, 0]],
    [".hover\\:x", [0, 1, 0]],
    [':root[dir="rtl"] .crumb', [0, 3, 0]],
    [".menu-panel:has(> .tiles)", [0, 2, 0]],
  ])("%s is %j", (selector, expected) => {
    expect(specificity(selector)).toEqual(expected);
  });

  it("throws on a selector list, which has no one specificity", () => {
    expect(() => specificity(".a, .b")).toThrow(
      "specificity: a selector list, not one selector: .a, .b"
    );
  });

  it("orders two specificities left to right", () => {
    expect(compareSpecificity([0, 2, 0], [0, 1, 5])).toBeGreaterThan(0);
    expect(compareSpecificity([0, 1, 1], [0, 1, 1])).toBe(0);
    expect(compareSpecificity([0, 0, 9], [1, 0, 0])).toBeLessThan(0);
  });
});

describe("subjectCompound (#954)", () => {
  it.each([
    [".a .b:hover > .c.d::before", ["c", "d"], "before"],
    [".a:after", ["a"], "after"],
    [":root .x:has(.y)", ["x"], null],
    ["button", [], null],
    [".a + .b\\:c", ["b:c"], null],
  ])("%s", (selector, classes, pseudoElement) => {
    expect(subjectCompound(selector)).toEqual({ classes, pseudoElement });
  });
});

describe("normalizeSelector (#954)", () => {
  it("gives a source selector and its minified form one spelling", () => {
    expect(normalizeSelector(':root  .a >  .b::before , [dir="rtl"]')).toBe(
      normalizeSelector(":root .a>.b:before,[dir=rtl]")
    );
  });

  it("keeps a quoted value that is not an identifier quoted", () => {
    expect(normalizeSelector('[aria-label="a b"]')).toBe('[aria-label="a b"]');
  });

  it("keeps the descendant combinator", () => {
    expect(normalizeSelector(".a .b")).not.toBe(normalizeSelector(".a.b"));
  });
});

/**
 * `builtCssRules` lists every style rule in a stylesheet with its at-rule
 * context, one entry per selector, in source order (#954).
 */
describe("builtCssRules (#954)", () => {
  const css =
    "@layer components{.a,.b>.c{gap:1px;color:red!important}" +
    "@media (prefers-reduced-motion:reduce){.a{gap:0}}" +
    "@keyframes k{0%{opacity:0}to{opacity:1}}}";

  it("lists each selector of each rule with its context and declarations", () => {
    const a = {
      order: 0,
      context: ["@layer components"],
      declarations: [
        { property: "gap", value: "1px", important: false },
        { property: "color", value: "red", important: true },
      ],
    };
    expect(builtCssRules(css)).toEqual([
      { ...a, selector: ".a" },
      { ...a, selector: ".b>.c" },
      {
        order: 1,
        selector: ".a",
        context: [
          "@layer components",
          "@media (prefers-reduced-motion:reduce)",
        ],
        declarations: [{ property: "gap", value: "0", important: false }],
      },
    ]);
  });

  it("throws on a stylesheet with no style rules", () => {
    expect(() => builtCssRules("@layer components{}")).toThrow(
      "builtCssRules: no style rules"
    );
  });
});
