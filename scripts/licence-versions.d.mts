// Hand-written declaration for licence-versions.mjs's exports, so the config
// files and tests type-check without turning on allowJs (the same arrangement
// as check-deploy.d.mts).
export declare function installedManifest(
  root: string,
  pkg: string
): { version?: string; license?: string } | null;

export declare function installedVersions(
  root: string,
  packages: Iterable<string>
): Record<string, string>;

export declare function noticeVersionTokens(text: string): string[];

export declare function expandNoticeVersions(
  text: string,
  versionOf: (pkg: string) => string | undefined,
  label?: string
): string;
