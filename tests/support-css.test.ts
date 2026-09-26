import { describe, expect, it } from "vitest";

import { cssRule, declarationValue } from "./support";

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
    expect(declarationValue("color: var(--s-live-ink);", "color")).not.toBe(
      "var(--s-live)"
    );
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
