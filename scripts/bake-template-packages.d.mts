// Hand-written declaration for bake-template-packages.mjs's exports, so the
// config files and tests type-check without turning on allowJs (the same
// arrangement as licence-versions.d.mts).

export interface BakedPackage {
  id: string;
  version: string;
  provisional: boolean;
  pkg: unknown;
  titles: unknown[];
}

export interface BakeResult {
  baked: BakedPackage[];
  leftOut: { id: string; why: string }[];
}

export declare const DEFAULT_MANIFEST: string;
export declare const PROVISIONAL_FLAG: string;

export declare class BakeRefusal extends Error {}

export declare function bakeTemplatePackages(options?: {
  manifest?: string;
  env?: Record<string, string | undefined>;
}): BakeResult;

export declare function describeBake(result: BakeResult): string[];
