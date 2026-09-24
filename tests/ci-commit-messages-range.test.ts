import { readFileSync } from "node:fs";
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

  it("diffs a staging/main base against origin/develop, not origin/$BASE_REF", () => {
    const job = commitMessagesCode();
    expect(job).toMatch(/git fetch origin develop/);
    expect(job).toMatch(
      /check-commit-messages\.mjs --range "origin\/develop\.\.\$HEAD_SHA"/
    );
  });

  it("still diffs a develop (or other) base against origin/$BASE_REF, unchanged", () => {
    const job = commitMessagesCode();
    // Same assertion as the #865 describe block above, re-stated here so
    // this describe block alone proves state (c)/(d) is untouched even if
    // the #865 block is ever removed.
    expect(job).toMatch(/git fetch origin "\$BASE_REF"/);
    expect(job).toMatch(
      /check-commit-messages\.mjs --range "origin\/\$BASE_REF\.\.\$HEAD_SHA"/
    );
  });
});
