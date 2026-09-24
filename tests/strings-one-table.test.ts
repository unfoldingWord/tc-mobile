import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { strings } from "@/lib/strings";

/**
 * #169 — the string table is the only place a translator-facing sentence is
 * written down.
 *
 * The table always claimed to be that, and was not: it lived in `components/`,
 * the onion rule forbids `hooks/` from importing upward, so every sentence a
 * hook had to produce was a literal beside the code that raised it. Three of
 * them were then typed out a SECOND time further down `use-recorder.ts` —
 * "No sound was recorded. Try again." at the empty-seal exit and again in
 * `retryDecode`, "Recording could not be decoded on this device." likewise, and
 * "Could not finish this recording." in `use-recorder.ts` AND
 * `use-audio-session.ts`'s backstop. A copy edit to any one of them would have
 * left the others saying the old thing, on the screens a facilitator reads a
 * sentence off a phone to report it.
 *
 * Moving the table down to `lib/` removed the reason for those literals. This
 * is what stops them coming back.
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
 *   - The parameterised entries (the functions) are not enumerated at all —
 *     only the fixed strings are. `saveFailedDiscard`'s four labels are
 *     therefore covered by `tests/save-failed.test.ts` rendering them, not by
 *     this file.
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
 * Comments stripped, so the gate reads CODE and not prose about code — the same
 * treatment, and the same reason, as `recorder-stop-release-guards.test.ts`.
 * Several of this repo's comments quote the very sentences below in order to
 * explain them, and scoring those would make the gate fire on documentation.
 *
 * The strip can also cut a `//` that is inside a string literal. That can only
 * DELETE text, so it can hide a duplicate; it can never invent one. No sentence
 * in the table contains `//`.
 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

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
      const code = stripComments(readFileSync(file, "utf8"));
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

  it("every fixed sentence in app/ and hooks/ is one the table holds", () => {
    const stranded: string[] = [];
    for (const file of hookFiles) {
      const code = stripComments(readFileSync(file, "utf8"));
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
 * The count labels, and the one alias that stops two of them drifting.
 *
 * These were inline `n === 1 ? … : …` ternaries that spelled the count out on
 * both arms. They now go through `lib/plural.ts`, which selects a CLDR category
 * with `Intl.PluralRules` rather than asserting English's two forms — so what
 * is pinned below is the English OUTPUT, not the rule that produced it, and a
 * locale that adds `few`/`many` does not touch these expectations.
 *
 * `menuOpenWithFailures` is what the old shape cost: it carried a byte-for-byte
 * copy of `failuresMarker`'s wording, so tightening one would have left the
 * other alone. Pinned by equality rather than by a repeated literal, exactly as
 * `shareBookPartial` is in `tests/share-book-partial-copy.test.ts`.
 *
 * What the equality catches is DIVERGENCE, not duplication: re-typing the words
 * at both sites passes this, because the two still agree on the day it is
 * written. It goes red on the next copy edit to either one, which is the moment
 * the duplicate actually costs something and the moment nobody is looking for
 * it. The source-level "one sentence, one place" half is the duplicate check
 * above.
 */
describe("count labels", () => {
  it("says the same words as failuresMarker — one wording, not two that can drift", () => {
    expect(strings.menuOpenWithFailures(1)).toBe(
      `Open menu. ${strings.failuresMarker(1)}.`
    );
    expect(strings.menuOpenWithFailures(7)).toBe(
      `Open menu. ${strings.failuresMarker(7)}.`
    );
  });

  it("switches form at one, and nowhere else", () => {
    expect(strings.failuresMarker(1)).toBe("1 problem recorded");
    expect(strings.failuresMarker(2)).toBe("2 problems recorded");
    expect(strings.shareMissing(1)).toBe("1 segment could not be included.");
    expect(strings.shareMissing(2)).toBe("2 segments could not be included.");
    expect(strings.shareBookMissing(1)).toBe(
      "1 chapter could not be included."
    );
    expect(strings.shareBookMissing(2)).toBe(
      "2 chapters could not be included."
    );
    expect(strings.bookRow("Mark", 1, false)).toBe(
      "Mark, 1 chapter, collapsed"
    );
    expect(strings.bookRow("Mark", 3, true)).toBe("Mark, 3 chapters, expanded");
  });

  it("says zero in the plural form, not the singular", () => {
    // Nothing renders a zero today — `menuOpenWithFailures` replaces the plain
    // name only while the log is non-empty, and the share Notices only show on a
    // gap — but a table that answered "0 segment" would be wrong the first time
    // one of those gates changed, and the cost of pinning it now is one line.
    //
    // English puts zero in `other`, which is CLDR's rule and not a choice this
    // file makes. A locale with a `zero` category selects it and these two
    // expectations no longer describe that locale — which is the point of the
    // rule living in `lib/plural.ts` rather than here.
    expect(strings.shareMissing(0)).toBe("0 segments could not be included.");
    expect(strings.failuresMarker(0)).toBe("0 problems recorded");
  });
});
