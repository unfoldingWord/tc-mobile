import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

// fflate is used by Share Book and Share your work only, so it must reach the
// browser as its own chunk, loaded when a zip is first opened, and not sit in
// the entry chunk every launch pays for (#161). A static value import under
// src/ pulls it back in. The zip's behaviour is covered by
// tests/book-export*.test.ts and tests/library-export.test.ts.

const SRC = join(__dirname, "..", "src");
const BOOK = join(SRC, "lib", "export", "book.ts");

describe("fflate stays out of the entry chunk (#161)", () => {
  const code = stripComments(readFileSync(BOOK, "utf8"));

  it("lib/export/book.ts loads fflate with a dynamic import", () => {
    expect(code).toMatch(/await import\("fflate"\)/);
  });

  it("lib/export/book.ts imports fflate for types only", () => {
    const imports = [...code.matchAll(/^import\s[^;]*?from\s+"fflate";/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const match of imports) {
      expect(match[0]).toMatch(/^import type\b/);
    }
  });
});
