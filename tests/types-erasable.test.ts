/**
 * `src/types/**` is the innermost onion layer, declared in `eslint.config.mjs`
 * as "Domain types (no internal dependencies)" and compiled by
 * `tsconfig.lib.json` with no DOM lib. Both of those are about what it may
 * IMPORT. Neither says anything about what it may EMIT, and until #160 (L-17)
 * nothing did: `types/view.ts` carried a constant and two functions, and
 * `types/failure.ts` a constant, so a component was importing a function from
 * `@/types/...` — the one place in the tree nobody would look for one.
 *
 * The property this pins is the strongest reading of that header: a module in
 * `types/` erases. Transpile it and nothing runtime comes out.
 *
 * Checked by transpiling rather than by grepping the source, because a grep for
 * `export const` over a whole file hits the word inside a docblock — the trap
 * AGENTS.md names for `3-components.css` — and the natural repair is to weaken
 * the pattern until it can no longer catch the real thing. The compiler cannot
 * be fooled by prose.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const TYPES_DIR = join(import.meta.dirname, "..", "src", "types");

/**
 * The runtime code a module emits, normalised.
 *
 * A module with only types emits nothing at all, or the bare `export {}` the
 * compiler adds to keep it a module. Anything else is runtime.
 */
function emittedRuntime(source: string): string {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      removeComments: true,
    },
  });
  return outputText.replace(/export\s*\{\s*\};?/g, "").trim();
}

describe("types/ erases", () => {
  const files = readdirSync(TYPES_DIR).filter((f) => f.endsWith(".ts"));

  // A floor, not decoration: every assertion below lives inside a loop over
  // this list, so an enumeration that silently returned nothing would make
  // this whole suite pass while checking no file at all.
  it("finds the types modules to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)("%s emits no runtime code", (file) => {
    const source = readFileSync(join(TYPES_DIR, file), "utf8");
    expect(emittedRuntime(source)).toBe("");
  });

  // The other half of the gate. Without these, `emittedRuntime` could be
  // rewritten to return "" unconditionally and every case above would still be
  // green — which is how a gate quietly stops being one.
  it.each([
    ["a constant", "export const LIMIT = 50;"],
    ["a function", "export function pick(n: number) {\n  return n;\n}"],
    ["a class", "export class Box {}"],
    ["an enum", "export enum Kind {\n  A,\n}"],
    ["a side effect", "console.log('hi');"],
    // The shape that actually shipped: real types, one runtime export among
    // them. A checker that looked only at the first declaration would pass it.
    [
      "a constant below an interface",
      "export interface Row {\n  readonly id: string;\n}\nexport const BUCKETS = 120;",
    ],
  ])("would catch %s", (_label, source) => {
    expect(emittedRuntime(source)).not.toBe("");
  });

  it("is not fooled by the words in a docblock", () => {
    const source = [
      "/**",
      " * This module used to hold `export const ROW_PEAK_BUCKETS = 120;`",
      " * and `export function segmentRowState(...)`. It no longer does.",
      " */",
      "export interface SegmentRow {",
      "  readonly id: string;",
      "}",
    ].join("\n");
    expect(emittedRuntime(source)).toBe("");
  });
});
