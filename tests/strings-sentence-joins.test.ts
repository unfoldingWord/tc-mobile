import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { libraryShareGapText } from "@/components/share-error-copy";
import { stringsEn } from "@/lib/strings";

/**
 * #1483 slice 2 — code does not join table sentences.
 *
 * Two whole sentences placed side by side need a separator, and the separator
 * is language: a space in English, none in Chinese, another mark elsewhere.
 * When code writes a template of two table sentences or a `.join(" ")` of
 * them, the separator is English inside a file no translator opens. The table
 * owns the join instead: `strings.sentences(a, b)`, as `trail` owns the path
 * separator.
 *
 * This reads the parse tree of every file under `src/` except the table. It
 * reports a use of the `strings` binding inside a template, as an operand of
 * `+`, or in a file that also calls `.join(<string literal>)`. A comment
 * cannot trip it or satisfy it. WHAT IT CANNOT SEE: a sentence reaching the
 * join through a value that did not come from `strings` in that file (one
 * passed in from another module), and a join through a helper that is not
 * `.join`.
 */

const SRC = path.resolve(import.meta.dirname, "../src");
const TABLE = path.join(SRC, "lib", "strings.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [full]
      : [];
  });
}

/** Where code puts table wording into running text, as `line: kind`. */
function codeSideJoins(source: string): string[] {
  const file = ts.createSourceFile(
    "x.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const usesTable = (node: ts.Node): boolean => {
    let found = false;
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === "strings") {
        const p = n.parent;
        if (!(ts.isPropertyAccessExpression(p) && p.name === n)) found = true;
      }
      if (!found) ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };
  const found: string[] = [];
  const at = (n: ts.Node, kind: string): void => {
    const line = file.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    found.push(`${line}: ${kind}`);
  };
  const fileUsesTable = usesTable(file);
  const visit = (n: ts.Node): void => {
    if (ts.isTemplateExpression(n) && n.templateSpans.some((s) => usesTable(s)))
      at(n, "template");
    else if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (usesTable(n.left) || usesTable(n.right))
    )
      at(n, "plus");
    else if (
      fileUsesTable &&
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "join" &&
      n.arguments.length === 1 &&
      ts.isStringLiteralLike(n.arguments[0]!)
    )
      at(n, "join");
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

describe("code never joins table sentences (#1483)", () => {
  it("no file outside the table builds running text from it", () => {
    const hits: Record<string, string[]> = {};
    for (const f of sourceFiles(SRC)) {
      if (f === TABLE) continue;
      const found = codeSideJoins(readFileSync(f, "utf8"));
      if (found.length > 0) hits[path.relative(SRC, f)] = found;
    }
    expect(hits).toEqual({});
  });

  it("sees each shape, and not a table call on its own", () => {
    const table = 'import { strings } from "@/lib/strings";\n';
    expect(codeSideJoins(table + "const a = `${strings.a} ${b}`;")).toEqual([
      "2: template",
    ]);
    expect(codeSideJoins(table + 'const a = strings.a + " " + b;')).toEqual([
      "2: plus",
      "2: plus",
    ]);
    expect(codeSideJoins(table + 'const a = parts.join(" ");')).toEqual([
      "2: join",
    ]);
    expect(
      codeSideJoins(table + "const a = strings.sentences(strings.a, b);")
    ).toEqual([]);
    expect(codeSideJoins('const a = parts.join(" ");')).toEqual([]);
    expect(codeSideJoins("const a = `${b} ${c}`;")).toEqual([]);
  });
});

describe("the table join keeps the English output (#1483)", () => {
  it("joins with one space, as the code did", () => {
    expect(stringsEn.sentences("One.", "Two.")).toBe("One. Two.");
    expect(stringsEn.sentences("One.")).toBe("One.");
  });

  it("reads a former join site as the two sentences and one space", () => {
    expect(libraryShareGapText(1, 2)).toBe(
      `${stringsEn.shareAllMissing(1)} ${stringsEn.shareAllIncomplete(2)}`
    );
  });
});
