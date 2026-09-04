// Hand-written declaration for check-deploy.mjs's one pure export, so
// tests/check-deploy.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` or turning on allowJs project-wide.
export declare function compareDeployed(
  deployed: { version: string; sha: string },
  expected: { version: string; sha: string }
): { ok: boolean; shaMatches: boolean; versionMatches: boolean };
