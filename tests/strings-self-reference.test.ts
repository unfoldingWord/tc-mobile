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
 * #1480 made the English table `stringsEn` and had every entry that embeds
 * another entry reach it through `this`, so an alias resolves within the table
 * it was read from. This pins the SET, by parsing the file: a new entry that
 * reaches the live `strings` binding or a helper fails here and is sent to the
 * docblock at the top of `strings.ts`. A reach through the binding is recorded
 * as `strings.<name>` and is the defect; `this.<name>` is the sanctioned form.
 * The behaviour itself (an alias following an installed table) is
 * `tests/strings-locale-binding.test.ts`.
 */

const FILE = path.resolve(import.meta.dirname, "../src/lib/strings.ts");

/** The module's own functions that carry wording or layout of their own. Empty
 * since #1481 moved `couldNotBeIncluded` and `trail` into the table. */
const HELPERS = new Set<string>();

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
      // A bare `import "x";` binds nothing, but is recorded so a new one
      // still has to be argued here.
      if (!clause) imports.push(`<import ${node.moduleSpecifier.getText()}>`);
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
 * Whether `node` IS the result of the entry function `fn`: returned as it
 * stands, perhaps as one arm of `?:`, `??` or `||`, perhaps in parentheses.
 * Anything else (a template span, a `+` operand, a call argument, a local
 * variable) means the entry puts words of its own around it.
 */
function isWholeResult(node: ts.Node, fn: ts.Node): boolean {
  let at = node;
  for (;;) {
    const parent = at.parent;
    if (ts.isParenthesizedExpression(parent)) at = parent;
    else if (ts.isConditionalExpression(parent) && parent.condition !== at)
      at = parent;
    else if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    )
      at = parent;
    else if (ts.isReturnStatement(parent))
      return ts.findAncestor(parent, ts.isFunctionLike) === fn;
    else if (ts.isArrowFunction(parent) && parent.body === at)
      return parent === fn;
    else return false;
  }
}

/** Whether `node` sits inside running text: a template span or a `+`. */
function isInsideText(node: ts.Node, fn: ts.Node): boolean {
  for (let at = node.parent; at !== fn; at = at.parent) {
    if (ts.isTemplateSpan(at)) return true;
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind === ts.SyntaxKind.PlusToken
    )
      return true;
  }
  return false;
}

/**
 * Every entry of `export const stringsEn = { ... }` that references the binding
 * or a helper, mapped to what it references, sorted. A bare `strings` that is
 * not the object of a property access (an alias, a spread, an element access)
 * is recorded as `strings` itself, so it cannot hide the name it reads.
 *
 * `embeds` is the narrower set the whole-sentence rule reads (#1483): each
 * `this.<entry>` an entry does NOT return whole, and `plural` where a count
 * phrase sits inside running text. A call counts as whole only when every
 * argument is a plain name, so `this.frame(plural(...))` is an embed: the
 * entry fills another entry's frame with a phrase of its own.
 */
function outwardReferences(source: string): {
  entries: number;
  refs: Record<string, string[]>;
  embeds: Record<string, string[]>;
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
      if (!ts.isIdentifier(decl.name) || decl.name.text !== "stringsEn")
        continue;
      let init = decl.initializer;
      while (
        init &&
        (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))
      )
        init = init.expression;
      if (init && ts.isObjectLiteralExpression(init)) table = init;
    }
  });
  if (!table) throw new Error("no `stringsEn` object literal in strings.ts");

  const refs: Record<string, string[]> = {};
  const embeds: Record<string, string[]> = {};
  for (const prop of table.properties) {
    if (!prop.name || !ts.isIdentifier(prop.name)) {
      throw new Error(
        `strings.ts: an entry without a plain name at ${prop.getStart()}`
      );
    }
    // The function whose result the entry is: the method itself, or the
    // arrow or function a property holds. A fixed string has none, and then
    // nothing inside it can be a whole result.
    const fn =
      ts.isPropertyAssignment(prop) &&
      (ts.isArrowFunction(prop.initializer) ||
        ts.isFunctionExpression(prop.initializer))
        ? prop.initializer
        : prop;
    const found = new Set<string>();
    const embedded = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        found.add(`this.${node.name.text}`);
        const call =
          ts.isCallExpression(node.parent) && node.parent.expression === node
            ? node.parent
            : undefined;
        const plainArguments =
          call === undefined || call.arguments.every(ts.isIdentifier);
        if (!plainArguments || !isWholeResult(call ?? node, fn))
          embedded.add(`this.${node.name.text}`);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "plural" &&
        isInsideText(node, fn)
      ) {
        embedded.add("plural");
      }
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
    if (embedded.size > 0) embeds[prop.name.text] = [...embedded].sort();
  }
  return { entries: table.properties.length, refs, embeds };
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
      chapterBreadcrumb: ["this.trail"],
      chapterHeading: ["this.chapterName"],
      editSegment: ["this.segmentHeading"],
      editSegmentFinished: ["this.segmentHeading"],
      openSegment: ["this.segmentHeading"],
      recorderBreadcrumb: ["this.segmentHeading", "this.trail"],
      saveFailedDiscard: [
        "this.takeRecoverDiscard",
        "this.takeRecoverDiscardArmed",
      ],
      saveFailedDiscardHint: ["this.takeRecoverDiscardHint"],
      shareAllFolder: ["this.shareNameFallback"],
      shareBookFilename: ["this.shareNameFallback"],
      shareBookMissingAndPartial: ["this.sentences", "this.shareBookMissing"],
      shareBookPartial: ["this.shareMissing"],
      shareFilename: ["this.chapterName"],
    });
  });
});

/**
 * #1483 — no sentence is built from another entry's words.
 *
 * The rule in docs/i18n/glossary.md is that each entry is a whole sentence,
 * with placeholders for the values that vary. A sentence spliced from a second
 * entry's output ("Chapter 3" + " is now chapter 5.") keeps that entry's
 * grammar inside a sentence it does not own. A language that inflects the
 * name, or orders the parts differently, then cannot write the sentence it
 * needs without overriding both entries. A count phrase spliced into running
 * text ("{n} segments" + " could not be included.") is the same defect inside
 * one entry.
 *
 * So this pins `embeds`: every `this.<entry>` that an entry does not return
 * whole, and every `plural(...)` that sits inside a template or a `+`. What
 * remains is the set below, and each member has a stated reason:
 *
 *   - NAMES. `segmentHeading` is the ordinal plus the facilitator's label
 *     ("3 · verses 3–4"), and it holds no word. The open control's spoken name
 *     must contain the text the row paints (WCAG 2.5.3), so it embeds the
 *     entry that paints it. `trail` joins names. The two file names embed a
 *     fallback NAME (R18 on #1233: "Use the number and name").
 *   - ONE SENTENCE JOIN. `shareBookMissingAndPartial` puts two whole
 *     sentences side by side through `sentences`, which owns the separator
 *     (#1483 slice 2). The joins in `components/share-error-copy.ts` use the
 *     same entry; `tests/strings-sentence-joins.test.ts` pins that code never
 *     joins table sentences itself.
 *
 * WHAT IT CANNOT SEE: a phrase built in a local variable and then placed in a
 * template. The `this.<entry>` rule catches that case, because a variable is
 * not a whole result. The `plural` rule does not catch it, because a forms
 * table can legitimately be built from plural results. This is a floor under
 * the table, read from the parse tree, so a comment can neither trip it nor
 * satisfy it.
 */
describe("no table sentence is built from another entry's words (#1483)", () => {
  const { embeds } = outwardReferences(readFileSync(FILE, "utf8"));

  it("embeds only names and the one sentence join", () => {
    expect(embeds).toEqual({
      editSegment: ["this.segmentHeading"],
      editSegmentFinished: ["this.segmentHeading"],
      openSegment: ["this.segmentHeading"],
      recorderBreadcrumb: ["this.segmentHeading", "this.trail"],
      shareBookFilename: ["this.shareNameFallback"],
      shareBookMissingAndPartial: ["this.sentences", "this.shareBookMissing"],
      shareFilename: ["this.chapterName"],
    });
  });
});

describe("nothing at top level escapes the walker (#169, PR #1221 review)", () => {
  it("binds no value beyond the table and HELPERS, and imports only IMPORTS", () => {
    expect(topLevelNames(readFileSync(FILE, "utf8"))).toEqual({
      values: [...HELPERS, "installStrings", "strings", "stringsEn"].sort(),
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
          'import { plural as wording } from "./plural";',
          'import "./side-effect";',
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
      imports: ['<import "./side-effect">', "heading", "wording", "words"],
    });
  });
});

describe("the reader itself", () => {
  const probe = (body: string) =>
    outwardReferences(`export const stringsEn = {\n${body}\n} as const;`).refs;

  it("sees a call through the binding", () => {
    expect(probe("a: (n: number) => `x ${strings.b(n)}`,")).toEqual({
      a: ["strings.b"],
    });
  });

  it("records a call through this, and does not confuse it with the binding", () => {
    expect(probe("a(n: number): string { return `x ${this.b(n)}`; },")).toEqual(
      { a: ["this.b"] }
    );
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

describe("the embed reader itself (#1483)", () => {
  const embeds = (body: string) =>
    outwardReferences(`export const stringsEn = {\n${body}\n} as const;`)
      .embeds;

  it("does not count an entry returned whole: directly, as an arm of ?:, ?? or ||, from a method or an arrow", () => {
    expect(
      embeds(
        [
          "a(n: number): string { return this.b(n); },",
          "c(x: string | null, n: number): string { return x ?? this.b(n); },",
          "d: function (f: boolean): string { return f ? this.e : (this.g); },",
          "h(x: string): string { return x || this.e; },",
          "k: (n: number): string => plural(n, { other: `{n} of ${n}` }),",
          "m: (n: number, name: string): string => plural(n, { other: '{name}' }).replace('{name}', () => name),",
        ].join("\n")
      )
    ).toEqual({});
  });

  it("counts an entry spliced into a template, a +, a variable, a call argument, or filled with a phrase", () => {
    expect(
      embeds(
        [
          "a(n: number): string { return `${this.b(n)} moved.`; },",
          "c(n: number): string { return this.b(n) + '.'; },",
          "d(n: number): string { const x = this.b(n); return x; },",
          "e(n: number): string { return wrap(this.b(n)); },",
          "f(n: number): string { return this.frame(plural(n, { other: '{n} x' })); },",
          "g(n: number): string { return this.b(n, 'Book'); },",
        ].join("\n")
      )
    ).toEqual({
      a: ["this.b"],
      c: ["this.b"],
      d: ["this.b"],
      e: ["this.b"],
      f: ["this.frame"],
      g: ["this.b"],
    });
  });

  it("counts a count phrase inside running text, and not a return from a nested helper as the entry's own", () => {
    expect(
      embeds(
        [
          "a: (n: number): string => `${plural(n, { other: '{n} x' })}, open`,",
          "b: (n: number): string => 'Open ' + plural(n, { other: '{n} x' }),",
          "c(n: number): string { const f = () => this.d(n); return f(); },",
        ].join("\n")
      )
    ).toEqual({ a: ["plural"], b: ["plural"], c: ["this.d"] });
  });
});
