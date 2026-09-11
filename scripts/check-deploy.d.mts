// Hand-written declaration for check-deploy.mjs's pure exports, so
// tests/check-deploy.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` or turning on allowJs project-wide.
export declare function compareDeployed(
  deployed: { version: string; sha: string },
  expected: { version: string; sha: string }
): { ok: boolean; shaMatches: boolean; versionMatches: boolean };

export declare function normalizeSha(
  sha: string | undefined
): string | undefined;

export declare function isMainEntry(
  moduleUrl: string,
  argvPath: string | undefined
): boolean;

export declare function remoteRefForOrigin(origin: string): string | undefined;

export declare function resolveExpectedSha(
  origin: string,
  options?: {
    runGit?: (cmd: string) => string;
    warn?: (message: string) => void;
  }
): string;

export declare function resolveExpectedVersion(
  origin: string,
  options?: {
    runGit?: (cmd: string) => string;
    warn?: (message: string) => void;
  }
): string;

export declare function resolveExpected(
  origin: string,
  parsed?: { version?: string | undefined; sha?: string | undefined },
  deps?: {
    runGit?: (cmd: string) => string;
    warn?: (message: string) => void;
  }
): { version: string; sha: string };

export declare function describeFetchFailure(
  err: { name?: string; message: string },
  context?: { timeoutMs?: number; url?: string }
): string;

export declare function isJsonContentType(
  contentType: string | null | undefined
): boolean;

export declare class SpaFallbackError extends Error {}

export declare function parseArgs(argv: string[]): {
  origin: string;
  version: string | undefined;
  sha: string | undefined;
};
