import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { NOTHING_FAILED_TONE } from "@/components/notice-tone";
import { shareOutcomeGlyph } from "@/components/share-outcome-glyph";

/**
 * The three Notices that say "nothing failed" move together (#147).
 *
 * #147 asks for an AUDIT of every default-tone `Notice` — "rather than fixing
 * one and leaving the rest to drift" — and the audit found three call sites
 * whose answer to "is this genuinely a failure?" is no, all three riding the
 * `alert` tone. Whether they should be `info` is Tim's call and is still open.
 * What this pins is the weaker property that does not need his answer: the
 * three read ONE constant, so the question can be answered in one place and
 * cannot be half-answered.
 *
 * WHY THE SOURCE READS. `NOTHING_FAILED_TONE`'s value is `alert`, which is what
 * all three already wore, so no runtime assertion can tell a site that reads the
 * constant from one that hardcodes the same string — the drift this exists to
 * catch is invisible until the day the constant changes, which is exactly the
 * day it is too late. The wiring is the property, so the wiring is what is read.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is not incidental: this repo has already
 * had a stylesheet comment capture a test that searched the file whole
 * (`share-progress.test.ts`, #529 round 3), and `notice-tone.ts` and
 * `share-outcome-glyph.ts` both now NAME this constant in prose in order to
 * explain it. A reader that matched the bare identifier would pass on the
 * docblock alone. Each assertion below matches a code shape — the constant in
 * the position a tone is actually passed — not the name.
 */

/** Source with block comments and whole-line `//` comments removed. */
function code(path: string): string {
  const raw = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  // The floor #529 round 3 is the standing reason for: an assertion that loops
  // over nothing, or matches against an empty string, reports success. A
  // stripper that ate the file would otherwise fail every `not.toMatch` silently
  // and pass every one of them.
  expect(stripped.length, `${path} stripped to nothing`).toBeGreaterThan(1000);
  return stripped;
}

describe("the not-a-failure Notices read one tone (#147)", () => {
  it("the share outcome table's `nothing` takes its tone from the constant", () => {
    // `nothing` is "there is no audio yet", not "the share failed" — #178 gave
    // it its own mark for that reason and deliberately left the tone alone.
    expect(code("src/components/share-outcome-glyph.ts")).toMatch(
      /case "nothing":\s*return \{[^}]*tone: NOTHING_FAILED_TONE[^}]*\};/
    );
  });

  it("the paused-preview Notice takes its tone from the constant", () => {
    // The take is intact; only the preview decode failed (#101).
    expect(code("src/components/recorder.tsx")).toMatch(
      /<Notice tone=\{NOTHING_FAILED_TONE\}>\s*\{strings\.previewUnavailable\}\s*<\/Notice>/
    );
  });

  it("BOTH stale-chapter Notices take their tone from the constant", () => {
    // Two call sites, one screen: the list body and the chapter menu. The count
    // is the assertion — fixing one and leaving the other is the drift #147
    // names, and a bare `toMatch` would go green on either alone.
    const hits =
      code("src/components/segments-screen.tsx").match(
        /<Notice tone=\{NOTHING_FAILED_TONE\}>\s*\{strings\.staleChapter\}\s*<\/Notice>/g
      ) ?? [];
    expect(hits).toHaveLength(2);
  });

  it("no member of the class hardcodes the tone it happens to share today", () => {
    // The failure mode this whole file exists for: a later tidy-up writes
    // `tone="alert"` back beside one of the three, every test stays green, and
    // the day #147 is answered only two of them move.
    for (const path of [
      "src/components/recorder.tsx",
      "src/components/segments-screen.tsx",
    ]) {
      const source = code(path);
      expect(
        /<Notice tone="alert">\s*\{strings\.(previewUnavailable|staleChapter)\}/.test(
          source
        ),
        `${path} hardcodes a tone the constant owns`
      ).toBe(false);
    }
  });

  it("the constant is the tone the share table actually hands the screen", () => {
    // Survives a re-tone: it says the two agree, not what they say. The literal
    // `alert` is pinned by `share-outcome-glyph.test.ts`, which is commented as
    // the place to change when #147 is answered.
    expect(shareOutcomeGlyph("nothing").tone).toBe(NOTHING_FAILED_TONE);
  });
});
