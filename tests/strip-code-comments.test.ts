import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { blankCodeComments, stripCodeComments } from "./strip-code-comments";

/** Synthetic probes only: the three comment forms #822 found used against a
 *  source pin, and the string case that rules out `stripComments` for
 *  `vite.config.ts`. */
describe("stripCodeComments (#822)", () => {
  it("removes a line comment, a block comment and a trailing comment", () => {
    const out = stripCodeComments(
      [
        "// polyfill: false",
        "/* globPatterns: [] */",
        "const a = 1; // closeGlobalMenu();",
      ].join("\n"),
      "probe.ts"
    );
    expect(out).toContain("const a = 1;");
    expect(out).not.toMatch(/polyfill|globPatterns|closeGlobalMenu/);
  });

  it("removes a JSX comment in a .tsx file", () => {
    const out = stripCodeComments(
      'const x = <g>{/* <circle cx="6.5" /> */}<path d="M1" /></g>;',
      "probe.tsx"
    );
    expect(out).toContain('<path d="M1"/>');
    expect(out).not.toContain("circle");
  });

  it("keeps a `/*` or `//` inside a string or a regex as code", () => {
    const out = stripCodeComments(
      [
        'const glob = ["**/*.{js,txt}"];',
        'const url = "https://example.org";',
        "const deny = [/\\.txt(\\?|$)/];",
        "const after = 2;",
        "/* a later block comment */",
      ].join("\n"),
      "probe.ts"
    );
    expect(out).toContain('"**/*.{js,txt}"');
    expect(out).toContain('"https://example.org"');
    expect(out).toContain("/\\.txt(\\?|$)/");
    // `stripComments` would open a comment at the glob's `/*` and close it at
    // the later `*/`, taking this live line with it.
    expect(out).toContain("const after = 2;");
    expect(out).not.toContain("later block comment");
  });
});

/** The index-preserving half. Probes for each comment form and each look-alike
 *  that is not one, then the whole of `src/` against the printer. */
describe("blankCodeComments (#822)", () => {
  it("blanks each comment form in place and keeps every index", () => {
    const source = [
      "// polyfill: false",
      "/* globPatterns: [] */ const a = 1; // closeGlobalMenu();",
      "/** JSDoc, {@link a} // see */ const b = 2;",
      'const x = <g aria-x={/* aria-label="decoy" */ 1}>{/* hidden */}</g>;',
    ].join("\n");
    const out = blankCodeComments(source, "probe.tsx");
    expect(out).toHaveLength(source.length);
    expect(out.split("\n").length).toBe(source.split("\n").length);
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
    expect(out).toContain("<g aria-x={");
    expect(out).not.toMatch(
      /polyfill|globPatterns|closeGlobalMenu|JSDoc|decoy|hidden/
    );
  });

  it("keeps a `//` or `/*` inside a string, a template, a regex or JSX text", () => {
    const source = [
      'const url = "https://example.org"; const kept = 1;',
      "const glob = `**/*.{js}`; const alsoKept = 2;",
      "const re = /\\/\\//; const regexKept = 3;",
      "const t = <p>// shown on screen</p>;",
    ].join("\n");
    // The string-blind blank loses all four lines' tails; this one keeps them.
    expect(blankCodeComments(source, "probe.tsx")).toBe(source);
  });

  // One case per top-level slice of src/ (each directory, plus the files
  // directly under src/), so no single test carries the whole tree (#1382).
  const root = path.resolve(import.meta.dirname, "..", "src");
  const loose = "(files directly under src/)";
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const filesIn = (slice: string): string[] =>
    slice === loose
      ? readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
          .map((e) => path.join(root, e.name))
      : sourcesUnder(path.join(root, slice));

  // A directory with no .ts/.tsx (src/data holds JSON) has no case to run.
  const slices = [...dirs, loose].filter((s) => filesIn(s).length > 0);

  it("the per-slice sweep below still covers the whole tree", () => {
    const covered = slices.flatMap(filesIn);
    expect([...covered].sort()).toEqual([...sourcesUnder(root)].sort());
    expect(covered.length).toBeGreaterThan(100);
  });

  it.each(slices)(
    "agrees with the printer on every file in src/%s",
    (slice) => {
      // Printed WITH comments, the blanked text must equal the original printed
      // WITHOUT them: nothing but comments was blanked, and no comment is left.
      const files = filesIn(slice);
      expect(files.length).toBeGreaterThan(0);
      const print = (text: string, name: string, removeComments: boolean) =>
        ts
          .createPrinter({ removeComments })
          .printFile(
            ts.createSourceFile(
              name,
              text,
              ts.ScriptTarget.Latest,
              true,
              name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
            )
          );
      const disagree = files.filter((file) => {
        const text = readFileSync(file, "utf8");
        const blanked = blankCodeComments(text, file);
        return (
          blanked.length !== text.length ||
          print(blanked, file, false) !== print(text, file, true)
        );
      });
      expect(disagree).toEqual([]);
    },
    15000
  );
});

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
