import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

/**
 * Pins the wiring of `.github/workflows/pr-body.yml` (#1442). Reads the
 * workflow's literal text with comments stripped (AGENTS.md: a positive
 * match on raw YAML is satisfied by a comment), so each assertion fails if
 * the live line is gone, however much prose still mentions it.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const code = stripYamlComments(
  readFileSync(path.join(ROOT, ".github", "workflows", "pr-body.yml"), "utf8")
);

describe("pr-body.yml", () => {
  it("re-runs when the body is edited, not only on a push", () => {
    expect(code).toMatch(/pull_request:\s*\n\s*types:\s*\[[^\]]*\bedited\b/);
  });

  it("runs on pull_request, never pull_request_target (no write token near a PR's code)", () => {
    expect(code).toMatch(/^\s*pull_request:/m);
    expect(code).not.toMatch(/pull_request_target/);
  });

  it("reads the event payload file", () => {
    expect(code).toContain(
      'node scripts/check-pr-body.mjs --event "$GITHUB_EVENT_PATH"'
    );
  });

  it("never puts PR-controlled text through a ${{ }} into a run: line", () => {
    const runs = code
      .split("\n")
      .filter((l) => /^\s*run:/.test(l) || /^\s{10,}\S/.test(l));
    for (const line of runs) {
      expect(line).not.toMatch(
        /\$\{\{\s*github\.event\.pull_request\.(body|title|head\.ref)/
      );
    }
    expect(code).not.toMatch(/\$\{\{\s*github\.event\.pull_request\.body/);
  });

  it("checks out full history, fetches the base, and holds read-only contents", () => {
    expect(code).toMatch(/fetch-depth:\s*0/);
    expect(code).toContain('git fetch origin "$BASE_REF"');
    expect(code).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });
});
