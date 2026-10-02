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

/**
 * `source` with every comment overwritten by spaces (newlines kept), found by
 * parsing rather than by pattern: the index-preserving counterpart of
 * `stripCodeComments`, for a sweep that reports `file:line` from a match
 * (#822). `blankComments` in `./support` does the same job string-blind, so a
 * `"https://…"` literal blanks live code from its `//` to the end of the line.
 * That is safe only where the caller has checked every file it reads, which an
 * open-ended sweep over `src/` cannot do.
 *
 * Every comment is trivia in front of some token, so the walk reads the
 * comment ranges at each token's full start: the trailing ones (a comment
 * after code on the same line, which the leading scan skips) and the leading
 * ones. Tokens only, because a wrapper such as a JSX children list starts
 * where its first JSX text does. It skips JSX text, whose `//` is text on
 * screen and not a comment, and JSDoc nodes, whose children start inside the
 * comment being blanked.
 */
export function blankCodeComments(source: string, fileName: string): string {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  const ranges = new Map<number, number>();
  const visit = (node: ts.Node): void => {
    if (
      node.kind === ts.SyntaxKind.JsxText ||
      (node.kind >= ts.SyntaxKind.FirstJSDocNode &&
        node.kind <= ts.SyntaxKind.LastJSDocNode)
    ) {
      return;
    }
    const children = node.getChildren(file);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    for (const range of [
      ...(ts.getTrailingCommentRanges(source, node.pos) ?? []),
      ...(ts.getLeadingCommentRanges(source, node.pos) ?? []),
    ]) {
      ranges.set(range.pos, range.end);
    }
  };
  visit(file);

  let out = "";
  let at = 0;
  for (const [pos, end] of [...ranges].sort(([a], [b]) => a - b)) {
    // Only a walk that scanned from inside a comment finds one that starts
    // before the last one ended, and then its ranges cannot be trusted.
    if (pos < at) {
      throw new Error(`blankCodeComments: overlapping comments at ${pos}`);
    }
    out +=
      source.slice(at, pos) + source.slice(pos, end).replace(/[^\n]/g, " ");
    at = end;
  }
  return out + source.slice(at);
}
