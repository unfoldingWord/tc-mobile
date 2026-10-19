// Hand-written declaration for check-pr-body.mjs's pure exports, so
// tests/check-pr-body.test.ts type-checks without turning on allowJs
// project-wide. See scripts/check-commit-messages.d.mts.

export interface PrFields {
  body: string | null;
  title: string;
  author: string;
  baseRef: string;
  headRef: string;
  headSha?: string;
}

export declare const PROD_LINE_CAP: number;
export declare const REQUIRED_SECTIONS: string[];
export declare const COLLATERAL_SURFACES: string[];
export declare const FIELD_LABELS: string[];

export declare function sanitize(raw: string | null): string;
export declare function parseSections(text: string): Map<string, string>;
export declare function isAnswer(value: string | null): boolean;
export declare function checkBody(raw: string | null): string[];
export declare function isExcludedFromSize(path: string): boolean;
export declare function parseNumstat(
  out: string
): Array<{ added: number; deleted: number; path: string }>;
export declare function countProdLines(
  entries: Array<{ added: number; deleted: number; path: string }>
): number;
export declare function exemption(
  pr: Partial<Pick<PrFields, "author" | "baseRef" | "title">>
): string | null;
export declare function evaluate(
  pr: PrFields,
  options?: { prodLines?: number | null }
): { ok: boolean; exempt: string | null; missing: string[] };
export declare function prFromEvent(payload: unknown): PrFields & {
  body: string;
  headSha: string;
};
export declare function fetchPr(
  number: string,
  runGh?: (args: string[]) => string
): PrFields & { body: string };
export declare function parseArgs(argv: string[]): {
  source: "event" | "pr" | "body-file";
  value: string;
  range: string | null;
  meta: { title: string; author: string; baseRef: string; headRef: string };
};
