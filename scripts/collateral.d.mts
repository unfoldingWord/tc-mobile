// Hand-written declaration for collateral.mjs's pure exports, so
// tests/collateral.test.ts type-checks without turning on allowJs
// project-wide. See scripts/check-commit-messages.d.mts.

export interface FileChange {
  path: string;
  added: string[];
}

export interface SurfaceResult {
  key: string;
  state: "touched" | "check" | "none";
  paths?: string[];
  why?: string;
}

export declare const RULES: Array<{ key: string }>;
export declare function parseDiff(text: string): FileChange[];
export declare function classify(changes: FileChange[]): SurfaceResult[];
export declare function formatReport(results: SurfaceResult[]): string;
