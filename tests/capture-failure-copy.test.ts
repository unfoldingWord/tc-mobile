import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { captureFailureText } from "@/components/capture-failure-copy";
import { strings } from "@/components/strings";
import type { CaptureFailure } from "@/lib/audio/capture-failure";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.resolve(root, rel), "utf8");

/**
 * Source text with its comments removed.
 *
 * No comment in `src/hooks` or `src/lib` carries one of these sentences today
 * — both layers explain the move in paraphrase, not by quoting the copy — so
 * this strip changes no result as written. It is here against the #529 trap
 * AGENTS.md records, where a comment naming the thing a test greps for
 * captured the test: the sentences below are exactly what a future docblock
 * would reach for to explain why a hook no longer says them, and the natural
 * repair for that false red is to weaken the pattern until it can no longer
 * catch a real leak in code. String literals are left alone — they are what
 * is hunted.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` file under `rel`, recursively. */
function sourcesUnder(rel: string): string[] {
  const dir = path.resolve(root, rel);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) return sourcesUnder(child);
    return /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

/**
 * The sentence each code shows, written down.
 *
 * A `Record` keyed by the union, so a fourth `CaptureFailure` member cannot be
 * added without this table failing to compile — the compile-time half of the
 * exhaustiveness `captureFailureText`'s `never` default enforces at the switch.
 *
 * These exact words are also what `docs/training/facilitator-runbook.md` §5
 * tells a facilitator to expect, which is why they are pinned in an assertion
 * rather than described in prose: the runbook and the app can now only drift
 * through a red test.
 */
const EXPECTED: Record<CaptureFailure, string> = {
  silence: "No sound was recorded. Try again.",
  undecodable: "Recording could not be decoded on this device.",
  unfinished: "Could not finish this recording.",
};

const CODES = Object.keys(EXPECTED) as CaptureFailure[];

describe("captureFailureText", () => {
  it("has a code to word", () => {
    // The non-emptiness floor AGENTS.md asks of anything that loops over a
    // derived collection: an EXPECTED gone empty would make every case below
    // pass by iterating nothing.
    expect(CODES.length).toBe(3);
  });

  it.each(CODES)("words %s from the table, not from a literal", (code) => {
    expect(captureFailureText(code)).toBe(EXPECTED[code]);
  });

  it("gives each code its own sentence", () => {
    // Two codes sharing a sentence would be a silent regression of the reason
    // `"unfinished"` exists: the engine's failure must not read as the
    // translator's silence.
    expect(new Set(CODES.map((c) => captureFailureText(c))).size).toBe(
      CODES.length
    );
  });

  it("says nothing for a superseded stop", () => {
    // Null is not "no failure" — it is a stop whose UI belongs to a newer
    // recording. Returning a sentence here would paint a Notice over the take
    // that superseded it.
    expect(captureFailureText(null)).toBeNull();
  });

  it("reads its words from the string table, not from its own literals", () => {
    // The point of the lane: the words are DATA, so a future `strings[locale]`
    // switches them by swapping the table. Comparing the RETURN value cannot
    // establish that — an inlined sentence and a table read are the same
    // string, so `toBe(strings.captureSilence)` passes either way. Only the
    // source shape can, so that is what is read (the same move
    // `share-outcome-glyph.test.ts` makes for the same reason).
    const mapper = stripComments(
      read("src/components/capture-failure-copy.ts")
    );
    expect(mapper).toContain("strings.captureSilence");
    expect(mapper).toContain("strings.captureUndecodable");
    expect(mapper).toContain("strings.captureUnfinished");
    for (const code of CODES) expect(mapper).not.toContain(EXPECTED[code]);
    // And the table's own values are the sentences, so the two halves meet:
    // the mapper reads these keys, and these keys hold these words.
    expect([
      strings.captureSilence,
      strings.captureUndecodable,
      strings.captureUnfinished,
    ]).toEqual(CODES.map((code) => EXPECTED[code]));
  });
});

describe("no layer below components mints this copy (#169)", () => {
  // The regression this lane closes: three producers each wrote their own
  // sentence in `hooks/`, two of them the SAME sentence in two files with
  // nothing tying them together, and `lib/` carried the prose through as a
  // bare `string`. Re-inlining any of them is what this sweep catches — and
  // it catches it wherever in those trees it lands, not only in the two files
  // this lane happened to edit.
  const files = [...sourcesUnder("src/hooks"), ...sourcesUnder("src/lib")];

  it("sweeps a tree that is actually there", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(CODES)("no hook or lib file writes the %s sentence", (code) => {
    const leaked = files.filter((rel) =>
      stripComments(read(rel)).includes(EXPECTED[code])
    );
    expect(leaked).toEqual([]);
  });
});
