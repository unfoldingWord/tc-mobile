import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { NOTHING_FAILED_TONE } from "@/components/notice-tone";
import { shareOutcomeGlyph } from "@/components/share-outcome-glyph";

/**
 * The Notices that say "nothing failed" move together (#147).
 *
 * #147 asks for an AUDIT of every default-tone `Notice` — "rather than fixing
 * one and leaving the rest to drift" — and the audit found the call sites whose
 * answer to "is this genuinely a failure?" is no. What this pins is that they
 * read ONE constant, so the question is answered in one place and cannot be
 * half-answered. It was answered `info` on #147 (DRI, 2026-09-28);
 * `share-outcome-glyph.test.ts` and `stale-target-wiring.test.ts` pin that
 * value at the table and the rendered role.
 *
 * The class was three when this file was written. #614 deleted the third —
 * `previewUnavailable`, the finding #147 was filed for — along with the paused-
 * preview state it described, so the assertion for it went with it rather than
 * being kept pointing at a string the tree no longer has.
 *
 * WHY THIS READS SOURCE. No runtime assertion can tell a site that reads the
 * constant from one that hardcodes the same string — that drift is invisible
 * until the day the constant changes again, which is exactly the day it is too
 * late. The wiring is the property, so the wiring is what is read.
 *
 * WHY IT READS THE AST AND NOT THE TEXT. A first draft regexed the source with
 * comments stripped, which closed the comment half of the trap
 * (`share-progress.test.ts`, #529 round 3) but not the string half: a `const
 * DECOY = "<Notice tone={NOTHING_FAILED_TONE}>{strings.staleChapter}</Notice>"`
 * added beside ONE unwired call site made the count read 2 and the whole file
 * pass. That is the `tc-prepush` guard case — the pattern inside a comment or a
 * string must stay quiet — and it failed it. Matching parsed nodes closes both
 * halves at once and costs nothing else: a comment is not a node, and a string
 * literal is a `StringLiteral`, never the `Identifier` these assertions require.
 *
 * WHY IT BINDS AND NOT JUST PARSES (#1202). An identifier's SPELLING is not
 * what it reads: an inner-scope `const NOTHING_FAILED_TONE` rebinds every use
 * below it, and `import { NOTHING_FAILED_TONE as TONE }` reads the constant
 * under another name. So each file is bound by the TypeScript checker on its
 * own (a one-file program — no lib, no module resolution), and an identifier
 * counts only when it RESOLVES to an import of `NOTHING_FAILED_TONE` from
 * `src/components/notice-tone`, under whatever local name.
 */

const REPO_ROOT = new URL("..", import.meta.url);
const CONSTANT = "NOTHING_FAILED_TONE";
/** Repo-relative, POSIX, no extension: what an import of the constant names. */
const DECLARING_MODULE = "src/components/notice-tone";

/** A file parsed AND bound, so an identifier can be asked what it reads. */
interface Bound {
  readonly rel: string;
  readonly file: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

/**
 * Binds one file on its own. `noResolve` keeps the program to this file, so
 * an import's target module is never loaded: a binding resolves to the
 * `ImportSpecifier` that introduced it, and the specifier's module text is
 * what `namesDeclaringModule` checks. `text` stands in for the file's contents
 * (the in-memory cases at the bottom); omitted, the file is read from disk.
 */
function bind(rel: string, text?: string): Bound {
  const source = text ?? readFileSync(new URL(rel, REPO_ROOT), "utf8");
  const file = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === rel ? file : undefined);
  host.fileExists = (name) => name === rel;
  const program = ts.createProgram({ rootNames: [rel], options, host });
  return { rel, file, checker: program.getTypeChecker() };
}

/** Does `specifier`, written in `fromRel`, name `notice-tone`? Relative and
 *  `@/` (the `src/` alias) forms, with or without a `.ts`/`.tsx`/`.js`/`.jsx`
 *  suffix; a bare package name never does. */
function namesDeclaringModule(fromRel: string, specifier: string): boolean {
  let target: string;
  if (specifier.startsWith("@/")) {
    target = path.posix.join("src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    target = path.posix.join(path.posix.dirname(fromRel), specifier);
  } else {
    return false;
  }
  return target.replace(/\.(tsx?|jsx?)$/, "") === DECLARING_MODULE;
}

function moduleText(decl: ts.ImportDeclaration | ts.ExportDeclaration): string {
  const spec = decl.moduleSpecifier;
  return spec !== undefined && ts.isStringLiteral(spec) ? spec.text : "";
}

/** Does `decl` (an import binding) come from an `import` of the constant's
 *  module? A JSDoc `@import` tag is not an `ImportDeclaration`, so never. */
function fromDeclaringModule(
  b: Bound,
  decl: ts.ImportSpecifier | ts.NamespaceImport
): boolean {
  const statement = ts.isImportSpecifier(decl)
    ? decl.parent.parent.parent
    : decl.parent.parent;
  return (
    ts.isImportDeclaration(statement) &&
    namesDeclaringModule(b.rel, moduleText(statement))
  );
}

/** Is `symbol` the constant, imported from its module under any local name? */
function isConstant(b: Bound, symbol: ts.Symbol | undefined): boolean {
  const decl = symbol?.declarations?.[0];
  if (decl === undefined || !ts.isImportSpecifier(decl)) return false;
  const imported = decl.propertyName ?? decl.name;
  return imported.text === CONSTANT && fromDeclaringModule(b, decl);
}

/** Is `symbol` a namespace import (`import * as T`) of the constant's module? */
function isDeclaringNamespace(
  b: Bound,
  symbol: ts.Symbol | undefined
): boolean {
  const decl = symbol?.declarations?.[0];
  return (
    decl !== undefined &&
    ts.isNamespaceImport(decl) &&
    fromDeclaringModule(b, decl)
  );
}

/** Does this expression read the constant — `X` bound to it, or `T.X`
 *  through a namespace import of its module? */
function readsConstant(b: Bound, expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    return isConstant(b, b.checker.getSymbolAtLocation(expr));
  }
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === CONSTANT &&
    ts.isIdentifier(expr.expression) &&
    isDeclaringNamespace(b, b.checker.getSymbolAtLocation(expr.expression))
  );
}

/** Every `.ts`/`.tsx` file under `rel`, recursively. Repo-relative, POSIX. */
function sourcesUnder(rel: string): string[] {
  return readdirSync(new URL(rel, REPO_ROOT), { withFileTypes: true }).flatMap(
    (entry) => {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) return sourcesUnder(`${child}/`);
      return /\.tsx?$/.test(entry.name) ? [child] : [];
    }
  );
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * How many times a file REFERENCES the constant, by binding.
 *
 * Counted: a use of any local name bound to the import (shorthand `{ X }` and
 * a local `export { X }` included); `T.NOTHING_FAILED_TONE` through a
 * namespace import; and a re-export straight from the constant's module
 * (`export { NOTHING_FAILED_TONE as Y } from …` or `export * from …`), each
 * counted once — a re-export is how the constant would leave this check's
 * one-file view, so it is a member like any other site. The import specifier
 * itself is not a reference: it wires nothing, and counting it would make the
 * expected numbers below depend on how a file happens to import.
 */
function constantReferences(b: Bound): number {
  let count = 0;
  walk(b.file, (node) => {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      if (!namesDeclaringModule(b.rel, moduleText(node))) return;
      const clause = node.exportClause;
      if (clause === undefined || ts.isNamespaceExport(clause)) count += 1;
      else
        count += clause.elements.filter(
          (el) => (el.propertyName ?? el.name).text === CONSTANT
        ).length;
      return;
    }
    if (
      ts.isExportSpecifier(node) &&
      node.parent.parent.moduleSpecifier === undefined
    ) {
      if (isConstant(b, b.checker.getExportSpecifierLocalTargetSymbol(node))) {
        count += 1;
      }
      return;
    }
    if (!ts.isIdentifier(node)) return;
    const parent = node.parent as ts.Node | undefined;
    if (parent === undefined) return;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return;
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      if (isConstant(b, b.checker.getShorthandAssignmentValueSymbol(parent))) {
        count += 1;
      }
      return;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      if (readsConstant(b, parent)) count += 1;
      return;
    }
    if (isConstant(b, b.checker.getSymbolAtLocation(node))) count += 1;
  });
  return count;
}

/** Does this JSX attribute value read the constant, by binding? */
function isConstantTone(
  b: Bound,
  value: ts.JsxAttributeValue | undefined
): boolean {
  return (
    value !== undefined &&
    ts.isJsxExpression(value) &&
    value.expression !== undefined &&
    readsConstant(b, value.expression)
  );
}

/**
 * Every `<Notice>` in a file whose body names `strings.<stringKey>`, as
 * `{ tone: "constant" | "other" }`. An opening element only — a `Notice` always
 * has children, so a self-closing one would be a different bug.
 */
function noticesSaying(
  b: Bound,
  stringKey: string
): { tone: "constant" | "other" }[] {
  const found: { tone: "constant" | "other" }[] = [];
  walk(b.file, (node) => {
    if (!ts.isJsxElement(node)) return;
    const open = node.openingElement;
    if (!ts.isIdentifier(open.tagName) || open.tagName.text !== "Notice")
      return;

    // The body must REFERENCE the string, as a property access on `strings` —
    // not merely contain the word, which a stray identifier or a string could.
    let saysIt = false;
    walk(node, (inner) => {
      if (
        ts.isPropertyAccessExpression(inner) &&
        ts.isIdentifier(inner.expression) &&
        inner.expression.text === "strings" &&
        inner.name.text === stringKey
      ) {
        saysIt = true;
      }
    });
    if (!saysIt) return;

    const tone = open.attributes.properties.find(
      (attr): attr is ts.JsxAttribute =>
        ts.isJsxAttribute(attr) && attr.name.getText() === "tone"
    );
    found.push({
      tone: isConstantTone(b, tone?.initializer) ? "constant" : "other",
    });
  });
  return found;
}

describe("the not-a-failure Notices read one tone (#147)", () => {
  it("BOTH stale-chapter Notices take their tone from the constant", () => {
    // Two call sites, one screen: the list body and the chapter menu. The count
    // is half the assertion — fixing one and leaving the other is the drift
    // #147 names — and every one of them reading the constant is the other
    // half, so neither a missing site nor a hardcoded tone can pass.
    const notices = noticesSaying(
      bind("src/components/segments-screen.tsx"),
      "staleChapter"
    );
    expect(notices).toHaveLength(2);
    expect(notices.every((n) => n.tone === "constant")).toBe(true);
  });

  it("the share outcome table's `nothing` takes its tone from the constant", () => {
    // `nothing` is "there is no audio yet", not "the share failed" — #178 gave
    // it its own mark for that reason and deliberately left the tone alone.
    // Pinned at the `case "nothing"` clause, so wiring some OTHER outcome to
    // the constant could never stand in for this one.
    const b = bind("src/components/share-outcome-glyph.ts");
    const tones: boolean[] = [];
    walk(b.file, (node) => {
      if (!ts.isCaseClause(node)) return;
      if (!ts.isStringLiteral(node.expression)) return;
      if (node.expression.text !== "nothing") return;
      walk(node, (inner) => {
        if (!ts.isPropertyAssignment(inner)) return;
        if (inner.name.getText() !== "tone") return;
        tones.push(readsConstant(b, inner.initializer));
      });
    });
    expect(tones).toEqual([true]);
  });

  it.each([
    ["src/components/send-log-control.tsx"],
    ["src/components/failure-log-panel.tsx"],
  ])(
    "the failure log's `nothing` Notice in %s takes its tone from the constant",
    (rel) => {
      // "There is nothing to send now." is not a failure: the log emptied
      // between render and tap (DRI, 2026-10-07, on #1317's #1209 item). The
      // `failed` and `restart` Notices beside it are failures and keep the
      // default tone, which the membership map below holds to one site here.
      const notices = noticesSaying(bind(rel), "shareFailureLogNothing");
      expect(notices).toEqual([{ tone: "constant" }]);
    }
  );

  it("NOTHING ELSE reads the constant — the inverse of the checks above", () => {
    // George round 1, Low: the assertions above pin "these sites read the
    // constant" and say nothing about "nothing else does". A genuine FAILURE
    // Notice that started passing `tone={NOTHING_FAILED_TONE}` would lose the
    // failure colour and the interrupting role, and would move again with any
    // later re-tone of the class. So the membership is pinned from both
    // directions.
    //
    // A new member is meant to be a deliberate act: adding a site means adding
    // it here, which is where the "is this genuinely a failure?" question gets
    // asked. The map is the class, and the audit table in the PR body is its
    // reasoning.
    const expected: Record<string, number> = {
      "src/components/segments-screen.tsx": 2, // list body + chapter menu
      "src/components/share-outcome-glyph.ts": 1, // case "nothing"
      "src/components/send-log-control.tsx": 1, // shareFailureLogNothing
      "src/components/failure-log-panel.tsx": 1, // shareFailureLogNothing
    };
    const actual: Record<string, number> = {};
    for (const file of sourcesUnder("src/")) {
      // The declaration's own module is where the constant lives, not a site
      // that wears it: it declares the constant rather than importing it, so
      // nothing in it can bind to an import of it.
      if (file === "src/components/notice-tone.ts") continue;
      const count = constantReferences(bind(file));
      if (count > 0) actual[file] = count;
    }
    expect(actual).toEqual(expected);
  });

  describe("the checks above resolve bindings, not spellings (#1202)", () => {
    // What these cases cover: every way, within ONE file, of reaching the
    // constant under a name other than its own, or of wearing its name while
    // reading something else. The membership check above binds each file
    // alone, so a re-export straight from `notice-tone` is itself counted as a
    // member (the re-exporting file shows up in the map). Not covered: a
    // dynamic `import()` of `notice-tone`, an element access
    // `T["NOTHING_FAILED_TONE"]` on a namespace import, and a destructure of
    // a namespace import (`const { NOTHING_FAILED_TONE } = T`); none appears
    // in `src/` today, and each would be a deliberate, odd edit. Each reads 0
    // references, so it is a false green for the membership check.
    const IMPORT = `import { NOTHING_FAILED_TONE } from "./notice-tone";`;
    const NOTICE = `<Notice tone={NOTHING_FAILED_TONE}>{strings.staleChapter}</Notice>`;

    it("an inner-scope shadow is not the constant (#1202 1a)", () => {
      const b = bind(
        "src/components/fixture.tsx",
        `${IMPORT}
export const Screen = forwardRef(() => {
  const NOTHING_FAILED_TONE = "info" as const;
  return ${NOTICE};
});
export const Outside = () => ${NOTICE};`
      );
      expect(noticesSaying(b, "staleChapter")).toEqual([
        { tone: "other" },
        { tone: "constant" },
      ]);
      expect(constantReferences(b)).toBe(1);
    });

    it.each([
      [
        "an aliased import in a non-member file (#1202 1b)",
        `import { NOTHING_FAILED_TONE as TONE } from "./notice-tone";
export const X = () => <Notice tone={TONE}>{strings.someGenuineFailure}</Notice>;`,
        1,
      ],
      [
        "the `@/` alias form of the import",
        `import { NOTHING_FAILED_TONE as T } from "@/components/notice-tone";
export const t = T;`,
        1,
      ],
      [
        "an import that names the module with a `.js` or `.jsx` suffix",
        `import { NOTHING_FAILED_TONE as A } from "./notice-tone.js";
import { NOTHING_FAILED_TONE as B } from "@/components/notice-tone.jsx";
export const t = [A, B];`,
        2,
      ],
      [
        "a namespace import",
        `import * as tones from "../components/notice-tone";
export const t = tones.NOTHING_FAILED_TONE;`,
        1,
      ],
      [
        "a shorthand property and a local re-export",
        `${IMPORT}
export const o = { NOTHING_FAILED_TONE };
export { NOTHING_FAILED_TONE as Y };`,
        2,
      ],
      [
        "re-exports straight from the module",
        `export { NOTHING_FAILED_TONE as Y } from "./notice-tone";
export * from "./notice-tone";`,
        2,
      ],
      [
        "a same-named import from ANOTHER module",
        `import { X as NOTHING_FAILED_TONE } from "./elsewhere";
export const t = NOTHING_FAILED_TONE;`,
        0,
      ],
      [
        "the name in a string and a comment only",
        `// tone={NOTHING_FAILED_TONE}
export const DECOY = "<Notice tone={NOTHING_FAILED_TONE}>";`,
        0,
      ],
    ])("%s", (_name, text, references) => {
      expect(constantReferences(bind("src/components/fixture.tsx", text))).toBe(
        references
      );
    });
  });

  it("the constant is the tone the share table actually hands the screen", () => {
    // Survives a re-tone: it says the two agree, not what they say. The
    // literal is pinned by `share-outcome-glyph.test.ts`.
    expect(shareOutcomeGlyph("nothing").tone).toBe(NOTHING_FAILED_TONE);
  });
});
