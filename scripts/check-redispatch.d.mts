// Hand-written declaration for check-redispatch.mjs's exports, so
// tests/check-redispatch.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` (the same arrangement as check-deploy.d.mts).
import type { Lane } from "./redispatch-core.mjs";

export declare const REPO: string;

export interface RedispatchArgs {
  lane: Lane;
  sha: string;
  branch: "staging" | "main";
  known: number[] | null;
  /** The pre-upload guard (#1616): this run's id and attempt. */
  runId: number | null;
  attempt: number | null;
}

export declare function parseArgs(argv: string[]): RedispatchArgs;

/** Returns `gh`'s stdout for one argv; throws when `gh` fails. */
export type GhRunner = (args: string[]) => string;

export declare function gather(
  args: RedispatchArgs,
  gh?: GhRunner
): Record<string, unknown>;

export declare function main(
  argv: string[],
  deps?: { gh?: GhRunner; log?: (line: string) => void }
): number;
