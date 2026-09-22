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
 * The plural helper and the one alias it exists to make possible.
 *
 * The plurals in the table were inline `n === 1 ? … : …` ternaries that spelled
 * the count out on both arms. `menuOpenWithFailures` is what that shape costs: it
 * carried a byte-for-byte copy of `failuresMarker`'s wording, so tightening one
 * would have left the other alone. Pinned by equality rather than by a repeated
 * literal, exactly as `shareBookPartial` is in
 * `tests/share-book-partial-copy.test.ts`.
 *
 * What the equality catches is DIVERGENCE, not duplication: re-typing the words
 * at both sites passes this, because the two still agree on the day it is
 * written. It goes red on the next copy edit to either one, which is the moment
 * the duplicate actually costs something and the moment nobody is looking for
 * it. The source-level "one sentence, one place" half is the duplicate check
 * above.
 */
describe("counted plurals", () => {
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
    // gap — but a helper that answered "0 segment" would be wrong the first time
    // one of those gates changed, and the cost of pinning it now is one line.
    expect(strings.shareMissing(0)).toBe("0 segments could not be included.");
    expect(strings.failuresMarker(0)).toBe("0 problems recorded");
  });
});
