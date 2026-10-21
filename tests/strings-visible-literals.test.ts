import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * #1483 slice 3 — a gate that sees short labels.
 *
 * `tests/strings-one-table.test.ts` keeps the table's own words from being
 * typed again, and keeps a punctuated sentence from being minted beside the
 * code. Both of its checks compare against what the table already holds, or
 * need a space and a stop, so a SHORT label the table never held passes all
 * three of them: `<button aria-label="Close">Share</button>` added to
 * `segment-row.tsx` left that file green (PR #1543, by mutation).
 *
 * THE TECHNIQUE: read each file's TypeScript parse tree and collect every
 * string a JSX element can put in front of a person or a screen reader:
 *
 *   - JSX text, whitespace collapsed;
 *   - a JSX child expression (`{"Share"}`, `{busy ? "Saving" : x}`);
 *   - the value of every JSX attribute, unless its name is on `NON_UI_PROPS`
 *     below or starts with `data-`; a component enum (`ENUM_PROPS`) is read
 *     only when its value, as written, has whitespace in it;
 *   - the value of an object-literal property whose key reads as visible
 *     (`label`, `title`, `*Label`, …), the shape a menu item list takes.
 *
 * Only the strings an expression can RESULT in are read, by one recursive
 * walk (`resultStrings`): a literal, a template's fixed text AND its
 * interpolations, both arms of `?:`, array elements, both operands of `+`,
 * the operands of `??`, `||` and `&&` that can be its value, parentheses,
 * `as` / `satisfies` / `!` wrappers, and the arguments of a call, including
 * the return expression of an inline arrow or function passed as one
 * (`rows.map(() => "Share")`). It stops
 * only at a table read (`strings.*`, `plural(...)`) and at the keyword
 * arguments of the helpers on `TOKEN_CALLEES` (`restartLabel("cutAudio")`).
 * A literal that is compared (`x === "line"`) is not a result,
 * so it is not read. Comments are not nodes, so no prose can satisfy or trip
 * this. A string with no letter in it (`·`, `/`, `,`) passes: a symbol is not
 * a word to translate. Anything else must come from `strings`, which, being
 * an expression and not a literal, this gate never sees.
 *
 * Attributes are DENY BY DEFAULT on purpose. A list of the props that are
 * visible would let a new one (`message="Hello"`) through until someone
 * remembered to add it; a list of the props that are not makes that new prop
 * fail here, and the repair is to name it below with a reason. The last
 * fixture pins that no visible name can be put on that list.
 *
 * SCOPE: `app/`, `components/` and `hooks/`, the layers `strings-one-table`
 * reads, less `components/licenses.ts`, the licence disclosure record that
 * file also treats as a second table and not as copy.
 *
 * WHAT IT CANNOT SEE, so nobody reads more into a green run:
 *
 *   - a literal held in a variable or a constant and passed by name
 *     (`const close = "Close"; <b aria-label={close} />`);
 *   - a literal passed as an argument to a function that returns copy;
 *   - a `{...spread}` of props, and a key on an object literal that does not
 *     read as visible (`{ words: "Share" }`);
 *   - a string a hook returns or sets in plain `.ts` with no JSX around it.
 *     `hooks/` is in scope so a `.tsx` hook would be read, but the sentences
 *     hooks produce are `strings-one-table`'s job;
 *   - a label composed from table entries with symbols between them
 *     (`` `${a} · ${b}` ``), which has no letter of its own. That is the
 *     separator question slice 2 answered with `sentences(...)`, and it is
 *     read by eye, not here.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

const LAYERS = ["app", "components", "hooks"] as const;

/** The licence disclosure record — a table of its own, see above. */
const LICENCE_TABLE = path.join(ROOT, "src", "components", "licenses.ts");

/**
 * JSX attributes whose value is never shown or spoken. Each group says why.
 * `data-*` is out by prefix: it is a hook for CSS and tests, never content.
 */
const NON_UI_PROPS: ReadonlyMap<string, string> = new Map([
  // Styling and layout: class names, inline style, SVG geometry and paint.
  ...[
    "className",
    "style",
    "d",
    "viewBox",
    "fill",
    "stroke",
    "strokeWidth",
    "strokeLinecap",
    "strokeLinejoin",
    "cx",
    "cy",
    "r",
    "rx",
    "x",
    "y",
    "width",
    "height",
    "focusable",
  ].map((name) => [name, "styling or SVG geometry"] as const),
  // Identity and wiring: React keys, element ids, and the ARIA attributes
  // whose value is an id reference, not text.
  ...[
    "key",
    "id",
    "focusKey",
    "aria-labelledby",
    "aria-describedby",
    "aria-controls",
  ].map((name) => [name, "an id or a key, never shown"] as const),
  // A link target: the browser navigates to it; the link's words are its
  // children and its `label`, which stay in scope.
  ["href", "a URL, navigated to, not read"],
  // Enumerated HTML and ARIA tokens: the browser reads a keyword, not words.
  ...[
    "type",
    "role",
    "dir",
    "scope",
    "target",
    "rel",
    "autoComplete",
    "aria-hidden",
    "aria-modal",
    "aria-live",
    "aria-current",
  ].map((name) => [name, "an HTML or ARIA keyword"] as const),
]);

/**
 * This app's component enums: an icon name, a tone, a variant or a state
 * token that a component maps to a glyph or a class, never to words. `name`
 * is one only on `<Icon>`: `O4BookHead` and `O4BookDeleteAsk` render their
 * `name` as text. A value with a space in it is still flagged, because
 * `book-open` is a token and `Close menu` is not.
 */
const ENUM_PROPS: ReadonlySet<string> = new Set([
  "icon",
  "ctaIcon",
  "glyph",
  "tone",
  "variant",
  "current",
]);
const TAG_ENUM_PROPS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Icon", new Set(["name"])],
]);
const isEnumProp = (tag: string, name: string): boolean =>
  ENUM_PROPS.has(name) || TAG_ENUM_PROPS.get(tag)?.has(name) === true;

/**
 * Names that read as visible. Used for object-literal keys, and to prove that
 * none of them can be put on `NON_UI_PROPS`. Exact names plus the suffixes the
 * repo's component props use (`confirmLabel`, `closeLabel`, `chapterHeading`).
 */
const VISIBLE_EXACT = new Set([
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-roledescription",
  "aria-placeholder",
  "title",
  "alt",
  "placeholder",
  "label",
  "caption",
  "headline",
  "text",
  "children",
  // `dangerouslySetInnerHTML={{ __html: … }}` puts this value on screen.
  "__html",
]);
const VISIBLE_SUFFIX = /(Label|Title|Text|Caption|Headline|Heading)$/;
const readsVisible = (name: string): boolean =>
  VISIBLE_EXACT.has(name) || VISIBLE_SUFFIX.test(name);

/**
 * Literals that stay, each with the reason it is not copy. Keyed by file,
 * place (`text`, or the prop's name) and value, so an entry covers one string
 * in one place in one file and a second copy elsewhere still fails. An entry that no longer matches anything fails too
 * (see the tree test), so this list cannot outlive what it excuses.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    "src/components/build-stamp.tsx: text: v",
    "the version prefix in the tester build stamp (`v1.1.0 · abc1234`); the footer is aria-hidden and the stamp is a technical identifier, not a sentence",
  ],
  [
    "src/components/about-panel.tsx: text: unfoldingWord/tc-mobile",
    "the source repository's path, a proper name shown as link text; the link's spoken name is `strings.aboutVisitAppSource`",
  ],
]);

/** Identifiers whose reads are table copy: the string table and `plural`. */
const TABLE_ROOTS: ReadonlySet<string> = new Set(["strings", "plural"]);

/**
 * Local helpers whose string arguments are keywords that pick a table entry
 * (`restartLabel("cutAudio", true)`), never words. A call to anything else is
 * walked, so `fmt("Share")` fails. Keyed by callee name; the tree test fails
 * an entry no file calls.
 */
const TOKEN_CALLEES: ReadonlyMap<string, string> = new Map([
  ["restartLabel", "its first argument names a recovery case"],
  ["restartConsequence", "its first argument names a recovery case"],
  ["recoveryTitle", "its first argument names a failure kind"],
  ["shareProgressText", "its second argument is the scope, chapter or book"],
  ["shareGapText", "its second argument is the scope, chapter or book"],
  ["rowHint", "its argument names a hint kind"],
  ["handle", "selection-overlay's local; its first argument is an edge"],
]);

type Finding = { line: number; where: string; value: string };

/** HTML entities in JSX text (`&nbsp;`) are symbols, not words. */
const hasWord = (value: string): boolean =>
  /\p{L}/u.test(value.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, ""));

/**
 * A read that comes from the table: `strings.x`, `strings.x(…)`, `plural(…)`.
 * The walk stops here, because whatever it returns is table copy.
 */
function isTableRead(node: ts.Expression): boolean {
  let head: ts.Expression = node;
  while (
    ts.isPropertyAccessExpression(head) ||
    ts.isElementAccessExpression(head) ||
    ts.isCallExpression(head)
  ) {
    head = head.expression;
  }
  return ts.isIdentifier(head) && TABLE_ROOTS.has(head.text);
}

/**
 * What an inline callback hands back: an arrow's expression body, or the
 * operand of each `return` in a block body. A nested function is its own
 * callback, so a `return` inside one is not this callback's result. Only a
 * callback written as a call argument is followed (`rows.map(() => "Share")`);
 * a handler in a JSX attribute (`onClick={() => go("x")}`) is not copy.
 */
function returnedExpressions(
  fn: ts.ArrowFunction | ts.FunctionExpression
): ts.Expression[] {
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      out.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  fn.body.statements.forEach(visit);
  return out;
}

/**
 * The fixed strings an expression can evaluate to — see the docblock. One
 * recursive walk: every sub-expression a rendered value can come from is
 * visited, and it stops only at a table read. There are no per-shape arms
 * beyond the node kinds that carry a sub-expression.
 */
function resultStrings(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (isTableRead(node)) return [];
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [
        ...resultStrings(span.expression),
        span.literal.text,
      ]),
    ];
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return resultStrings(node.expression);
  }
  if (ts.isConditionalExpression(node)) {
    return [...resultStrings(node.whenTrue), ...resultStrings(node.whenFalse)];
  }
  if (ts.isArrayLiteralExpression(node)) {
    // React renders each element of an array child.
    return node.elements.flatMap((el) =>
      resultStrings(ts.isSpreadElement(el) ? el.expression : el)
    );
  }
  if (ts.isCallExpression(node)) {
    // A call that is not a table read: whatever it is given may come back,
    // unless the callee is a named keyword-taking helper.
    const callee = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : ts.isIdentifier(node.expression)
        ? node.expression.text
        : "";
    if (TOKEN_CALLEES.has(callee)) return [];
    return node.arguments.flatMap((arg) =>
      ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
        ? returnedExpressions(arg).flatMap(resultStrings)
        : resultStrings(ts.isSpreadElement(arg) ? arg.expression : arg)
    );
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return resultStrings(node.right);
    }
    if (
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...resultStrings(node.left), ...resultStrings(node.right)];
    }
  }
  return [];
}

/** Every visible literal with a letter in it, in one parsed file. */
function visibleLiterals(source: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  const add = (node: ts.Node, where: string, values: string[]): void => {
    const line =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const value of values) {
      const shown = value.replace(/\s+/g, " ").trim();
      if (hasWord(shown)) out.push({ line, where, value: shown });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      add(node, "text", [node.text]);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const tag = node.parent.parent.tagName.getText(source);
      const init = node.initializer;
      if (
        init !== undefined &&
        !NON_UI_PROPS.has(name) &&
        !name.startsWith("data-")
      ) {
        const value = ts.isJsxExpression(init) ? init.expression : init;
        if (value !== undefined && !ts.isJsxElement(value)) {
          const values = resultStrings(value as ts.Expression);
          add(
            node,
            name,
            isEnumProp(tag, name) ? values.filter((v) => /\s/.test(v)) : values
          );
        }
      }
    } else if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression !== undefined
    ) {
      add(node, "child", resultStrings(node.expression));
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      readsVisible(node.name.text)
    ) {
      add(node, node.name.text, resultStrings(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const parseTsx = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

/** A throwaway component — never a file on disk. */
const probe = (jsx: string): string[] =>
  visibleLiterals(
    parseTsx("probe.tsx", `export const P = () => (\n${jsx}\n);\n`)
  ).map(({ where, value }) => `${where}: ${value}`);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = LAYERS.flatMap((layer) =>
  sourceFiles(path.join(ROOT, "src", layer))
).filter((file) => file !== LICENCE_TABLE);

describe("the visible-literal reader, in both states (#1483 slice 3)", () => {
  it("flags a short label in JSX text, a child and an accessible name", () => {
    expect(probe(`<button aria-label="Close" />`)).toEqual([
      "aria-label: Close",
    ]);
    expect(probe(`<button>Share</button>`)).toEqual(["text: Share"]);
    expect(probe(`<p>{"Share"}</p>`)).toEqual(["child: Share"]);
    expect(probe(`<p>{busy && "Saving"}</p>`)).toEqual(["child: Saving"]);
    expect(probe(`<p>{\`Share \${n}\`}</p>`)).toEqual(["child: Share"]);
    expect(probe(`<img alt="A book" />`)).toEqual(["alt: A book"]);
    expect(probe(`<input placeholder="Name" />`)).toEqual([
      "placeholder: Name",
    ]);
    expect(probe(`<i title={"Help"} />`)).toEqual(["title: Help"]);
    expect(probe(`<i aria-description="Opens the menu" />`)).toEqual([
      "aria-description: Opens the menu",
    ]);
  });

  it("flags a literal in either arm, and a prop nobody listed", () => {
    expect(probe(`<Control label={busy ? "Saving" : strings.save} />`)).toEqual(
      ["label: Saving"]
    );
    expect(probe(`<Confirm confirmLabel={x ?? "Delete"} />`)).toEqual([
      "confirmLabel: Delete",
    ]);
    expect(probe(`<p>{x || "Saving"}</p>`)).toEqual(["child: Saving"]);
    // Deny by default: a visible prop with a name no list knows still fails.
    expect(probe(`<Toast message="Hello" />`)).toEqual(["message: Hello"]);
    // `name` is an enum on `<Icon>` only; `O4BookHead` renders it as text.
    expect(probe(`<O4BookHead name="Untitled" />`)).toEqual(["name: Untitled"]);
    // A component enum with a space in it is words, not a token.
    expect(probe(`<Control icon="Close menu" />`)).toEqual([
      "icon: Close menu",
    ]);
  });

  it("judges an enum value as written, edge whitespace included", () => {
    expect(probe(`<Control icon=" Close " />`)).toEqual(["icon: Close"]);
    expect(probe(`<Control tone={"Close "} />`)).toEqual(["tone: Close"]);
    expect(probe(`<Control icon="book-open" />`)).toEqual([]);
  });

  it("follows the return of an inline callback passed to a call", () => {
    expect(probe(`<ul>{rows.map(() => "Share")}</ul>`)).toEqual([
      "child: Share",
    ]);
    expect(
      probe(
        `<ul>{rows.map((r) => { if (r) return "Share"; return "Save"; })}</ul>`
      )
    ).toEqual(["child: Share", "child: Save"]);
    expect(
      probe(
        `<ul>{rows.map(function () { return busy ? "Saving" : strings.x; })}</ul>`
      )
    ).toEqual(["child: Saving"]);
    // A callback that reads the table, that only holds a nested function's
    // string, or a plain handler attribute, is not copy.
    expect(probe(`<ul>{rows.map(() => strings.share)}</ul>`)).toEqual([]);
    expect(
      probe(
        `<ul>{rows.map(() => { const f = () => "Share"; return strings.x; })}</ul>`
      )
    ).toEqual([]);
    expect(probe(`<b onClick={() => go("Share")} />`)).toEqual([]);
  });

  it("flags an array element, a `+` operand and inner HTML", () => {
    expect(probe(`<p>{["Share"]}</p>`)).toEqual(["child: Share"]);
    expect(probe(`<p>{c ? ["Share"] : null}</p>`)).toEqual(["child: Share"]);
    expect(probe(`<p>{"Share " + n}</p>`)).toEqual(["child: Share"]);
    expect(
      probe(`<p dangerouslySetInnerHTML={{ __html: "Share" }} />`)
    ).toEqual(["__html: Share"]);
    expect(probe(`<Menu items={[{ label: "Share", href: "/s" }]} />`)).toEqual([
      "label: Share",
    ]);
  });

  it("passes the table, symbols, numbers and non-UI props", () => {
    expect(
      probe(
        `<div className="row" data-testid="row-3" role="list" dir="auto">` +
          `<button aria-label={strings.menuClose} />` +
          `<span>{n}</span><span>·</span><span>{" / "}</span>` +
          `<Icon name={open ? "book-open" : "book"} tone="done" />` +
          `<Control icon={p ? "pause" : "play"} label={src === "line" ? strings.a : strings.b} />` +
          `<Control label={restartLabel("cutAudio", true)} />` +
          `<p>{/* Share the chapter */}{strings.share}&nbsp;</p>` +
          `<p aria-current={here ? "page" : undefined} />` +
          `</div>`
      )
    ).toEqual([]);
  });

  it("flags a literal nested at any depth, and passes a table interpolation", () => {
    // The sibling shapes the review series kept finding one at a time.
    expect(
      probe(`<button>{\`\${busy ? "Archiving" : "Queued"}\`}</button>`)
    ).toEqual(["child: Archiving", "child: Queued"]);
    expect(
      probe(`<p>{[\`\${(c ? "Deep" : strings.x) as string}\`]}</p>`)
    ).toEqual(["child: Deep"]);
    expect(probe(`<p>{fmt("Share", n)}</p>`)).toEqual(["child: Share"]);
    expect(probe(`<p>{(x ?? "Share")!}</p>`)).toEqual(["child: Share"]);
    // Table-derived reads stop the walk, at any depth.
    expect(
      probe(
        `<p>{\`\${strings.x}\`}{[\`\${busy ? strings.a : strings.b}\`]}` +
          `{strings.count(n, "word")}{plural(n, { one: "x" })}</p>`
      )
    ).toEqual([]);
  });

  it("cannot put a visible name on the non-UI list", () => {
    const leaks = [
      ...NON_UI_PROPS.keys(),
      ...ENUM_PROPS,
      ...[...TAG_ENUM_PROPS.values()].flatMap((names) => [...names]),
    ].filter(readsVisible);
    expect(leaks).toEqual([]);
    for (const name of ["aria-label", "title", "alt", "placeholder", "label"]) {
      expect(readsVisible(name)).toBe(true);
    }
    expect(readsVisible("closeLabel")).toBe(true);
    expect(readsVisible("className")).toBe(false);
  });
});

describe("no visible literal in app/, components/ or hooks/ (#1483 slice 3)", () => {
  it("has files to check", () => {
    // A floor, not a census: a rename of a layer would otherwise turn the
    // loop below into an assertion over nothing.
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain(
      path.join(ROOT, "src", "components", "segment-row.tsx")
    );
    expect(files).not.toContain(LICENCE_TABLE);
  });

  it("every visible string with a word in it comes from the table, or is allowed by name", () => {
    const found: string[] = [];
    const used = new Set<string>();
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const source = parseTsx(file, readFileSync(file, "utf8"));
      for (const { line, where, value } of visibleLiterals(source)) {
        const key = `${rel}: ${where}: ${value}`;
        if (ALLOWED.has(key)) {
          used.add(key);
          continue;
        }
        found.push(`${rel}:${line} ${where}: ${value}`);
      }
    }
    expect(found).toEqual([]);
    const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(
      [...TOKEN_CALLEES.keys()].filter((name) => !text.includes(`${name}(`))
    ).toEqual([]);
    // A stale entry would excuse the next literal typed in its place.
    expect([...ALLOWED.keys()].filter((key) => !used.has(key))).toEqual([]);
  });
});
