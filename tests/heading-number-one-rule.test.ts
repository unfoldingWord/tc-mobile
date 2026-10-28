import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { blankCodeComments } from "./strip-code-comments";

/**
 * One rule for the number in an unnamed chapter's title (#1272, the DRI's
 * Q1 (b)): `headingNumber` in `src/lib/chapter-slot.ts`. #1744's review found
 * Share Book's namer and the storage-pressure export namer each writing the
 * rule out again as `templateNumber ?? n`. Same answer today, but the next
 * change to the rule would update one copy and miss the other (#1747).
 *
 * This sweep fails on any `templateNumber ?? <x>` in `src/` outside
 * `chapter-slot.ts`, other than `?? null`, which only carries a missing value
 * along and picks no number. Comments are blanked by parsing first
 * (`blankCodeComments`), so prose naming the rule neither trips the sweep nor
 * hides a live copy from it.
 */

const SRC = join(__dirname, "..", "src");
const RULE_HOME = join(SRC, "lib", "chapter-slot.ts");
/** A hand-rolled pick between a template's number and something else. */
const HAND_ROLLED = /templateNumber\s*\?\?(?!\s*null\b)/gi;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function handRolled(source: string, fileName: string): number[] {
  const code = blankCodeComments(source, fileName);
  return [...code.matchAll(HAND_ROLLED)].map(
    (m) => code.slice(0, m.index).split("\n").length
  );
}

describe("headingNumber is the one rule for a chapter title's number (#1747)", () => {
  it("catches a hand-rolled pick and leaves `?? null` and comments alone", () => {
    expect(handRolled("const a = templateNumber ?? n;\n", "probe.ts")).toEqual([
      1,
    ]);
    expect(
      handRolled("x(\n  chapter.templateNumber ?? chapter.number\n);\n", "p.ts")
    ).toEqual([2]);
    expect(
      handRolled("const b = view?.chapterTemplateNumber ?? slot;\n", "p.ts")
    ).toEqual([1]);
    expect(
      handRolled("const c = chapter?.templateNumber ?? null;\n", "p.ts")
    ).toEqual([]);
    expect(
      handRolled("// templateNumber ?? n\nconst d = 1;\n", "p.ts")
    ).toEqual([]);
  });

  it("no file in src/ other than chapter-slot.ts writes the rule out again", () => {
    const files = sourceFiles(SRC).filter((f) => f !== RULE_HOME);
    // A floor, so a wrong root cannot pass by reading nothing.
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((file) =>
      handRolled(readFileSync(file, "utf8"), file).map(
        (line) => `${relative(SRC, file)}:${line}`
      )
    );
    expect(hits).toEqual([]);
  });
});
