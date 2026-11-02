import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripCodeComments } from "./strip-code-comments";
import { stripCssComments } from "./support";

/**
 * The `o4` naming is retired (#954, R8): O4 is the only look, so a class,
 * a file or a component that still carries the prefix names a variant that no
 * longer exists. This reads `src/`, `tests/` and `e2e/` with comments
 * stripped (a comment that cites the O4 design record is allowed; a name
 * that code or a selector uses is not) and lists every occurrence of a
 * banned form.
 *
 * `NOT_YET` is the forms a later slice of #954 still renames. Each slice
 * deletes its entries; the last one deletes the list.
 */
const ROOT = path.resolve(import.meta.dirname, "..");

/** Forms already renamed: banned everywhere. */
const BANNED: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ["o4-err* class", /\bo4-err\b|\bo4-err-/],
  ["o4-storage* class", /\bo4-storage\b|\bo4-storage-/],
  ["o4-tile* class", /\bo4-tiles?\b|\bo4-tiles?-/],
  ["o4-menu-* class", /\bo4-menu-/],
  ["o4-tile-look / o4-tile-menu module", /o4-tile-(look|menu)/],
];

/** Forms a later slice renames (PRs 8 and 9 of #954). Banned from nowhere yet. */
const NOT_YET: readonly string[] = [
  "o4-crumb*, o4-sheet-*, o4-head-pen, o4-square, o4-transport, o4-pill",
  "O4Crumbs, O4CrumbLink, O4SheetHead, O4BookHead, O4CoverPick, O4BookDeleteAsk",
  "share-o4-*, ShareO4View, data-o4-look, O4Circle, O4Chips, O4ChapterFace",
  "--o4-* custom properties, recorder-o4, share-o4-view, o4-controls files",
];

const SKIP = new Set(["node_modules", ".git", "dist", "dist-e2e"]);
const SELF = path.join("tests", "no-o4-naming.test.ts");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function sources(): string[] {
  const all: string[] = [];
  for (const top of ["src", "tests", "e2e"]) walk(path.join(ROOT, top), all);
  return all;
}

function codeOf(file: string): string {
  const text = readFileSync(file, "utf8");
  if (/\.css$/.test(file)) return stripCssComments(text);
  if (/\.(ts|tsx|mts)$/.test(file)) return stripCodeComments(text, file);
  return text;
}

describe("the o4 naming is retired", () => {
  const files = sources();

  it("reads a real tree", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  for (const [label, pattern] of BANNED) {
    it(`no ${label} remains in src, tests or e2e`, () => {
      const hits: string[] = [];
      for (const file of files) {
        const rel = path.relative(ROOT, file);
        if (rel === SELF) continue;
        if (pattern.test(path.basename(file))) hits.push(`${rel} (file name)`);
        const lines = codeOf(file).split("\n");
        lines.forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${rel}:${i + 1}`);
        });
      }
      expect(hits).toEqual([]);
    });
  }

  it("names the forms a later slice still owns", () => {
    expect(NOT_YET.length).toBeGreaterThan(0);
  });
});
