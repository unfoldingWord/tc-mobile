import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { blankCodeComments } from "./strip-code-comments";

/**
 * The clip-bytes seam gate (#1751, part of #1456).
 *
 * A clip's bytes live in the `clipData` store, and the phone holds the only
 * copy. Every read, write, existence probe and delete of them goes through
 * `src/lib/storage/clip-bytes.ts`, so a later backend (the card children of
 * #1456) changes one module rather than hunting call sites. This sweep keeps
 * that true: outside the seam and the schema (`db.ts`, which declares and
 * creates the store), no file in `src/` may name the store in code.
 *
 * Comments are blanked by parsing (`blankCodeComments`), not by pattern: the
 * sweep is open-ended over `src/`, and a `"https://…"` literal would make a
 * string-blind strip eat live code. A comment naming the store is prose, so it
 * is allowed; a template literal, an object key or a scope-list entry is code,
 * so it is not.
 *
 * Named residual: a source-reading gate cannot see a store name built at
 * runtime (`"clip" + "Data"`). Review is the only net for that shape.
 */

const SRC = path.resolve(__dirname, "../src");
const SEAM = path.join(SRC, "lib/storage/clip-bytes.ts");
const SCHEMA = path.join(SRC, "lib/storage/db.ts");
const ALLOWED = [SEAM, SCHEMA];
const STORE = /\bclipData\b/;

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** `file:line` of every line that names the store in code, comments blanked. */
function codeMentions(file: string): string[] {
  const code = blankCodeComments(readFileSync(file, "utf8"), file);
  return code
    .split("\n")
    .flatMap((line, i) =>
      STORE.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : []
    );
}

describe("clip-bytes seam (#1751)", () => {
  it("only the clip-bytes seam names the clipData store", () => {
    const files = sourcesUnder(SRC);
    // A floor, so the sweep cannot pass by reading nothing.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .filter((file) => !ALLOWED.includes(file))
      .flatMap(codeMentions);
    expect(offenders).toEqual([]);

    // And the two allowed files exist and do name it: the seam is what
    // serves the store, and the schema is what creates it.
    expect(existsSync(SEAM)).toBe(true);
    for (const allowed of ALLOWED) expect(files).toContain(allowed);
    for (const allowed of ALLOWED) {
      expect(codeMentions(allowed).length).toBeGreaterThan(0);
    }
  }, 30000);
});
