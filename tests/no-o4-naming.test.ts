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
 */
const ROOT = path.resolve(import.meta.dirname, "..");

/** Forms already renamed: banned everywhere. */
const BANNED: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ["o4-err* class", /\bo4-err\b|\bo4-err-/],
  ["o4-storage* class", /\bo4-storage\b|\bo4-storage-/],
  ["o4-tile* class", /\bo4-tiles?\b|\bo4-tiles?-/],
  ["o4-menu-* class", /\bo4-menu-/],
  ["o4-tile-look / o4-tile-menu module", /o4-tile-(look|menu)/],
  ["--o4-crumb-shape property", /--o4-crumb-shape/],
  ["o4-crumb* class", /\bo4-crumbs?\b|\bo4-crumbs?-/],
  ["o4-sheet-* class", /\bo4-sheet-/],
  [
    "o4-head-pen / o4-square / o4-transport / o4-pill class",
    /\bo4-(head-pen|square|transport|pill)\b/,
  ],
  [
    "O4 crumb, sheet-head and book-menu components",
    /\bO4(Crumbs|CrumbLink|SheetHead|BookHead|CoverPick|BookDeleteAsk)/,
  ],
  [
    "o4-book-menu / o4-book-delete-ask / o4-controls module",
    /o4-(book-menu|book-delete-ask|controls)\b/,
  ],
  ["share-o4-* class", /\bshare-o4-/],
  ["ShareO4View / shareO4View", /\b[Ss]hareO4View\b/],
  ["data-o4-look attribute", /\bdata-o4-look\b/],
  ["O4 share and chapter-face components", /\bO4(Circle|Chips|ChapterFace)\b/],
  ["--o4-* custom property", /--o4-/],
  ["recorder-o4 / share-o4-view module", /\b(recorder-o4|share-o4-view)\b/],
  // The last forms: the share panel's `o4` prop (or a local named for it), and
  // any other `o4-` name a stylesheet or a module path still carries (a CSS
  // counter, a test helper named for the look).
  ["o4 prop or local", /\bo4\s*[=:,}]/],
  ["o4- name", /\bo4-[a-z]/],
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

  it("no file in src, tests or e2e is named for o4", () => {
    const named = files
      .map((file) => path.relative(ROOT, file))
      .filter((rel) => rel !== SELF && /o4/i.test(path.basename(rel)));
    expect(named).toEqual([]);
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
});
