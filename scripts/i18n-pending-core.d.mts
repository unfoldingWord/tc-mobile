// Hand-written declaration for i18n-pending-core.mjs's export, so
// tests/i18n-pending-core.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` or turning on allowJs project-wide (the same
// arrangement as check-deploy.d.mts).

export declare function rewritePending(
  previous: string,
  overrides: Readonly<Record<string, object>>,
  keys: readonly string[]
): string;
