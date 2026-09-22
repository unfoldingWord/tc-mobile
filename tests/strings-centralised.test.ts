import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
 *   - It is about the TABLES' sentences. A sentence no table holds is outside
 *     the set however plainly it is copy. The modules where that gap used to
 *     matter most are covered by the second gate below.
 */

const SRC = join(import.meta.dirname, "..", "src");

/** The two modules a table's own sentences are allowed to appear in. */
const TABLES = ["components/strings.ts", "lib/messages.ts"];

/** Under this length, or with no space in it, a value is a word, not a sentence. */
const SENTENCE_MIN = 12;

/**
 * The modules that CHOOSE copy without holding any.
 *
 * Each maps a domain value to words a table holds — a `SaveFailureKind` to a
 * headline, a `ShareError` to a menu line, an `EncoderHealth` to a notice — and
 * has no other kind of text in it. That makes a stronger claim testable here
 * than the gate above can make anywhere else: not merely that a table's
 * sentence is not repeated, but that these three files hold NO sentence at all,
 * which catches a brand-new one too. `recovery-copy.ts` held fourteen of its
 * own until #169 moved them into `strings.ts`.
 *
 * Their own discriminators (`"quota"`, `"cutAudio"`, `"chapter"`) are words
 * rather than sentences, and `SENTENCE_MIN` is what keeps them out of the net —
 * pinned below, since without it this gate would demand a union be "moved into
 * a table".
 */
const COPY_MAPPERS = [
  "components/encoder-notice.ts",
  "components/recovery-copy.ts",
  "components/share-error-copy.ts",
];

/** The sentence-shaped literals in `source` — the shape both gates look for. */
function heldSentences(source: string): string[] {
  return stringLiterals(source).filter(
    (text) => text.includes(" ") && text.length >= SENTENCE_MIN
  );
}

/**
 * The text of every string literal in `source`, comments skipped.
 *
 * A whole-file search cannot be trusted here, and AGENTS.md records the trap in
 * both directions: `touch-policy.test.ts` false-hits on the very prose that BANS
 * what it searches for, and round 3 of #529 had `share-progress.test.ts` slice a
 * comment instead of the rule it names. The docblocks in `use-recorder.ts` quote
 * "Could not finish this recording." to explain which exit chooses it —
 * accurately, and they should keep doing so. Reading literals rather than raw
 * text makes that immunity structural instead of a pattern to keep tuning.
 *
 * A template literal with holes yields nothing: its text is in fragments, so it
 * can never equal a whole sentence. A hole-free one yields its text. Division
 * and regex literals are not distinguished from a comment opener — outside a
 * literal, `/` only starts one when the next character is `/` or `*`, which no
 * regex in this tree begins with.
 */
export function stringLiterals(source: string): string[] {
  const found: string[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let text = "";
      let holed = false;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          // Only the escapes copy actually uses; anything else keeps its
          // literal character, which is enough for an equality test.
          const escaped = source[i + 1] ?? "";
          text += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
          i += 2;
          continue;
        }
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          holed = true;
          // Skip the hole, brace-counting so a nested object or template in it
          // does not end the scan early.
          let depth = 1;
          i += 2;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            i += 1;
          }
          continue;
        }
        text += source[i];
        i += 1;
      }
      i += 1;
      if (!holed) found.push(text);
      continue;
    }
    i += 1;
  }
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

/** The sentence-shaped values of a table, paired with the key each came from. */
function sentences(table: Record<string, unknown>): [string, string][] {
  return Object.entries(table).flatMap(([key, value]) =>
    typeof value === "string" &&
    value.includes(" ") &&
    value.length >= SENTENCE_MIN
      ? [[key, value] as [string, string]]
      : []
  );
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
    expect(found).not.toContain("Your  recording");
    expect(found).toContain("after");
  });

  it("does not read a URL inside a string as a comment opener", () => {
    const found = stringLiterals(
      'const u = "https://example.test/x";\nconst b = "kept";'
    );
    expect(found).toEqual(["https://example.test/x", "kept"]);
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

  const tables: [string, [string, string][]][] = [
    ["strings", sentences(strings)],
    ["messages", sentences(messages)],
  ];

  for (const [name, entries] of tables) {
    it(`${name} yields sentences to check`, () => {
      expect(entries.length).toBeGreaterThan(9);
    });

    it(`no ${name} sentence is written out a second time in src/`, () => {
      const byText = new Map(entries.map(([key, text]) => [text, key]));
      const offenders: string[] = [];
      for (const file of files) {
        if (TABLES.includes(file)) continue;
        for (const literal of stringLiterals(
          readFileSync(join(SRC, file), "utf8")
        )) {
          const key = byText.get(literal);
          if (key) offenders.push(`${file}: ${name}.${key}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("the copy mappers choose words without holding them", () => {
  it("names modules that are actually there", () => {
    // Renaming one of these away must not silently retire its gate.
    expect(sourceFiles()).toEqual(expect.arrayContaining(COPY_MAPPERS));
  });

  for (const file of COPY_MAPPERS) {
    it(`${file} holds no sentence of its own`, () => {
      expect(heldSentences(readFileSync(join(SRC, file), "utf8"))).toEqual([]);
    });
  }

  it("does not read a discriminator as a sentence", () => {
    // The legitimate state this gate has to stay green on: these modules are
    // built out of string unions, and every one of them is a word.
    expect(
      heldSentences('type S = "cutAudio" | "chapter" | "downgrade";')
    ).toEqual([]);
  });

  it("reads a sentence put back into one of them", () => {
    // The state it exists to catch, on a fixture rather than on the tree, so
    // the claim is checkable without editing a source file.
    expect(heldSentences('const t = "No room left on this phone.";')).toEqual([
      "No room left on this phone.",
    ]);
  });
});
