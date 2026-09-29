import ts from "typescript";

/**
 * `source` printed back through the TypeScript printer with every comment
 * removed: `//`, `/* *\/`, a trailing `//` after live code, and JSX `{/* *\/}`
 * (#822). Unlike `stripComments` in `./support`, it parses first, so a `//` or
 * `/*` inside a string, a regex or JSX text stays code — `vite.config.ts`'s
 * `"**\/*.{js,…}"` precache glob is one, and `stripComments`' block pattern
 * would eat live config from there to the next `*\/`.
 *
 * The output is re-laid-out: string, regex and template text is kept as
 * written, but whitespace, indentation and line breaks are the printer's. Match
 * tokens, not layout, and never use an index from the result against the
 * original text — for that, `blankComments` in `./support` is the reader.
 *
 * Its own module, not `./support`, so the suites that import `./support` do not
 * each load the TypeScript compiler.
 */
export function stripCodeComments(source: string, fileName: string): string {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  return ts.createPrinter({ removeComments: true }).printFile(file);
}
