// Hand-written declaration for redispatch-core.mjs's exports, so
// tests/redispatch-core.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` or turning on allowJs project-wide (the same
// arrangement as check-deploy.d.mts).

export type Lane = "apk" | "play" | "testflight";
export type Token = "built" | "not built" | "started" | "unknown";

/** A row from `gh run list --json databaseId,status,headSha,headBranch`. */
export interface RunRow {
  databaseId: number;
  status: string;
  headSha?: string;
  headBranch?: string;
  [key: string]: unknown;
}

/** `gh run view --json jobs`, as much of it as the core reads. */
export interface RunView {
  jobs?: Array<{
    name?: string;
    conclusion?: string | null;
    steps?: Array<{
      name?: string;
      status?: string;
      conclusion?: string | null;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
}

/** The artifacts API response for one run. */
export interface ArtifactList {
  total_count?: number;
  artifacts?: Array<{ name: string; [key: string]: unknown }>;
}

export interface Judgement {
  token: Token;
  reason: string;
  fatal?: boolean;
}

export declare const LIST_LIMIT: number;
export declare const OPEN_STATUSES: readonly string[];
export declare const LANES: Record<
  Lane,
  { workflow: string; job: string; step: string }
>;
export declare const ANDROID_LANES: readonly Lane[];

export declare function versionCore(version: unknown): string;

export declare function classifyRun(
  lane: Lane,
  run: RunRow,
  view: RunView | undefined,
  artifacts: ArtifactList | undefined
): Judgement;

export interface DecideInput {
  lane: Lane;
  sha: string;
  branch: "staging" | "main";
  laneRuns: RunRow[] | unknown;
  openRuns?: Record<string, RunRow[] | unknown>;
  prodRuns?: Partial<Record<Lane, RunRow[] | unknown>>;
  views: Record<number, RunView | undefined>;
  artifacts: Record<number, ArtifactList | undefined>;
  versions?: Record<string, unknown>;
  tip: unknown;
}

export declare function decide(input: DecideInput): {
  lines: string[];
  ok: boolean;
  reason: string;
  stops: string[];
};

export declare function afterDispatch(input: {
  lane: Lane;
  sha: string;
  laneRuns: RunRow[] | unknown;
  known: number[];
  views: Record<number, RunView | undefined>;
  artifacts: Record<number, ArtifactList | undefined>;
  tip: unknown;
}): { lines: string[]; state: "started" | "wait" | "stop"; reason: string };

/** The pre-upload guard's input (#1616). */
export interface GuardInput {
  lane: Lane;
  sha: string;
  runId: number;
  attempt: number;
  laneRuns: RunRow[] | unknown;
  views: Record<number, RunView | undefined>;
  artifacts: Record<number, ArtifactList | undefined>;
  priorAttempts: Array<{ attempt: number; view: RunView | undefined }>;
  /** Each other run's attempt count, and the views of its earlier attempts. */
  otherAttempts: Record<
    number,
    | {
        attempt: unknown;
        views: Array<{ attempt: number; view: RunView | undefined }>;
      }
    | undefined
  >;
}

export declare function guardUpload(input: GuardInput): {
  decision: "upload" | "skip" | "stop";
  reason: string;
  lines: string[];
};
