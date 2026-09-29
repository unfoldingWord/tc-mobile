import { describe, expect, it } from "vitest";

import { stripCodeComments } from "./strip-code-comments";

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
