import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { strings } from "../src/components/strings";
import { messages } from "../src/lib/messages";

/**
 * Once a sentence is in a table, it stays there.
 *
 * #169's finding was not that the tables are the wrong shape — it is that they
 * were not the whole surface. Visible and aria strings sat inline in two hooks
 * and in `save-failed.tsx`, and three of `save-failed.tsx`'s were byte-identical
 * second copies of sentences `strings.ts` already held for the take-recovery
 * panel, kept in step by nothing but a comment saying the two screens had "the
 * same armed second-tap shape". A wording edit to either copy would have
 * diverged them silently. This test is what stops that re-forming.
 *
 * It compares WHOLE string literals, never substrings, and that is load-bearing
 * rather than fastidious: the first draft used `includes()` over the file and
 * flagged `lib/storage/db.ts`, whose `DatabaseBlockedError` message happens to
 * OPEN with `strings.dbBlocked`'s sentence and then says something else. That
 * is a log line, not the panel's copy, and the panel already reads the key. A
 * gate that demanded it be "fixed" would have been teaching the wrong lesson on
 * its first run.
 *
 * What it does NOT claim, so a green run is not read for more than it says:
 *
 *   - It sees a RE-INLINED sentence, never a brand-new one. Nothing in source
 *     distinguishes "a string the UI shows" from "a string a switch compares",
 *     and a gate that guessed would be switched off rather than obeyed.
 *   - It reads string and template literals. Copy typed straight into JSX text
 *     (`<p>Tap again to delete it.</p>`) is not a literal and is not seen. Every
 *     occurrence #169 found was a literal; this is the shape that recurs.
 *   - `recovery-copy.ts`, `share-error-copy.ts` and `encoder-notice.ts` hold
 *     parameterised copy that is deliberately in neither table. Sentences only
 *     they have are outside the set — a sentence a TABLE also holds is not.
 */

const SRC = join(import.meta.dirname, "..", "src");

/**
 * The two table files the source walk must reach — a floor on `sourceFiles()`,
 * nothing more. It is NOT an exemption list: each table is skipped only in its
 * own file (`file === owner` below), so the same sentence written as a literal
 * in both tables is still flagged, in both directions. An earlier draft did
 * exempt both files from both scans, which is the silent cross-layer split this
 * gate exists to prevent (George, #600 rounds 1 and 4).
 */
const TABLES = ["components/strings.ts", "lib/messages.ts"];

/** Under this length, or with no space in it, a value is a word, not a sentence. */
const SENTENCE_MIN = 12;

/**
 * The text of every string literal in `source`, using TypeScript's own parser.
 *
 * A whole-file search cannot be trusted here, and AGENTS.md records the trap in
 * both directions: `touch-policy.test.ts` false-hits on the very prose that BANS
 * what it searches for, and round 3 of #529 had `share-progress.test.ts` slice a
 * comment instead of the rule it names. The docblocks in `use-recorder.ts` quote
 * "Could not finish this recording." to explain which exit chooses it —
 * accurately, and they should keep doing so. Reading literals rather than raw
 * text is what makes that immunity structural.
 *
 * This WAS a hand lexer, and it was wrong in two ways that both reviewers found
 * independently (#600 round 1). George: the template-hole skipper counted braces
 * and was not string-aware. Frank: every quote was read as a string opener even
 * inside a REGEX, so `src/lib/utils.ts`'s `/[/\\:*?"<>|\p{Cc}]/gu` knocked the
 * scan out of alignment and a table sentence duplicated later in that same file
 * went undetected. `finds a duplicate after a regex literal` below is the
 * standing pin for that case, and is where a regression shows up.
 *
 * Four lexical constructs had to be modelled by hand — comments, quoted strings
 * with escapes, template holes, regex literals — and two were wrong. So the
 * fifth is not another point fix: `ts.createSourceFile` already knows all of
 * them, and TypeScript is already a devDependency this suite compiles with.
 *
 * The CONTRACT is unchanged, and still narrower than "every sentence on screen":
 * a `StringLiteral` or a hole-free template yields its text, a template WITH
 * holes yields nothing, and JSX text is not a literal and is still not seen.
 *
 * A holed template yields nothing because whole-literal equality is what keeps
 * `lib/storage/db.ts` off this gate: its `DatabaseBlockedError` message merely
 * OPENS with `strings.dbBlocked` and then says something else, and enrolling
 * `TemplateHead` fragments would recreate exactly that false hit. The residual
 * is real and is named rather than argued away — a fragment CAN equal a whole
 * sentence, as in `` `Could not play this recording.${detail}` ``, so a
 * duplicate spelled that way is not seen (George, #600 round 3). Nothing in the
 * tree is spelled that way today. If one appears, the answer is that call site,
 * not a looser scanner.
 */
export function stringLiterals(
  source: string,
  // `.tsx` must parse as TSX; a `.ts` file must not, or `<T>(x: T) => …` reads
  // as an unclosed JSX element. Callers pass the kind that matches the source.
  kind: ts.ScriptKind = ts.ScriptKind.TS
): string[] {
  const file = ts.createSourceFile(
    `probe${kind === ts.ScriptKind.TSX ? ".tsx" : ".ts"}`,
    source,
    ts.ScriptTarget.Latest,
    false,
    kind
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
}

/** Every `.ts`/`.tsx` file under `src/`, as posix paths relative to it. */
function sourceFiles(dir = SRC, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
        : /\.tsx?$/.test(entry.name)
          ? [`${prefix}${entry.name}`]
          : []
    )
    .sort();
}

/**
 * A table's sentence-shaped copy, paired with a label naming where it came from.
 *
 * A plain string value is the easy half. The hard half is the parameterised
 * entries: `sentences()` cannot see them, and this PR's own `saveFailedLabel` —
 * whose two branches are each a whole literal — slipped past the gate entirely
 * until George round 1 named it. `reads the parameterised keys, not just the
 * plain ones` below is the standing pin for that.
 *
 * The fix reads the function's own source with the same scanner, rather than
 * keeping a hand list of which keys to enumerate. A hand list rots, and worse,
 * it taxes every contributor who adds a parameterised key: the first draft of
 * this fix classified each key by hand, so any key nobody had classified failed
 * the gate — which is a gate punishing work it has no business judging. The shape rule has neither problem and is the honest test anyway —
 * what the gate protects against is a sentence being PASTED BACK, so the set it
 * must hold is exactly the bare literals the source spells out.
 *
 * So `failuresMarker` contributes `"1 problem recorded"`, the bare literal in
 * its singular branch, and contributes nothing for the plural branch, which is
 * a template. `shareMissing` contributes nothing at all: it reads the same to a
 * translator but is assembled by `couldNotBeIncluded`, so no literal of it
 * exists anywhere to paste. That is the same reason `stringLiterals` yields
 * nothing for a holed template.
 */
function tableSentences(table: Record<string, unknown>): [string, string][] {
  return Object.entries(table).flatMap(([key, value]): [string, string][] => {
    if (typeof value === "string") {
      return isSentence(value) ? [[key, value]] : [];
    }
    if (typeof value !== "function") return [];
    // The function's own source, through the scanner the fixtures above pin.
    // Comments inside the body are skipped and templates yield nothing, so what
    // comes back is the bare literals and only those.
    return stringLiterals(String(value))
      .filter(isSentence)
      .map((text): [string, string] => [`${key}()`, text]);
  });
}

/** Long enough, and with a space in it, to be copy rather than a word. */
function isSentence(value: string): boolean {
  return value.includes(" ") && value.length >= SENTENCE_MIN;
}

describe("stringLiterals", () => {
  it("finds a sentence written as a literal", () => {
    expect(
      stringLiterals('const a = "Could not finish this recording.";')
    ).toContain("Could not finish this recording.");
  });

  it("does not find one that only appears in a line comment", () => {
    expect(
      stringLiterals("// Could not finish this recording.\nconst a = 1;")
    ).toEqual([]);
  });

  it("does not find one that only appears in a block comment", () => {
    expect(
      stringLiterals("/**\n * Could not finish this recording.\n */\nlet a;")
    ).toEqual([]);
  });

  it("finds the text of a hole-free template literal", () => {
    expect(stringLiterals("const t = `No sound was recorded.`;")).toContain(
      "No sound was recorded."
    );
  });

  it("yields nothing for a template with a hole, and resumes after it", () => {
    const found = stringLiterals(
      'const t = `Your ${kind} recording`;\nconst u = "after";'
    );
    // `toEqual`, not `not.toContain` plus `toContain`: those two pass even if
    // the scanner emits the head and tail as separate strings, which is the
    // thing this case is named for (George, #600 round 4).
    expect(found).toEqual(["after"]);
  });

  it("does not read a URL inside a string as a comment opener", () => {
    const found = stringLiterals(
      'const u = "https://example.test/x";\nconst b = "kept";'
    );
    expect(found).toEqual(["https://example.test/x", "kept"]);
  });

  it("finds a duplicate after a regex literal (Frank round 1, #600)", () => {
    // The hand lexer read the `"` inside this character class as a string
    // opener and never recovered. This is `src/lib/utils.ts`'s real regex.
    const found = stringLiterals(
      'const x = s.replace(/[/\\\\:*?"<>|\\p{Cc}]/gu, " ");\n' +
        'const probe = "Could not finish this recording.";'
    );
    expect(found).toContain("Could not finish this recording.");
  });

  it("is not derailed by a string containing a brace inside a template hole (George round 1, #600)", () => {
    // The hand skipper counted braces and was not string-aware, so the `}` in
    // the hole's string closed the hole early and ate what followed.
    const found = stringLiterals(
      'const t = `a ${ f("}") } b`;\nconst after = "Could not play this recording.";'
    );
    expect(found).toContain("Could not play this recording.");
  });

  it("keeps generics in a .ts source and JSX in a .tsx one", () => {
    // The two script kinds are not interchangeable: `<T>(x: T) => …` in a .ts
    // file reads as an unclosed JSX element under the TSX parser.
    expect(
      stringLiterals('const f = <T,>(x: T) => "a sentence for you";')
    ).toContain("a sentence for you");
    expect(
      stringLiterals(
        'const el = <p title="a sentence for you">hi</p>;',
        ts.ScriptKind.TSX
      )
    ).toContain("a sentence for you");
  });

  it("reports a LONGER literal that merely starts with a sentence as its own text", () => {
    // Why whole-literal equality: `db.ts`'s Error message opens with
    // `strings.dbBlocked` and then says something else. It is not that copy.
    const found = stringLiterals('throw new Error("One sentence. And more.");');
    expect(found).toEqual(["One sentence. And more."]);
    expect(found).not.toContain("One sentence.");
  });
});

describe("centralised copy is not also inline", () => {
  const files = sourceFiles();

  it("reads the source tree", () => {
    // A floor, so a walk that silently found nothing cannot pass the assertions
    // below by looping over an empty list (AGENTS.md; #529 round 3).
    expect(files.length).toBeGreaterThan(30);
    expect(files).toEqual(expect.arrayContaining(TABLES));
  });

  // Each table is exempt from ITS OWN file only, never from the other's (George
  // round 1, #600). Exempting both meant a sentence stored as a literal in
  // `strings.ts` AND in `messages.ts` could never be an offender — a silent
  // split across the layer seam, which is the exact bug class this PR removed
  // between the two screens. `stringLiterals` already ignores comments, so the
  // narrower exemption costs nothing.
  const tables: [string, string, [string, string][]][] = [
    ["strings", "components/strings.ts", tableSentences(strings)],
    ["messages", "lib/messages.ts", tableSentences(messages)],
  ];

  it("reads the parameterised keys, not just the plain ones", () => {
    // The floor that would have caught the original hole: `saveFailedLabel` is
    // a function, and both of its branches must be in the checked set.
    const strung = tableSentences(strings).map(([, text]) => text);
    expect(strung).toContain(strings.saveFailedLabel(false));
    expect(strung).toContain(strings.saveFailedLabel(true));
    expect(strung).toContain(strings.failuresMarker(1));
    // ...and an ASSEMBLED sentence is not, because no literal of it exists.
    expect(strung).not.toContain(strings.shareMissing(1));
  });

  for (const [name, owner, entries] of tables) {
    it(`${name} yields sentences to check`, () => {
      expect(entries.length).toBeGreaterThan(9);
    });

    it(`no ${name} sentence is written out a second time in src/`, () => {
      const byText = new Map(entries.map(([key, text]) => [text, key]));
      const offenders: string[] = [];
      for (const file of files) {
        if (file === owner) continue;
        for (const literal of stringLiterals(
          readFileSync(join(SRC, file), "utf8"),
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        )) {
          const key = byText.get(literal);
          // The words as well as the key: both `saveFailedLabel` branches
          // report as `strings.saveFailedLabel()`, so the key alone leaves a
          // later failure with nothing to debug from (George, #600 round 3).
          if (key)
            offenders.push(
              `${file}: ${name}.${key} = ${JSON.stringify(literal)}`
            );
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
