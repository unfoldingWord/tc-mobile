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
 * answer to "is this genuinely a failure?" is no, all riding the `alert` tone.
 * Whether they should be `info` is Tim's call and is still open. What this pins
 * is the weaker property that does not need his answer: they read ONE constant,
 * so the question can be answered in one place and cannot be half-answered.
 *
 * The class was three when this file was written. #614 deleted the third —
 * `previewUnavailable`, the finding #147 was filed for — along with the paused-
 * preview state it described, so the assertion for it went with it rather than
 * being kept pointing at a string the tree no longer has.
 *
 * WHY THIS READS SOURCE. `NOTHING_FAILED_TONE`'s value is `alert`, which is what
 * both members already wore, so no runtime assertion can tell a site that reads
 * the constant from one that hardcodes the same string — the drift this exists
 * to catch is invisible until the day the constant changes, which is exactly the
 * day it is too late. The wiring is the property, so the wiring is what is read.
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
 */

const REPO_ROOT = new URL("..", import.meta.url);

function parse(rel: string): ts.SourceFile {
  const source = readFileSync(new URL(rel, REPO_ROOT), "utf8");
  return ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
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

/**
 * How many times `file` REFERENCES the constant as a value.
 *
 * The declaration's own name and an `import { NOTHING_FAILED_TONE }` specifier
 * are not references — neither wires a Notice to anything, and counting them
 * would make the expected numbers below depend on how a file happens to import.
 */
function constantReferences(rel: string): number {
  let count = 0;
  walk(parse(rel), (node) => {
    if (!ts.isIdentifier(node)) return;
    if (node.text !== "NOTHING_FAILED_TONE") return;
    const parent = node.parent as ts.Node | undefined;
    if (parent === undefined) return;
    if (ts.isVariableDeclaration(parent) && parent.name === node) return;
    if (ts.isImportSpecifier(parent)) return;
    count += 1;
  });
  return count;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Is this JSX attribute value the bare identifier `NOTHING_FAILED_TONE`? */
function isConstantTone(value: ts.JsxAttributeValue | undefined): boolean {
  return (
    value !== undefined &&
    ts.isJsxExpression(value) &&
    value.expression !== undefined &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "NOTHING_FAILED_TONE"
  );
}

/**
 * Every `<Notice>` in `path` whose body names `strings.<stringKey>`, as
 * `{ tone: "constant" | "other" }`. An opening element only — a `Notice` always
 * has children, so a self-closing one would be a different bug.
 */
function noticesSaying(
  rel: string,
  stringKey: string
): { tone: "constant" | "other" }[] {
  const found: { tone: "constant" | "other" }[] = [];
  walk(parse(rel), (node) => {
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
      tone: isConstantTone(tone?.initializer) ? "constant" : "other",
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
      "src/components/segments-screen.tsx",
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
    let toneInNothingCase: string | null = null;
    walk(parse("src/components/share-outcome-glyph.ts"), (node) => {
      if (!ts.isCaseClause(node)) return;
      if (!ts.isStringLiteral(node.expression)) return;
      if (node.expression.text !== "nothing") return;
      walk(node, (inner) => {
        if (!ts.isPropertyAssignment(inner)) return;
        if (inner.name.getText() !== "tone") return;
        toneInNothingCase = ts.isIdentifier(inner.initializer)
          ? inner.initializer.text
          : `<${ts.SyntaxKind[inner.initializer.kind]}>`;
      });
    });
    expect(toneInNothingCase).toBe("NOTHING_FAILED_TONE");
  });

  it("NOTHING ELSE reads the constant — the inverse of the two above", () => {
    // George round 1, Low: the assertions above pin "these sites read the
    // constant" and say nothing about "nothing else does". A genuine FAILURE
    // Notice that started passing `tone={NOTHING_FAILED_TONE}` would stay green
    // today, because the value is still `alert` — and would be swept into
    // `info` on the day the constant flips, which is the one day this file
    // exists to make safe. So the membership is pinned from both directions.
    //
    // A new member is meant to be a deliberate act: adding a site means adding
    // it here, which is where the "is this genuinely a failure?" question gets
    // asked. The map is the class, and the audit table in the PR body is its
    // reasoning.
    const expected: Record<string, number> = {
      "src/components/segments-screen.tsx": 2, // list body + chapter menu
      "src/components/share-outcome-glyph.ts": 1, // case "nothing"
    };
    const actual: Record<string, number> = {};
    for (const file of sourcesUnder("src/")) {
      // The declaration's own module is where the constant lives, not a site
      // that wears it; `constantReferences` already ignores the declaration,
      // but the docblock there names it repeatedly in prose and a future
      // `satisfies` or re-export would be a self-reference, not a call site.
      if (file === "src/components/notice-tone.ts") continue;
      const count = constantReferences(file);
      if (count > 0) actual[file] = count;
    }
    expect(actual).toEqual(expected);
  });

  it("every member imports the constant FROM `./notice-tone`, unrenamed", () => {
    // George round 2: `isConstantTone` matches an identifier by SPELLING, so a
    // same-named binding would keep the assertions above green while the Notice
    // wore something else. This narrows that, and the comment states exactly how
    // far — an earlier version of it claimed the gap was closed, which both
    // lenses caught in round 4 and which measuring it here confirms.
    //
    // CLOSED by this assertion:
    //   - a module-scope `const NOTHING_FAILED_TONE` instead of the import: a
    //     second binding of one name in module scope is a duplicate-identifier
    //     error, so requiring the import makes it uncompilable;
    //   - `import { X as NOTHING_FAILED_TONE } from "./elsewhere"`: the module
    //     specifier and the absence of a `propertyName` are both checked, so a
    //     rename or a different module fails here.
    //
    // NOT CLOSED, and measured rather than assumed: a shadow in an INNER scope.
    // `const NOTHING_FAILED_TONE = "info" as const` inside the component body is
    // legal TypeScript, every `<Notice tone={NOTHING_FAILED_TONE}>` in that body
    // silently rebinds to it, and this file stays green. `tsc` flagged only
    // TS6133 (the import going unread) when EVERY use was inside the shadowed
    // scope — with one use left outside, even that would not fire, and
    // `eslint.config.mjs` has no `no-shadow`. Closing it needs a `ts.Program`
    // and a real type checker to resolve each identifier to its declaration,
    // which is more than this lane is buying. It takes a deliberate, odd edit,
    // and it is written down here rather than left as a claim that the check is
    // sound.
    for (const rel of [
      "src/components/segments-screen.tsx",
      "src/components/share-outcome-glyph.ts",
    ]) {
      const imported = parse(rel)
        .statements.filter((st) => ts.isImportDeclaration(st))
        .some((decl) => {
          if (!ts.isStringLiteral(decl.moduleSpecifier)) return false;
          if (decl.moduleSpecifier.text !== "./notice-tone") return false;
          const bindings = decl.importClause?.namedBindings;
          if (bindings === undefined || !ts.isNamedImports(bindings)) {
            return false;
          }
          return bindings.elements.some(
            (el) =>
              el.name.text === "NOTHING_FAILED_TONE" &&
              el.propertyName === undefined
          );
        });
      expect(
        imported,
        `${rel} does not import the constant unrenamed from ./notice-tone`
      ).toBe(true);
    }
  });

  it("the constant is the tone the share table actually hands the screen", () => {
    // Survives a re-tone: it says the two agree, not what they say. The literal
    // `alert` is pinned by `share-outcome-glyph.test.ts`, which is commented as
    // the place to change when #147 is answered.
    expect(shareOutcomeGlyph("nothing").tone).toBe(NOTHING_FAILED_TONE);
  });
});
