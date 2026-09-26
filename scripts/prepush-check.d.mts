// Hand-written declaration for prepush-check.mjs's exports, so
// tests/prepush-check.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include`. Same pattern as check-commit-messages.d.mts.

export declare function findNegatedClosures(
  message: string
): Array<{ text: string; issue: string }>;

export declare function satisfies(
  version: string,
  range: unknown
): boolean | null;

export declare function rangeMinimum(range: unknown): string | null;

export interface Manifest {
  version?: string;
  engines?: { node?: string };
}

export declare function checkEngines(
  floor: string,
  names: string[],
  readManifest: (name: string) => Manifest | null
): {
  failures: Array<{ name: string; version?: string; range: string }>;
  notes: string[];
};

export interface PackageJson {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PackageLock {
  packages?: Record<string, { version?: string }>;
}

export declare function changedDependencies(
  basePkg: PackageJson | null,
  headPkg: PackageJson | null,
  baseLock: PackageLock | null,
  headLock: PackageLock | null
): string[];

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export declare function parseAddedLines(diff: string): AddedLine[];

export declare function isTestFile(file: string): boolean;

export declare function scanAddedLines(
  added: AddedLine[],
  readFile: (file: string) => string | null
): Array<{ rule: "c" | "d" | "e"; where: string; snippet: string }>;

export declare function run(options?: {
  git?: (args: string[]) => string;
  log?: (line: string) => void;
}): number;

export declare function isMainEntry(
  moduleUrl: string,
  argvPath: string | undefined
): boolean;
