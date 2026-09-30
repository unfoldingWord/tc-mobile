import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { strings } from "@/lib/strings";

/**
 * #169's "no glued fragments", for the save-failed block of the table: every
 * `saveFailed*` entry is worded as whole sentences, one per branch, so a
 * second locale translates each one rather than inheriting English's word
 * order and agreement from a frame with a noun phrase spliced into it.
 *
 * Read from the parse tree, so a comment can neither satisfy nor trip it.
 * Two shapes are what a fragment looks like here, and each is checked:
 *
 * - a string literal that starts in lower case is a piece of a sentence, not
 *   a sentence (`"edited recording"`);
 * - a template that interpolates anything but one of the entry's own
 *   parameters is splicing in words computed elsewhere (`${subject}`). A
 *   parameter is a value — an ordinal, a count — not copy.
 */
const file = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "lib",
  "strings.ts"
);
const source = ts.createSourceFile(
  file,
  readFileSync(file, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

interface Entry {
  name: string;
  params: Set<string>;
  literals: string[];
  spliced: string[];
}

function collect(): Entry[] {
  const entries: Entry[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.startsWith("saveFailed")
    ) {
      const init = node.initializer;
      const params = new Set<string>();
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        for (const p of init.parameters) {
          if (ts.isIdentifier(p.name)) params.add(p.name.text);
        }
      }
      const entry: Entry = {
        name: node.name.text,
        params,
        literals: [],
        spliced: [],
      };
      const walk = (n: ts.Node): void => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          entry.literals.push(n.text);
        } else if (ts.isTemplateExpression(n)) {
          entry.literals.push(n.head.text);
          for (const span of n.templateSpans) {
            if (
              !ts.isIdentifier(span.expression) ||
              !params.has(span.expression.text)
            ) {
              entry.spliced.push(span.expression.getText(source));
            }
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(init);
      entries.push(entry);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return entries;
}

const entries = collect();

describe("the save-failed copy is whole sentences (#169)", () => {
  it("finds every saveFailed entry the table exports", () => {
    // The floor under the two below: an empty walk would pass them both.
    const exported = Object.keys(strings).filter((key) =>
      key.startsWith("saveFailed")
    );
    expect(exported.length).toBeGreaterThan(10);
    expect(entries.map((e) => e.name).sort()).toEqual(exported.sort());
    expect(entries.flatMap((e) => e.literals).length).toBeGreaterThan(10);
  });

  it("holds no literal that starts mid-sentence", () => {
    const fragments = entries.flatMap((e) =>
      e.literals
        .filter((text) => /^[a-z]/.test(text))
        .map((text) => `${e.name}: ${JSON.stringify(text)}`)
    );
    expect(fragments).toEqual([]);
  });

  it("interpolates only the entry's own parameters", () => {
    const spliced = entries.flatMap((e) =>
      e.spliced.map((expr) => `${e.name}: \${${expr}}`)
    );
    expect(spliced).toEqual([]);
  });

  it("keeps the four held-take sentences as they read today", () => {
    expect(strings.saveFailedHeld(false, null)).toBe(
      "Your recording is still here."
    );
    expect(strings.saveFailedHeld(true, null)).toBe(
      "Your edited recording is still here."
    );
    expect(strings.saveFailedHeld(false, 3)).toBe(
      "Your recording of segment 3 is still here."
    );
    expect(strings.saveFailedHeld(true, 3)).toBe(
      "Your edited recording of segment 3 is still here."
    );
  });
});
