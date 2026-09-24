// Hand-written declaration for check-commit-messages.mjs's pure exports, so
// tests/check-commit-messages.test.ts type-checks without pulling scripts/
// into tsconfig.app.json's `include` or turning on allowJs project-wide.
// See scripts/check-deploy.d.mts for the same pattern.

export declare function hasNonBlankBody(raw: string): {
  subject: string;
  hasBody: boolean;
};

export declare function isMergeSubject(subject: string): boolean;

export declare function checkMessage(
  raw: string,
  options?: { allowMergeSubject?: boolean }
): {
  ok: boolean;
  subject: string;
  reason?: string;
};

export declare function parseLogRecords(
  stdout: string
): Array<{ sha: string; body: string }>;

export declare function checkRange(
  range: string,
  options?: { runGit?: (args: string[]) => string }
): {
  results: Array<{
    sha: string;
    ok: boolean;
    subject: string;
    reason?: string;
  }>;
  failures: Array<{
    sha: string;
    ok: boolean;
    subject: string;
    reason?: string;
  }>;
};

export declare function parseArgs(
  argv: string[]
): { mode: "range"; range: string } | { mode: "file"; filePath: string };

export declare function isMainEntry(
  moduleUrl: string,
  argvPath: string | undefined
): boolean;
