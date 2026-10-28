// Hand-written declaration for build-language-list.mjs's exports, so the tests
// type-check without turning on allowJs (the same arrangement as
// licence-versions.d.mts).
export declare const LANGTAGS_VERSION: string;

export type LanguageRow = [string, string] | [string, string, string];

export interface LanguageListFile {
  source: string;
  languages: LanguageRow[];
}

export declare function buildLanguageList(
  rows: readonly unknown[],
  version?: string
): LanguageListFile;

export declare function serialiseLanguageList(list: LanguageListFile): string;
