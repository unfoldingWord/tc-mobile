import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { strings } from "@/lib/strings";

/**
 * #169 — the string table is the only place a translator-facing sentence is
 * written down.
 *
 * The table always claimed to be that, and was not: it lived in `components/`,
 * the onion rule forbids `hooks/` from importing upward, so every sentence a
 * hook had to produce was a literal beside the code that raised it.
 *
 * There are two ways out of that, and #169 has now taken both. Where the
 * failure is a domain value `lib/` also reasons about, the hook emits a CODE
 * and a component words it: #700 did that for the recorder's three capture
 * failures (`lib/audio/capture-failure.ts` ->
 * `components/capture-failure-copy.ts`). Where the sentence IS the state the
 * hook holds — `playbackError`, the recorder's mic-refusal `error` — there is
 * no value to route, and the only fix is for the table to be reachable from
 * below. Moving it to `lib/` is that fix.
 *
 * Either way the words end up in one file, and this is what stops a literal
 * coming back beside the code that raises it.
 *
 * WHAT IT CHECKS, EXACTLY: no fixed sentence in the table appears as source text
 * anywhere in `app/`, `components/` or `hooks/` outside the table itself. It is
 * a source-text gate for the same reason `recorder-stop-release-guards.test.ts`
 * is one — there is no renderer here to ask a screen what it says.
 *
 * WHAT IT DOES NOT CHECK, so nobody reads more into a green run:
 *
 *   - A sentence assembled at the call site from fragments, or written as a
 *     template literal with an interpolation in the middle of it, is invisible
 *     here: the check is substring containment against the table's own fixed
 *     values.
 *   - `lib/` is deliberately OUT of scope. It raises `Error` messages for a
 *     maintainer, not copy for a screen, and one of them —
 *     `DatabaseBlockedError` in `lib/storage/db.ts` — opens with the same
 *     sentence as `strings.dbBlocked` and then continues differently, because
 *     it is addressed to whoever reads the failure log rather than to the
 *     translator holding the phone. Including `lib/` would fail on that
 *     deliberate pair, and the repair would be to weaken the pattern, which
 *     AGENTS.md names as the way a gate like this stops catching anything.
 *   - The parameterised entries (the functions) are not enumerated here —
 *     `Object.values` hands back the function, never the labels it can return
 *     — and neither is a label with no stop ("Try saving again"), which
 *     `isSentence` below excludes on purpose. Both are the LABEL gate's job,
 *     further down this file (#805 items 2 and 6), which reads whole literals
 *     rather than substrings and so needs no widening of `isSentence`.
 */
const ROOT = path.resolve(import.meta.dirname, "..");

/** The layers that put words on a screen. `lib/` is excluded — see above. */
const SCREEN_LAYERS = ["app", "components", "hooks"] as const;

/** The table's own file, which is allowed to contain its own values. */
const TABLE = path.join(ROOT, "src", "lib", "strings.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Parsed once per file, as TSX or TS by extension. Both source-text checks and
 * the label gate read from this, so all three agree on what is code.
 */
const parsed = new Map<string, { text: string; source: ts.SourceFile }>();

function parse(file: string): { text: string; source: ts.SourceFile } {
  const hit = parsed.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const entry = { text, source };
  parsed.set(file, entry);
  return entry;
}

/**
 * Comments removed, so the gate reads CODE and not prose about code. Several
 * of this repo's comments quote the very sentences below in order to explain
 * them, and scoring those would make the gate fire on documentation.
 *
 * The ranges come from TypeScript's own parser — the comment trivia before and
 * after every token — and only those byte ranges are cut. So a `//` inside a
 * string, a template or JSX text is never read as a comment, and nothing after
 * it on the line is lost (#805 item 4). The regex strip this replaced was
 * line-wise: `"https://…"; setError("…")` lost the second sentence, and the
 * gate went green on it. The first test below is that line.
 *
 * `JsxText` is skipped when collecting: TypeScript's comment scanner does not
 * know it is in JSX, so asking it about text like `see http://…` would report a
 * comment that is not one.
 */
function stripComments(file: string): string {
  const { text, source } = parse(file);
  return stripCommentsFrom(text, source);
}

function stripCommentsFrom(text: string, source: ts.SourceFile): string {
  const ranges = new Map<number, number>();
  const visit = (node: ts.Node): void => {
    if (node.kind !== ts.SyntaxKind.JsxText) {
      for (const range of [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.pos) ?? []),
      ]) {
        ranges.set(range.pos, range.end);
      }
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  let code = "";
  let at = 0;
  for (const [pos, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (pos < at) continue;
    code += text.slice(at, pos);
    at = end;
  }
  return code + text.slice(at);
}

/**
 * A sentence, as opposed to a label: it has a space in it and it ends in a stop.
 *
 * The bare labels ("Record", "Cancel", "Book", "Menu") are excluded because they
 * are ordinary words that also occur as identifiers, icon names and union
 * members all over `src/` — matching them would fire on `case "Record":` and the
 * only way back to green would be to stop matching anything.
 */
const isSentence = (value: string): boolean =>
  value.includes(" ") && /[.?]$/.test(value);

/**
 * Widened before the narrowing: `strings` is `as const`, so `Object.values`
 * gives a union of every literal and every parameterised entry's signature, and
 * a `value is string` predicate on that union is rejected outright (TS2677) —
 * its type has to be assignable to the parameter's. `unknown` is the honest
 * input type for "some of these are functions and we want the ones that aren't".
 */
const tableValues: readonly unknown[] = Object.values(strings);

const sentences = tableValues
  .filter((value): value is string => typeof value === "string")
  .filter(isSentence);

const files = SCREEN_LAYERS.flatMap((layer) =>
  sourceFiles(path.join(ROOT, "src", layer))
).filter((file) => file !== TABLE);

/** A throwaway source for the strip's own tests — never a file on disk. */
const probe = (name: string, text: string): string =>
  stripCommentsFrom(
    text,
    ts.createSourceFile(
      name,
      text,
      ts.ScriptTarget.Latest,
      true,
      name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
  );

describe("the comment strip both checks read through (#805 item 4)", () => {
  it("keeps a sentence that follows a quoted // on the same line", () => {
    const code = probe(
      "probe.ts",
      'const help = "https://example.com"; setError("Brand new sentence the table has never held.");\n' +
        'const msg = u.startsWith("https://") ? "A stranded sentence." : "x";'
    );
    expect(code).toContain("Brand new sentence the table has never held.");
    expect(code).toContain("A stranded sentence.");
  });

  it("removes line, trailing, block and JSX comments, but not a // in JSX text or a template", () => {
    const code = probe(
      "probe.tsx",
      "// a line comment\n" +
        "const a = <p>{/* in JSX */}see http://x.org now</p>; // trailing\n" +
        "/* block */ const c = `a//b ${d /* inside */}`;"
    );
    for (const gone of [
      "a line comment",
      "in JSX",
      "trailing",
      "block",
      "inside",
    ]) {
      expect(code).not.toContain(gone);
    }
    expect(code).toContain("see http://x.org now");
    expect(code).toContain("`a//b ${d }`");
  });
});

describe("the one string table (#169)", () => {
  // The floor. Both loops below assert nothing at all if either list comes back
  // empty — a rename of `src/hooks`, or an `isSentence` that stops matching —
  // and an assertion looping over nothing is the failure mode AGENTS.md says to
  // keep a floor against. The numbers are deliberately far below what the tree
  // returns, so ordinary copy edits and file moves never touch this line; they
  // are a floor, not a census, and nothing here should be read as one.
  it("has sentences to check, in files to check them against", () => {
    expect(sentences.length).toBeGreaterThan(30);
    expect(files.length).toBeGreaterThan(20);
  });

  it("holds every fixed sentence exactly once — none is written out again in app/, components/ or hooks/", () => {
    const duplicates: string[] = [];
    for (const file of files) {
      const code = stripComments(file);
      for (const sentence of sentences) {
        if (code.includes(sentence)) {
          duplicates.push(`${path.relative(ROOT, file)}: ${sentence}`);
        }
      }
    }
    // Named, not counted: the message has to say which file and which sentence,
    // because "1 !== 0" would send the next reader hunting.
    expect(duplicates).toEqual([]);
  });
});

/**
 * The other direction: a sentence in a hook that the table never held at all.
 *
 * The duplicate check above only knows the sentences already in the table, so a
 * BRAND NEW one typed straight into `use-recorder.ts` passes it — the exact
 * shape #169 is about, and the one the duplicate gate cannot see (raised as a
 * nonblocking QA suggestion on PR #678). Four base merges under this branch each
 * brought new files, and finding this class in them was a manual scan every
 * time. This is that scan.
 *
 * SCOPE IS `hooks/` AND `app/` ONLY, and that is a boundary rather than an
 * allowlist. In those two layers the table is the only legitimate source of a
 * translator-facing sentence. `components/` is not: `recovery-copy.ts` is a
 * second copy module on purpose — pure, tested, and deliberately left where it
 * is by this PR — so every one of its thirteen sentences would fail here, and
 * the repair would be a list of exceptions that a real leak could later hide
 * inside. A gate that needs an allowlist on day one is the "weaken the pattern
 * until it catches nothing" move AGENTS.md names; this one needs none.
 *
 * WHAT IT CANNOT SEE: a sentence composed at the call site. A template literal
 * carrying `${...}` is skipped outright, because its text is not fixed and there
 * is nothing to compare. So this is a floor under the hooks layer, not a proof
 * that every word a hook can produce came from the table. The behavioural
 * version of that proof — rendering a screen and reading what it says — is a
 * different technique, and it belongs beside `recovery-copy.ts`'s own tests
 * rather than in a source-text gate.
 */
const HOOK_LAYERS = ["app", "hooks"] as const;

/**
 * Double-quoted, single-quoted, and interpolation-free template literals.
 * `[^`$\\\n]` is what drops a composed template: one `${` and the literal is not
 * matched at all, which is the intended miss described above.
 */
const LITERAL_FORMS = [
  /"((?:[^"\\\n]|\\.)+)"/g,
  /'((?:[^'\\\n]|\\.)+)'/g,
  /`([^`$\\\n]+)`/g,
] as const;

/**
 * Compared against the table's VALUES, never its file text. A sentence that
 * appears only inside a comment in `strings.ts` — explaining an entry rather
 * than being one — must not satisfy this, or the gate could be silenced by
 * documentation, which is the capture `share-progress.test.ts` actually
 * suffered (AGENTS.md, "the same trap runs in the other direction").
 */
const tableSentences = new Set(
  tableValues.filter((value): value is string => typeof value === "string")
);

const hookFiles = HOOK_LAYERS.flatMap((layer) =>
  sourceFiles(path.join(ROOT, "src", layer))
);

describe("no sentence is stranded in a hook (#169)", () => {
  it("has files to check", () => {
    // Same floor, same reason as above: a rename of `src/hooks` would otherwise
    // turn the loop below into an assertion over nothing.
    expect(hookFiles.length).toBeGreaterThan(10);
  });

  it("every punctuated, non-composed literal in app/ and hooks/ is one the table holds", () => {
    const stranded: string[] = [];
    for (const file of hookFiles) {
      const code = stripComments(file);
      for (const form of LITERAL_FORMS) {
        for (const match of code.matchAll(form)) {
          const value = match[1];
          if (value === undefined) continue;
          if (!isSentence(value)) continue;
          if (tableSentences.has(value)) continue;
          stranded.push(`${path.relative(ROOT, file)}: ${value}`);
        }
      }
    }
    expect(stranded).toEqual([]);
  });
});

/**
 * #805 items 2 and 6 — the words the two gates above cannot see.
 *
 * `isSentence` needs a space and a closing stop, so a label ("Try saving
 * again", "Tap again to delete this recording for good") is invisible to both
 * checks; and a parameterised entry is a function, so `Object.values` never
 * hands back any of its outputs — including `saveFailedHeld`, the one line on a
 * failed save that says the recording survived. Re-inlining any of those in a
 * component passed.
 *
 * Widening `isSentence` to take labels into the substring match above was
 * tried and rejected, not assumed: a label is short enough to occur inside a
 * longer sentence, so a substring match on labels fires on prose that merely
 * contains one (`"Delete this recording"` sits inside a `recovery-copy.ts`
 * sentence). The same trial found `restartLabel`'s `"Restart the app"`, a real
 * second copy of `strings.appReload`, now routed through the table. That is
 * why this is a different technique rather than a wider pattern.
 *
 * THE TECHNIQUE: exact equality against WHOLE literals, read from the parse
 * tree — every string literal, every interpolation-free template, and every
 * run of JSX text (whitespace collapsed). A label inside a longer sentence is
 * not a whole literal, so the false positive above cannot occur; comments are
 * not nodes, so documentation cannot trip it.
 *
 * WHAT IT COVERS: every fixed table value with a space in it, plus every output
 * of the save-failed and take-recovery parameterised entries over their whole
 * domain, enumerated below. `saveFailedHeld` with an ordinal is composed at
 * run time, so its gate is the template shape instead: a template whose fixed
 * text around one `${…}` is the table's.
 *
 * WHAT IT DOES NOT: the other parameterised entries (counts, names, ordinals
 * outside `saveFailedHeld`) are not enumerated — their domains are not finite
 * — and a label assembled from fragments at the call site is not a whole
 * literal. Single-word labels are out, for the reason `isSentence` gives.
 */
const enumeratedOutputs: readonly string[] = [false, true].flatMap(
  (editOnly) => [
    strings.saveFailedDialog(editOnly),
    strings.saveFailedDiscard(editOnly, false),
    strings.saveFailedDiscard(editOnly, true),
    strings.saveFailedDiscardHint(editOnly),
    strings.saveFailedHeld(editOnly, null),
  ]
);

const labels = new Set<string>([
  ...tableValues
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value.includes(" ")),
  ...enumeratedOutputs,
]);

/**
 * `saveFailedHeld(editOnly, n)` split around the ordinal, by asking the table
 * with a sentinel no real segment reaches. The sentinel must appear exactly
 * once, or the split is not describing one interpolation.
 */
const SENTINEL = 987_654_321;
const heldTemplates = [false, true].map((editOnly) =>
  strings.saveFailedHeld(editOnly, SENTINEL).split(String(SENTINEL))
);

/** Whole literal values in one file, keyed to where they sit. */
function wholeLiterals(file: string): { value: string; line: number }[] {
  const { source } = parse(file);
  const out: { value: string; line: number }[] = [];
  const at = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({ value: node.text, line: at(node) });
    } else if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, " ").trim();
      if (value !== "") out.push({ value, line: at(node) });
    } else if (
      ts.isTemplateExpression(node) &&
      node.templateSpans.length === 1
    ) {
      const [span] = node.templateSpans;
      out.push({
        value: `${node.head.text}\u0000${span?.literal.text ?? ""}`,
        line: at(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const heldShapes = new Set(heldTemplates.map((parts) => parts.join("\u0000")));

describe("no label is written out again (#805 items 2 and 6)", () => {
  it("has labels, arms and templates to check", () => {
    // Floors, for the reason the two above have them. The first is far below
    // the tree's count; the second is exact because the enumeration above is
    // written out by hand; the third proves the sentinel split found one hole.
    expect(labels.size).toBeGreaterThan(30);
    expect(enumeratedOutputs).toHaveLength(10);
    for (const parts of heldTemplates) expect(parts).toHaveLength(2);
  });

  it("no whole literal in app/, components/ or hooks/ is a table label or a parameterised arm", () => {
    const duplicates: string[] = [];
    for (const file of files) {
      for (const { value, line } of wholeLiterals(file)) {
        if (labels.has(value) || heldShapes.has(value)) {
          duplicates.push(
            `${path.relative(ROOT, file)}:${line}: ${value.replace("\u0000", "${…}")}`
          );
        }
      }
    }
    expect(duplicates).toEqual([]);
  });
});

/**
 * #805 item 1 — the two destructive confirms that destroy the only copy of a
 * recording say it in one wording. The table aliases the save-failed record
 * path to the take-recovery keys; this catches the DIVERGENCE, which is the
 * defect, should either side ever be re-typed rather than aliased.
 */
describe("the two only-copy discard confirms read the same (#805 item 1)", () => {
  it("SaveFailed's record-path discard is the take-recovery panel's", () => {
    expect(strings.saveFailedDiscard(false, false)).toBe(
      strings.takeRecoverDiscard
    );
    expect(strings.saveFailedDiscard(false, true)).toBe(
      strings.takeRecoverDiscardArmed
    );
    expect(strings.saveFailedDiscardHint(false)).toBe(
      strings.takeRecoverDiscardHint
    );
  });
});

/**
 * The two count labels this file still owns, and nothing else.
 *
 * `tests/strings-plural.test.ts` owns the plural OUTPUT coverage — `bookRow`,
 * `shareBookMissing`, `failuresMarker`, and `menuOpenWithFailures` including
 * the equality that keeps it from drifting from `failuresMarker`. This block
 * used to assert all four a second time (Frank, round 4): duplicated coverage,
 * which is the "no duplicates" rule in AGENTS.md, and two places to edit when
 * a wording changes.
 *
 * What is left is what no other file pins:
 *
 *   - `shareMissing`'s own words. `share-book-partial-copy.test.ts` asserts
 *     `shareBookPartial(n) === shareMissing(n)`, and `share-error-copy.test.ts`
 *     uses `shareMissing(...)` as an expected value inside composed sentences —
 *     both catch divergence, neither pins the sentence itself.
 *   - The two zero cases. `strings-plural.test.ts` has one for `bookRow`; these
 *     two have none anywhere.
 */
describe("count labels this file owns", () => {
  it("pins shareMissing's own wording — no other file does", () => {
    expect(strings.shareMissing(1)).toBe("1 segment could not be included.");
    expect(strings.shareMissing(2)).toBe("2 segments could not be included.");
  });

  it("says zero in the plural form, not the singular", () => {
    // Nothing renders a zero today — `menuOpenWithFailures` replaces the plain
    // name only while the log is non-empty, and the share Notices only show on
    // a gap — but a table that answered "0 segment" would be wrong the first
    // time one of those gates changed, and the cost of pinning it now is one
    // line.
    //
    // English puts zero in `other`, which is CLDR's rule and not a choice this
    // file makes. A locale with a `zero` category selects it and these two
    // expectations no longer describe that locale — which is the point of the
    // rule living in `lib/plural.ts` rather than here.
    expect(strings.shareMissing(0)).toBe("0 segments could not be included.");
    expect(strings.failuresMarker(0)).toBe("0 problems recorded");
  });
});
