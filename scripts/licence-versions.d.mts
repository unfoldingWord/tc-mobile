// Hand-written declaration for licence-versions.mjs's exports, so the config
// files and tests type-check without turning on allowJs (the same arrangement
// as check-deploy.d.mts).
export declare function installedManifest(
  root: string,
  pkg: string
): { version?: string; license?: string } | null;

export declare function missingVersionReason(
  root: string,
  pkg: string
): string | null;

export declare function unversionedPackages(
  root: string,
  packages: Iterable<string>
): { pkg: string; reason: string }[];

export declare function noticeNameForUrl(
  url: string,
  base?: string
): string | null;

export declare function installedVersion(
  root: string,
  pkg: string
): string | undefined;

export declare function installedVersions(
  root: string,
  packages: Iterable<string>
): Record<string, string>;

export declare function noticeVersionTokens(text: string): string[];

export declare function expandNoticeVersions(
  text: string,
  versionOf: (pkg: string) => string | undefined,
  label?: string,
  reasonOf?: (pkg: string) => string | null
): string;
