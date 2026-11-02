// Hand-written declaration for ios-sim.mjs's exports, so tests/ios-sim.test.ts
// type-checks without pulling scripts/ into tsconfig.app.json's `include` (the
// same arrangement as check-deploy.d.mts).

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** A Runtime.evaluate reply's `result` member. */
export interface EvalReply {
  result?: { type: string; value?: unknown; description?: string };
  wasThrown?: boolean;
  exceptionDetails?: { text?: string };
}

/** Everything main() touches outside the process, injectable for tests. */
export interface Deps {
  root: string;
  run(
    cmd: string,
    args: string[],
    opts?: { env?: Record<string, string>; inherit?: boolean }
  ): RunResult;
  exists(file: string): boolean;
  findXctestrun?(deps: Deps): string | null;
  withPage<T>(
    pid: number,
    body: (evaluate: (expression: string) => Promise<EvalReply>) => Promise<T>,
    flags?: Record<string, string | true>
  ): Promise<T>;
  out(line: string): void;
  err(line: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export declare function main(argv: string[], deps?: Deps): Promise<number>;
