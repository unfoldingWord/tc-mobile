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
 * tip. Observed on PR #869, run 36033907345 (`BASE_SHA=6eb37531`,
 * `HEAD_SHA=f2ba1c2a` the merge ref, develop at `1b42e600`): the gate failed
 * on four bodyless commits already merged to `develop` (via #875, #870,
 * #852) that #869 never introduced.
 *
 * The fix judges only the PR's own commits: diff a freshly-fetched
 * `origin/<base_ref>` (never the possibly-stale `pull_request.base.sha`)
 * against `pull_request.head.sha` (the PR branch's own tip, never the
 * synthetic merge ref). Proven correct in three states with a real local-git
 * scratch scenario (PR body): a PR branched from an old `develop` that never
 * merges it back in, the same PR after it merges `develop` in, and the
 * normal fresh-branch case.
 *
 * "A gate is tested in both states" (AGENTS.md), and per
 * `tests/smoke-path-filter.test.ts`'s pattern: this reads the LITERAL text
 * out of `ci.yml` rather than re-typing the wiring, so a revert back to
 * `github.sha` (or a switch back to the raw `pull_request.base.sha`) fails
 * here even if nobody remembers why it mattered.
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

describe("commit-messages CI gate judges only the PR's own commits (#865 follow-up)", () => {
  it("is still in ci.yml where this test reads it from", () => {
    // If the job is renamed or moved, fail loudly here rather than silently
    // asserting nothing below.
    expect(() => commitMessagesJob()).not.toThrow();
    expect(commitMessagesJob()).toContain("check-commit-messages.mjs");
  });

  it("derives HEAD from the PR branch's own tip, never the pull_request merge ref", () => {
    const job = commitMessagesJob();
    // `github.sha` on a `pull_request` event is GitHub's synthetic merge-ref
    // commit — it contains the base branch's CURRENT tip, not just the PR's
    // commits. This is the exact defect observed on #869 (run 36033907345).
    expect(job).not.toMatch(/:\s*\$\{\{\s*github\.sha\s*\}\}/);
    expect(job).toMatch(
      /HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/
    );
  });

  it("diffs against a freshly-fetched base ref, not a possibly-stale pull_request.base.sha", () => {
    const job = commitMessagesJob();
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
    const job = commitMessagesJob();
    expect(job).not.toMatch(
      /:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/
    );
  });
});
