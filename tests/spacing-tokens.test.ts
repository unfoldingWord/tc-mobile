import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule, declarationValue, stripComments } from "./support";

/**
 * #460: the recurring arbitrary-pixel spacing values in `src/components` are
 * named component tokens, so no component spells a `-[<n>px]` spacing utility.
 * Values are pinned so a token that drifts from the pixels it replaced fails.
 * The component half reads comment-stripped source (a comment holding the old
 * class cannot satisfy or trip it).
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const TOKENS: Record<string, string> = {
  "--c-panel-pad-x": "22px",
  "--c-panel-gap": "18px",
  "--c-panel-actions-inset": "10px",
  "--c-notice-inset-x": "12px",
  "--c-toolbar-pad-x": "16px",
  "--c-meter-pad-x": "16px",
  "--c-header-pad-y": "2px",
  "--c-empty-pad-x": "24px",
  "--c-licence-gap-tight": "3px",
  "--c-licence-gap-section": "10px",
};

const ARBITRARY_SPACING =
  /\b(?:gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|space-[xy])-\[[0-9.]+(?:px|rem)\]/g;

const componentSources = () => {
  const dir = path.join(root, "src/components");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ f, code: stripComments(read(`src/components/${f}`)) }));
};

describe("spacing tokens (#460)", () => {
  const rule = cssRule(read("src/app/styles/3-components.css"), ":root");

  for (const [name, value] of Object.entries(TOKENS)) {
    it(`${name} is ${value}`, () => {
      expect(declarationValue(rule, name)).toBe(value);
    });
  }

  it("no component spells an arbitrary-pixel spacing utility", () => {
    const sources = componentSources();
    expect(sources.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const { f, code } of sources) {
      for (const m of code.matchAll(ARBITRARY_SPACING)) {
        hits.push(`${f}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("every token is consumed by a component", () => {
    const all = componentSources()
      .map((s) => s.code)
      .join("\n");
    for (const name of Object.keys(TOKENS)) {
      expect(all, name).toContain(`var(${name})`);
    }
  });
});
