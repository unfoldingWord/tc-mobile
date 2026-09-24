import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Pins the `commit-messages` job's range wiring in `ci.yml` (#865 follow-up).
 *
 * #865 wired the job as
 * `BASE_SHA: ${{ github.event.pull_request.base.sha }}` /
 * `HEAD_SHA: ${{ github.sha }}`, range `"$BASE_SHA..$HEAD_SHA"`. On a
 * `pull_request` event `github.sha` is GitHub's synthetic merge ref
 * (`refs/pull/N/merge`), which contains the base branch's CURRENT tip, not
 * the PR's own commits — and `pull_request.base.sha` can be older than that
 * tip, so the range swept in commits already on the base branch that the PR
 * never made (#869; the run evidence is in #883's PR body).
 *
 * The fix judges only the PR's own commits: diff a freshly-fetched
 * `origin/<base_ref>` (never the possibly-stale `pull_request.base.sha`)
 * against `pull_request.head.sha` (the PR branch's own tip, never the
 * synthetic merge ref).
 *
 * "A gate is tested in both states" (AGENTS.md), and per
 * `tests/smoke-path-filter.test.ts`'s pattern: this reads the LITERAL text
 * out of `ci.yml` rather than re-typing the wiring, so a revert back to
 * `github.sha` (or a switch back to the raw `pull_request.base.sha`) fails
 * here even if nobody remembers why it mattered. Assertions read
 * `commitMessagesCode()`, which drops full-line YAML comments, so neither a
 * commented-out good range nor an inline `${{ }}` revert in `run:` passes.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  path.join(ROOT, ".github", "workflows", "ci.yml"),
  "utf8"
);

/** The `commit-messages:` job's body, from its header to the next top-level job. */
function commitMessagesJob(): string {
  const match = /\n {2}commit-messages:\n([\s\S]*?)\n {2}quality:/.exec(
    workflow
  );
  if (!match?.[1]) {
    throw new Error("commit-messages job not found in ci.yml");
  }
  return match[1];
}

/** The same job with full-line `#` comments removed: only live YAML. */
function commitMessagesCode(): string {
  return commitMessagesJob()
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("commit-messages CI gate judges only the PR's own commits (#865 follow-up)", () => {
  it("is still in ci.yml where this test reads it from", () => {
    // If the job is renamed or moved, fail loudly here rather than silently
    // asserting nothing below.
    expect(() => commitMessagesJob()).not.toThrow();
    expect(commitMessagesJob()).toContain("check-commit-messages.mjs");
  });

  it("derives HEAD from the PR branch's own tip, never the pull_request merge ref", () => {
    const job = commitMessagesCode();
    // `github.sha` on a `pull_request` event is GitHub's synthetic merge-ref
    // commit — it contains the base branch's CURRENT tip, not just the PR's
    // commits. This is the exact defect observed on #869 (run 36033907345).
    expect(job).not.toMatch(/\$\{\{\s*github\.sha\s*\}\}/);
    expect(job).toMatch(
      /HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/
    );
  });

  it("diffs against a freshly-fetched base ref, not a possibly-stale pull_request.base.sha", () => {
    const job = commitMessagesCode();
    // `pull_request.base.sha` is a snapshot that can be behind the base
    // branch's current tip by the time CI runs. Fetching `origin/<base_ref>`
    // live and using it as the range's base keeps the comparison point
    // current no matter how stale the PR's recorded base.sha is.
    expect(job).toMatch(/git fetch origin "\$BASE_REF"/);
    expect(job).toMatch(
      /check-commit-messages\.mjs --range "origin\/\$BASE_REF\.\.\$HEAD_SHA"/
    );
  });

  it("never falls back to the raw pull_request.base.sha as the range's base", () => {
    const job = commitMessagesCode();
    expect(job).not.toMatch(
      /\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/
    );
  });
});

/**
 * Pins the base-conditional added for #891.
 *
 * #883 fixed HEAD_SHA (above), but the base side is still
 * `origin/$BASE_REF..$HEAD_SHA` unconditionally. For a `develop -> staging`
 * (or `staging -> main`) promotion, `$BASE_REF` is `staging` (or `main`), and
 * that range is every commit since the LAST promotion — commits already
 * judged by develop's own gate, or that predate the gate entirely (#889, 20
 * such commits). Giving them bodies would mean rewriting develop's history,
 * which this repo does not do, so a promotion can never pass.
 *
 * The fix: when `$BASE_REF` is `staging` or `main`, diff against
 * `origin/develop` instead of `origin/$BASE_REF` — every commit on develop
 * has already been judged by develop's own gate, or predates it. A PR into
 * develop (or anything else) is unchanged: `origin/$BASE_REF..$HEAD_SHA`,
 * still pinned by the describe block above.
 *
 * This must still catch a hotfix: a PR into `staging` carrying a commit that
 * is NOT on develop (branched off staging directly, or added after
 * branching) is exactly the case `origin/develop..$HEAD_SHA` is supposed to
 * keep catching, so the conditional must apply `origin/develop`, never
 * unconditionally skip the check for a staging/main base.
 *
 * #901: the two `it`s below that used to live in this describe block —
 * "diffs a staging/main base against origin/develop" and "still diffs a
 * develop (or other) base against origin/$BASE_REF" — matched those
 * substrings anywhere in the job body, so the assertions would still pass
 * even if a command were moved to the wrong side of the `if`/`else`. The
 * describe block after this one ("...executed (#901)") replaces them: it
 * extracts the step's own `run:` block and executes it with stubbed `git`
 * and `node`, per `$BASE_REF`, so it can only pass when each arm produces
 * the range it is actually responsible for.
 */
describe("commit-messages CI gate scopes staging/main PRs to commits not on develop (#891)", () => {
  it("branches the range on whether the PR's base is staging or main", () => {
    const job = commitMessagesCode();
    // The exact comparison shape this PR wires up: a shell conditional on
    // $BASE_REF, not a GitHub Actions `if:` (the step already runs
    // unconditionally for every PR; only the RANGE differs by base).
    expect(job).toMatch(
      /\[\s*"\$BASE_REF"\s*=\s*"staging"\s*\]\s*\|\|\s*\[\s*"\$BASE_REF"\s*=\s*"main"\s*\]/
    );
  });
});

/**
 * Executes the `commit-messages` job's own `run:` block instead of matching
 * substrings against it (#901, a follow-up from round 1 on #895/#891).
 *
 * A substring match (as the describe block above used to do, for the two
 * `it`s removed there) finds the `staging`/`main` conditional and both
 * `check-commit-messages.mjs --range` invocations independently of one
 * another and independently of which side of the `if`/`else` they sit on.
 * It would still pass if a command were moved to the wrong arm. This block
 * instead extracts the literal script text after `run: |` and runs it with
 * `bash`, with stub `git` and `node` executables placed first on `PATH` that
 * record their argv instead of doing anything real, so what is asserted is
 * the exact command each arm actually produces for a given `$BASE_REF`.
 *
 * Pattern reused from `tests/android-play-workflow.test.ts` (#899), which
 * extracts a workflow step's script the same way and runs it with
 * `spawnSync`.
 */
describe("commit-messages CI gate: the step's own run: block, executed (#901)", () => {
  /** The literal shell script inside the step's `run: |` block. */
  function commitGateScript(): string {
    const start = workflow.indexOf(
      "      - name: Check PR commits for a non-blank body\n"
    );
    if (start < 0) {
      throw new Error("Missing 'Check PR commits for a non-blank body' step");
    }
    const block = workflow.slice(start);
    const run = /^ {8}run: \|\n/m.exec(block);
    if (!run) throw new Error("Missing run block");
    const lines = block.slice(run.index + run[0].length).split("\n");
    const script: string[] = [];
    for (const line of lines) {
      if (line && !line.startsWith(" ".repeat(10))) break;
      script.push(line.slice(10));
    }
    return script.join("\n");
  }

  /**
   * Runs the extracted script with stub `git`/`node` on `PATH` and returns
   * each stub invocation's argv, in call order, as one string per call
   * (`"<name> <args...>"`). The stubs do nothing but log and exit 0 — this
   * proves what the step *would* run, not that a real fetch or the real
   * `check-commit-messages.mjs` succeeds (that script has its own tests).
   */
  function runCommitGate(env: {
    BASE_REF: string;
    HEAD_SHA: string;
  }): string[] {
    const dir = mkdtempSync(path.join(tmpdir(), "commit-gate-stub-"));
    const callLog = path.join(dir, "calls.log");
    writeFileSync(callLog, "");
    try {
      for (const name of ["git", "node"]) {
        const stub = path.join(dir, name);
        writeFileSync(
          stub,
          `#!/usr/bin/env bash\nprintf '${name} %s\\n' "$*" >> "$CALL_LOG"\nexit 0\n`
        );
        chmodSync(stub, 0o755);
      }
      const result = spawnSync("bash", ["-c", commitGateScript()], {
        encoding: "utf8",
        env: {
          PATH: `${dir}:${process.env.PATH ?? ""}`,
          CALL_LOG: callLog,
          BASE_REF: env.BASE_REF,
          HEAD_SHA: env.HEAD_SHA,
        },
      });
      if (result.status !== 0) {
        throw new Error(
          `commit gate script exited ${result.status}: ${result.stderr}`
        );
      }
      return readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const HEAD_SHA = "deadbeefcafef00d";

  it("is still extractable at the shape this test reads it from", () => {
    expect(() => commitGateScript()).not.toThrow();
    expect(commitGateScript()).toContain("check-commit-messages.mjs");
  });

  it.each([
    ["staging", "develop"],
    ["main", "develop"],
    ["develop", "develop"],
  ])(
    "BASE_REF=%s fetches and ranges against origin/%s, not any other ref",
    (baseRef, expectedBase) => {
      const calls = runCommitGate({ BASE_REF: baseRef, HEAD_SHA });
      expect(calls).toEqual([
        `git fetch origin ${expectedBase}`,
        `node scripts/check-commit-messages.mjs --range origin/${expectedBase}..${HEAD_SHA}`,
      ]);
    }
  );

  // staging and main take the `if` arm; develop above took the `else` arm
  // but happened to produce identical text, since $BASE_REF *is* "develop"
  // there. A non-standard base is the case that tells the two arms apart:
  // only the `else` arm's `origin/$BASE_REF` (not a hardcoded
  // `origin/develop`) explains this result.
  it("BASE_REF=a non-standard base uses $BASE_REF itself in the else arm, not a hardcoded develop", () => {
    const calls = runCommitGate({ BASE_REF: "feature-x", HEAD_SHA });
    expect(calls).toEqual([
      "git fetch origin feature-x",
      `node scripts/check-commit-messages.mjs --range origin/feature-x..${HEAD_SHA}`,
    ]);
  });
});
