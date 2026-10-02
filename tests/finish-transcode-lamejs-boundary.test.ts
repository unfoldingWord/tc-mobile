import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The main thread must never import the LGPL encoder (#1167 review, Frank
 * P2 — `finish-transcode.ts` importing `lib/audio/mp3.ts`, which statically
 * imports `Mp3Encoder` from `@breezystack/lamejs`, risked putting that
 * encoder back in the main bundle against ADR 0009 §1). `lib/audio/mp3.ts`
 * stays the encoder's only home; `lib/audio/mp3-size.ts` holds the pure size
 * arithmetic a main-thread caller needs and carries no lamejs import, so
 * `hooks/finish-transcode.ts` (loaded from `App.tsx`, not the worker) reaches
 * only that.
 *
 * A source-level check, not a bundler check: it is a property of what the
 * files import, true regardless of what a future Rollup version does with
 * dead-code elimination — the property `dist-css.test.ts`'s sibling for JS
 * (a built-bundle grep) would only catch AFTER the fact.
 *
 * The import list comes from TypeScript's own pre-processor, not a regex over
 * the text (#822). It skips comments and strings, so a commented-out
 * `from "@/lib/audio/mp3-size"` cannot stand in for a live import that is
 * gone, and `mp3-size.ts`'s docblock can name lamejs in prose. It also sees
 * `export … from`, `import()` and `require()`. Each specifier is resolved to a
 * `src/` path before it is compared, so `"../lib/audio/mp3"` is the same
 * module as `"@/lib/audio/mp3"` — a regex on the aliased spelling alone
 * passed with the encoder imported by its relative path.
 */

const REPO = join(import.meta.dirname, "..");

/** Every module `src/<file>` imports, as a repo-relative path without its
 *  extension for a `src/` module, or the bare specifier for a package. */
function importsOf(file: string): string[] {
  const abs = join(REPO, "src", file);
  const { importedFiles } = ts.preProcessFile(
    readFileSync(abs, "utf8"),
    true,
    true
  );
  return importedFiles.map(({ fileName: spec }) => {
    const target = spec.startsWith("@/")
      ? join(REPO, "src", spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(abs), spec)
        : undefined;
    return target === undefined
      ? spec
      : relative(REPO, target)
          .split("\\")
          .join("/")
          .replace(/\.(tsx?|jsx?)$/, "");
  });
}

describe("finish-transcode.ts never reaches lamejs (#1167)", () => {
  const imports = importsOf("hooks/finish-transcode.ts");

  it("reads a non-empty import list", () => {
    // The floor under the two checks below: an empty list would pass the
    // negated one on nothing.
    expect(imports.length).toBeGreaterThan(5);
  });

  it("does not import lib/audio/mp3 (the encoder-carrying module)", () => {
    expect(imports).not.toContain("src/lib/audio/mp3");
    expect(imports).not.toContain("@breezystack/lamejs");
  });

  it("imports its bitrate/size helpers from lib/audio/mp3-size instead", () => {
    expect(imports).toContain("src/lib/audio/mp3-size");
  });
});

describe("lib/audio/mp3-size.ts carries no lamejs import (#1167)", () => {
  it("does not import @breezystack/lamejs, or the module that does", () => {
    // Imports, not words — this module's own docblock names lamejs and
    // `Mp3Encoder` in prose, correctly, to explain why it exists and why the
    // size estimate is approximate. A prose mention is not a bundle risk; an
    // import binding is.
    const imports = importsOf("lib/audio/mp3-size.ts");
    expect(imports).not.toContain("@breezystack/lamejs");
    expect(imports).not.toContain("src/lib/audio/mp3");
  });
});
