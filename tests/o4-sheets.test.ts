import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The O4 name sheet (#943, states 02 and G4 of `docs/design/o4-design-system.md`
 * §9) — the source half of `src/app/styles/o4/sheets.css`.
 *
 * WHAT THE FILE DOES. Every naming surface in the app — New book, Add chapter,
 * and the book, chapter and segment renames — is the shared `<Menu>` drawer
 * holding the one `NameEdit` field. Their markup lives in the screen files,
 * which batch 1 gives to the screen lanes, so this lane restyles them from CSS
 * alone: a `.menu-panel` that CONTAINS a `.name-edit` is a name sheet. The
 * `:has()` scope is what keeps every other menu (the ≡ menu, the book, chapter
 * and segment action lists) out of these rules.
 *
 * HOW IT READS THE FILE. Comments are stripped first, then each rule is found
 * by its exact selector and its declarations are matched — the
 * `share-progress.test.ts` shape AGENTS.md asks a CSS test to copy, not a
 * whole-file regex that a header comment naming a property could satisfy or
 * trip. The declaration-count floor below keeps an emptied file from passing
 * the per-rule checks by having no rules to check.
 *
 * WHAT THIS DOES NOT PROVE. Nothing here runs a cascade: whether these rules
 * win over `3-components.css` in the built bundle, whether `:has()` matches in
 * a given WebView, and how the sheet looks on a phone are all outside a
 * source read.
 */
const SHEETS_CSS = readFileSync(
  path.resolve(import.meta.dirname, "..", "src/app/styles/o4/sheets.css"),
  "utf8"
);

/** The stylesheet without its comments, so prose can never satisfy a match. */
const CODE = SHEETS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

/**
 * Every innermost `selector { declarations }` block. The file is one
 * `@layer components { … }` wrapper around flat rules, so a block with no
 * nested brace is a style rule — except the wrapper itself while it is still
 * empty, which is why an at-rule prelude is skipped explicitly.
 */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  for (const [, prelude = "", body = ""] of css.matchAll(
    /([^{}]+)\{([^{}]*)\}/g
  )) {
    if (prelude.trim().startsWith("@")) continue;
    const selectors = prelude
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const declarations = new Map<string, string>();
    for (const decl of body.split(";")) {
      const colon = decl.indexOf(":");
      if (colon === -1) continue;
      declarations.set(
        decl.slice(0, colon).trim(),
        decl
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, " ")
      );
    }
    found.push({ selectors, declarations });
  }
  return found;
}

const RULES = rules(CODE);

function rule(selector: string): ReadonlyMap<string, string> {
  const hit = RULES.find((r) => r.selectors.includes(selector));
  expect(hit, `no rule for ${selector} in o4/sheets.css`).toBeDefined();
  return hit!.declarations;
}

const O4 = '[data-design="o4"]';
const SCRIM = `${O4} .menu-scrim:has(.name-edit)`;
const SHEET = `${O4} .menu-panel:has(.name-edit)`;

describe("o4/sheets.css — the name sheet (02, G4)", () => {
  it("has rules to check (a floor, so an emptied file cannot pass vacuously)", () => {
    const count = RULES.reduce((n, r) => n + r.declarations.size, 0);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it("scopes every selector under the O4 switch, so the current look is untouched", () => {
    for (const { selectors } of RULES) {
      for (const selector of selectors) {
        expect(selector.startsWith(`${O4} `), selector).toBe(true);
      }
    }
  });

  it("restyles only a panel that holds the name field, never every menu", () => {
    for (const { selectors } of RULES) {
      for (const selector of selectors) {
        if (/\.menu-(scrim|panel)/.test(selector)) {
          expect(selector, selector).toMatch(
            /\.menu-(scrim|panel):has\(\.name-edit\)/
          );
        }
      }
    }
  });

  it("dims the backdrop with --s-dim", () => {
    expect(rule(SCRIM).get("background")).toBe("var(--s-dim)");
  });

  it("docks the sheet at the bottom, inset 8, radius 26, pad 12/16/20", () => {
    expect(rule(SCRIM).get("align-items")).toBe("flex-end");
    const sheet = rule(SHEET);
    expect(sheet.get("border-radius")).toBe("26px");
    expect(sheet.get("padding")).toBe("12px 16px 20px");
    expect(sheet.get("margin")).toMatch(/^8px /);
    expect(sheet.get("height")).toBe("auto");
    expect(sheet.get("background")).toBe("var(--s-surface)");
  });

  it("draws a 56 × 5 handle above the header", () => {
    const handle = rule(`${SHEET}::before`);
    expect(handle.get("content")).toBe('""');
    expect(handle.get("width")).toBe("56px");
    expect(handle.get("height")).toBe("5px");
    expect(handle.get("background")).toBe("var(--s-edge)");
  });

  it("sets the sheet title at 20/700", () => {
    const title = rule(`${SHEET} .t-title`);
    expect(title.get("font-size")).toBe("20px");
    expect(title.get("font-weight")).toBe("700");
  });

  it("sets the name input at 18/400, radius 12 — and never under iOS's 16px zoom floor", () => {
    const input = rule(`${O4} .name-input`);
    expect(input.get("font-size")).toBe("18px");
    expect(input.get("font-weight")).toBe("400");
    expect(input.get("border-radius")).toBe("12px");
    // `3-components.css`'s `.name-input` explains the floor (G5): a focused
    // field under 16px zooms the sheet on iOS Safari.
    expect(Number.parseFloat(input.get("font-size") ?? "0")).toBeGreaterThan(
      16
    );
  });

  it("does not touch selection or the iOS callout (#556, #564)", () => {
    for (const { declarations } of RULES) {
      for (const property of declarations.keys()) {
        expect(property).not.toMatch(/user-select|touch-callout/);
      }
    }
  });

  it("paints colour only through layer-2 roles, never a primitive or a literal", () => {
    for (const { selectors, declarations } of RULES) {
      for (const [property, value] of declarations) {
        const where = `${selectors.join(", ")} { ${property} }`;
        expect(value, where).not.toMatch(/--p-/);
        expect(value, where).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      }
    }
  });
});
