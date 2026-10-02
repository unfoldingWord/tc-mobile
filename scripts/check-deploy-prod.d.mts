// Hand-written declaration for check-deploy-prod.mjs's exports, so
// tests/check-deploy-prod.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` or turning on allowJs project-wide (the same
// arrangement as check-deploy.d.mts).
export declare const PROD_ORIGINS: readonly string[];

export declare function prodCheckArgv(
  origin: string,
  extra: string[]
): string[];

export declare function runProdChecks(
  extra: string[],
  deps?: {
    spawn?: (argv: string[]) => number | null;
    log?: (message: string) => void;
  }
): number;
