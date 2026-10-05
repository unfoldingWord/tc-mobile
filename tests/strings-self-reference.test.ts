import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Which table entries reach outside their own arguments for wording (#169).
 *
 * Some entries in `src/lib/strings.ts` build their result by calling the
 * module-level `strings` binding (`chapterHeading` -> `strings.chapterName`)
 * or one of the module's own wording helpers (`couldNotBeIncluded`, `trail`).
 * Each is correct today, and most are aliases on purpose: `shareBookPartial`
 * and `chapterHeading` exist because byte-for-byte copies drifted.
 *
 * They become a defect when the table goes per-locale (`strings[locale]`, the
 * rest of #169). A French entry that calls the module-level `strings` formats
 * its embedded part from whichever table that binding names, not from its
 * own, and the equality pins that exist now (`chapterHeading(null, n) ===
 * chapterName(n)`) stay green while it does, because both sides resolve
 * through the same wrong table. George raised it on #698, and #169 records a
 * list of the sites that a later entry could outgrow without anyone noticing.
 * The count lives in the assertion below, not here.
 *
 * So this pins the SET, by parsing the file: a new entry that reaches the
 * binding or a helper fails here and is sent to the docblock at the top of
 * `strings.ts`, which says what the per-locale slice has to do with each one.
 * It does not test the per-locale behaviour. There is one locale, so there is
 * no second table to leak into yet.
 */

const FILE = path.resolve(import.meta.dirname, "../src/lib/strings.ts");

/** The module's own functions that carry wording or layout of their own. */
const HELPERS = new Set(["couldNotBeIncluded", "trail"]);

/**
 * The names `strings.ts` imports. Neither carries wording: `plural` picks a
 * form the caller supplies and `filenameSafe` strips characters, so neither
 * belongs in `HELPERS` (the per-locale slice of #169 decides `plural`'s fate
 * on its own). Pinned so a new import cannot bring a wording helper in from
 * outside the walker's sight.
 */
const IMPORTS = ["filenameSafe", "plural"];

/**
 * Every name `strings.ts` binds at top level, by kind: values (functions,
 * variables, classes, enums) and imports. Types and interfaces carry no
 * wording, so they are skipped. Any other top-level statement is recorded by
 * its syntax kind, so a shape this reader does not know fails the pin below
 * instead of being skipped.
 *
 * `HELPERS` is a fixed list, so without this a new helper, an alias of the
 * binding or a wording constant declared beside them is invisible to
 * `outwardReferences`: an entry reaching the binding through
 * `function heading(n) { return strings.chapterName(n); }`, `const t =
 * strings;` or `const CHAPTER = "Chapter";` stayed green (PR #1221 review,
 * 2026-10-02). Pinning the top-level names forces that new name through an
 * edit here, where it has to be put in `HELPERS` or argued out of it.
 */
function topLevelNames(source: string): {
  values: string[];
  imports: string[];
} {
  const file = ts.createSourceFile(
    "strings.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const values: string[] = [];
  const imports: string[] = [];
  const bindingNames = (name: ts.BindingName): string[] =>
    ts.isIdentifier(name)
      ? [name.text]
      : name.elements.flatMap((element) =>
          ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
        );
  file.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.name) imports.push(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        imports.push(bindings.name.text);
      else if (bindings)
        for (const element of bindings.elements)
          imports.push(element.name.text);
    } else if (ts.isFunctionDeclaration(node)) {
      values.push(node.name?.text ?? "<anonymous function>");
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations)
        values.push(...bindingNames(decl.name));
    } else if (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
      values.push(node.name?.text ?? "<anonymous class>");
    } else if (
      !ts.isTypeAliasDeclaration(node) &&
      !ts.isInterfaceDeclaration(node) &&
      node.kind !== ts.SyntaxKind.EndOfFileToken
    ) {
      values.push(`<${ts.SyntaxKind[node.kind]}>`);
    }
  });
  return { values: values.sort(), imports: imports.sort() };
}

/**
 * Every entry of `export const strings = { ... }` that references the binding
 * or a helper, mapped to what it references, sorted. A bare `strings` that is
 * not the object of a property access (an alias, a spread, an element access)
 * is recorded as `strings` itself, so it cannot hide the name it reads.
 */
function outwardReferences(source: string): {
  entries: number;
  refs: Record<string, string[]>;
} {
  const file = ts.createSourceFile(
    "strings.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  let table: ts.ObjectLiteralExpression | undefined;
  file.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== "strings") continue;
      let init = decl.initializer;
      while (
        init &&
        (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))
      )
        init = init.expression;
      if (init && ts.isObjectLiteralExpression(init)) table = init;
    }
  });
  if (!table) throw new Error("no `strings` object literal in strings.ts");

  const refs: Record<string, string[]> = {};
  for (const prop of table.properties) {
    if (!prop.name || !ts.isIdentifier(prop.name)) {
      throw new Error(
        `strings.ts: an entry without a plain name at ${prop.getStart()}`
      );
    }
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        // A name in property position is not a read of the binding: `o.trail`,
        // `{ trail: x }`, `{ trail: string }` in a type.
        const isPropertyName =
          (ts.isPropertyAccessExpression(parent) ||
            ts.isPropertyAssignment(parent) ||
            ts.isPropertySignature(parent)) &&
          parent.name === node;
        if (!isPropertyName) {
          if (node.text === "strings") {
            found.add(
              ts.isPropertyAccessExpression(parent) &&
                parent.expression === node
                ? `strings.${parent.name.text}`
                : "strings"
            );
          } else if (HELPERS.has(node.text)) {
            found.add(node.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    // The whole entry, not only its initializer: a method or a getter body
    // reaches the binding the same way an arrow does.
    visit(prop);
    if (found.size > 0) refs[prop.name.text] = [...found].sort();
  }
  return { entries: table.properties.length, refs };
}

describe("table entries that reach outside their own arguments (#169)", () => {
  const { entries, refs } = outwardReferences(readFileSync(FILE, "utf8"));

  it("reads the whole table", () => {
    // Floor: a parse that found the wrong object, or none of its entries,
    // would otherwise pass the set below by finding nothing.
    expect(entries).toBeGreaterThan(150);
  });

  it("is exactly the set the per-locale slice has to resolve within its own table", () => {
    expect(refs).toEqual({
      chapterBreadcrumb: ["trail"],
      chapterHeading: ["strings.chapterName"],
      chapterReorderMoved: ["strings.chapterName"],
      chapterReorderStayed: ["strings.chapterName"],
      editSegment: ["strings.segmentHeading"],
      editSegmentFinished: ["strings.segmentHeading"],
      menuOpenWithFailures: ["strings.failuresMarker"],
      openSegment: ["strings.segmentHeading"],
      recorderBreadcrumb: ["strings.segmentHeading", "trail"],
      saveFailedDiscard: [
        "strings.takeRecoverDiscard",
        "strings.takeRecoverDiscardArmed",
      ],
      saveFailedDiscardHint: ["strings.takeRecoverDiscardHint"],
      shareAllMissing: ["couldNotBeIncluded"],
      shareBookMissing: ["couldNotBeIncluded"],
      shareBookMissingAndPartial: [
        "couldNotBeIncluded",
        "strings.shareBookMissing",
      ],
      shareBookPartial: ["strings.shareMissing"],
      shareFilename: ["strings.chapterName"],
      shareMissing: ["couldNotBeIncluded"],
    });
  });
});

describe("nothing at top level escapes the walker (#169, PR #1221 review)", () => {
  it("binds no value beyond the table and HELPERS, and imports only IMPORTS", () => {
    expect(topLevelNames(readFileSync(FILE, "utf8"))).toEqual({
      values: [...HELPERS, "strings"].sort(),
      imports: IMPORTS,
    });
  });

  it("sees a new helper, an alias, a constant and an import", () => {
    // The reader's own both-states check: each shape the pin above exists
    // for is reported, so the pin cannot go green by not seeing it.
    expect(
      topLevelNames(
        [
          'import { heading } from "./heading";',
          'import * as words from "./words";',
          "type Skipped = string;",
          "function helper(n: number) { return strings.a(n); }",
          "const t = strings, { x, y: [z] } = other;",
          'const CHAPTER = "Chapter";',
          "export const strings = { a: (n: number) => `${n}` } as const;",
          "export { t as alias };",
        ].join("\n")
      )
    ).toEqual({
      values: [
        "<ExportDeclaration>",
        "CHAPTER",
        "helper",
        "strings",
        "t",
        "x",
        "z",
      ],
      imports: ["heading", "words"],
    });
  });
});

describe("the reader itself", () => {
  const probe = (body: string) =>
    outwardReferences(`export const strings = {\n${body}\n} as const;`).refs;

  it("sees a call through the binding, and a helper call", () => {
    expect(
      probe(
        "a: (n: number) => `x ${strings.b(n)}`,\nb: (n: number) => trail(`${n}`),"
      )
    ).toEqual({ a: ["strings.b"], b: ["trail"] });
  });

  it("records a bare alias of the binding rather than missing it", () => {
    expect(
      probe("a: (n: number) => { const s = strings; return s.b(n); },")
    ).toEqual({ a: ["strings"] });
  });

  it("does not count a property merely named like the binding or a helper", () => {
    expect(
      probe(
        "a: (o: { strings: string; trail: string }) => o.strings + o.trail,"
      )
    ).toEqual({});
  });

  it("does not count a comment or a string that names them", () => {
    expect(probe('// strings.b\na: "strings.b and trail(x)",')).toEqual({});
  });
});
