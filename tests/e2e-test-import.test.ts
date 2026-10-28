import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every e2e spec takes `test` from `e2e/support/test.ts`, never straight from
 * `@playwright/test` (#954).
 *
 * The support module's automatic `styleCapture` fixture is what the
 * computed-style diff tool records through. A spec that imported
 * `@playwright/test`'s own `test` would still pass, and would simply drop out
 * of every capture, so a diff would report its states as missing in neither
 * run and look clean. This test is what makes that visible.
 *
 * It reads the files through the TypeScript parser, so a comment or a string
 * that mentions the import cannot satisfy or trip it. Type-only imports from
 * `@playwright/test` (`type Page`, `import("@playwright/test").Page`) stay
 * allowed: they carry no fixture.
 */

const ROOT = join(import.meta.dirname, "..");
const E2E = join(ROOT, "e2e");
const SUPPORT = join(E2E, "support", "test.ts");
const PLAYWRIGHT = "@playwright/test";

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const textOf = (node: ts.Expression) =>
  ts.isStringLiteral(node) ? node.text : "";

/** Every value-level way the file reaches `@playwright/test`'s `test`, as `line: what`. */
function directTestImports(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const at = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      textOf(node.moduleSpecifier) === PLAYWRIGHT
    ) {
      const clause = node.importClause;
      if (clause && !clause.isTypeOnly) {
        if (clause.name) found.push(`${at(node)}: default import`);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings))
          found.push(`${at(node)}: namespace import`);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (
              !el.isTypeOnly &&
              (el.propertyName ?? el.name).text === "test"
            ) {
              found.push(`${at(node)}: import { test }`);
            }
          }
        }
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      textOf(node.moduleSpecifier) === PLAYWRIGHT
    ) {
      const clause = node.exportClause;
      const named =
        clause && ts.isNamedExports(clause) ? clause.elements : undefined;
      if (!named) found.push(`${at(node)}: export *`);
      else if (
        named.some(
          (el) => !el.isTypeOnly && (el.propertyName ?? el.name).text === "test"
        )
      ) {
        found.push(`${at(node)}: export { test }`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      textOf(node.arguments[0]) === PLAYWRIGHT
    ) {
      found.push(`${at(node)}: dynamic import or require`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("e2e specs take test from e2e/support/test.ts", () => {
  const files = tsFiles(E2E).filter((f) => f !== SUPPORT);
  const specs = files.filter((f) => f.endsWith(".spec.ts"));

  it("finds the spec files to check", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it("no e2e file outside the support module reaches @playwright/test's test as a value", () => {
    const offenders = files.flatMap((f) =>
      directTestImports(readFileSync(f, "utf8"), f).map(
        (hit) => `${relative(ROOT, f)}:${hit}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it("every spec imports test from ./support/test", () => {
    const missing = specs.filter((f) => {
      const file = ts.createSourceFile(
        f,
        readFileSync(f, "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      return !file.statements.some(
        (s) =>
          ts.isImportDeclaration(s) &&
          textOf(s.moduleSpecifier) === "./support/test" &&
          s.importClause?.namedBindings !== undefined &&
          ts.isNamedImports(s.importClause.namedBindings) &&
          s.importClause.namedBindings.elements.some(
            (el) => (el.propertyName ?? el.name).text === "test"
          )
      );
    });
    expect(missing.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("the reader catches each value form and lets the type-only forms through", () => {
    const hits = (src: string) => directTestImports(src, "probe.ts");
    expect(hits(`import { expect, test } from "@playwright/test";`)).toEqual([
      "1: import { test }",
    ]);
    expect(hits(`import { test as it } from "@playwright/test";`)).toEqual([
      "1: import { test }",
    ]);
    expect(hits(`import pw from "@playwright/test";`)).toEqual([
      "1: default import",
    ]);
    expect(hits(`import * as pw from "@playwright/test";`)).toEqual([
      "1: namespace import",
    ]);
    expect(hits(`export { test } from "@playwright/test";`)).toEqual([
      "1: export { test }",
    ]);
    expect(hits(`const pw = await import("@playwright/test");`)).toEqual([
      "1: dynamic import or require",
    ]);
    expect(
      hits(`import { expect, type Page } from "@playwright/test";`)
    ).toEqual([]);
    expect(hits(`import type { Page } from "@playwright/test";`)).toEqual([]);
    expect(
      hits(`const f = (p: import("@playwright/test").Page) => p;`)
    ).toEqual([]);
    expect(
      hits(
        `// import { test } from "@playwright/test";\nconst s = 'import { test } from "@playwright/test"';`
      )
    ).toEqual([]);
  });
});
