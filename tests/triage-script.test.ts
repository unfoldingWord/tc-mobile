import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `scripts/review/triage.sh`, exercised through its ENTRY PATH (#524).
 *
 * AGENTS.md: "test a gate script's entry path and defaults, not just its
 * exported function". There is no exported function here — the whole script is
 * one `{ ... } > "$OUT"` block — so the only honest way to pin it is to run it
 * against fixture reports and read the file it writes.
 *
 * What this exists to stop: `extract()` ended in a `grep | sed | awk | ...`
 * pipeline, and `grep` exits 1 when it matches nothing. Under the script's own
 * `set -euo pipefail` that killed the whole block the moment ONE reviewer had
 * no findings, truncating the document at that reviewer's heading. Because
 * Frank is extracted first, a clean Frank silently erased George's findings
 * AND the verdicts table, leaving a plausible ~200-byte file with no marker
 * that anything was missing.
 *
 * So the four combinations below are all pinned, not just the one observed.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TRIAGE = path.join(REPO_ROOT, "scripts", "review", "triage.sh");

const FRANK_WITH_FINDINGS = `# Review A

1. **P2 — something diff-local is wrong.**
   Details here.

2. **P3 — a nit.**
   More details.

**Verdict: REQUEST_CHANGES**
`;

const FRANK_CLEAN = `# Review A

1. No P1 findings.

2. No P2 findings.

3. No P3 findings.

Verdict: **APPROVE**
`;

const GEORGE_WITH_FINDINGS = `# Review B (DEEP-TREE)

## P1

None.

### 1. P2 — a contract mismatch in the unchanged tree

Where: src/thing.ts:12

### 2. P3 — a nit about a comment

## Verdict

**REQUEST_CHANGES**
`;

const GEORGE_CLEAN = `# Review B (DEEP-TREE)

## P1

None.

## Verdict

**APPROVE**
`;

/**
 * git's own environment, removed.
 *
 * When the suite runs from `.husky/pre-push`, git exports `GIT_DIR`,
 * `GIT_INDEX_FILE` and friends into the hook's environment. Those are
 * absolute and point at the REAL repository, so an inherited env makes the
 * `git init` below initialise a throwaway directory and then have every
 * subsequent git call operate on tc-mobile itself — `rev-parse HEAD` returns
 * the real HEAD, the fixture repo is never actually used, and five of the six
 * cases below fail with paths that do not exist.
 *
 * Found by `git push`: this file passed standalone and failed under pre-push,
 * which is the difference between testing a script and testing it where it
 * actually runs.
 */
function gitFreeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

/** A throwaway git repo with the script and the given reviewer reports in it. */
function runTriage(reports: { frank?: string; george?: string }): {
  output: string;
  status: number;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "triage-"));
  const env = gitFreeEnv();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", env });

  git("init", "--quiet");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(dir, "seed"), "seed\n");
  git("add", "seed");
  git("commit", "--quiet", "-m", "seed");

  mkdirSync(path.join(dir, "scripts", "review"), { recursive: true });
  cpSync(TRIAGE, path.join(dir, "scripts", "review", "triage.sh"));

  mkdirSync(path.join(dir, ".review"), { recursive: true });
  if (reports.frank !== undefined) {
    writeFileSync(path.join(dir, ".review", "frank-abc1234.md"), reports.frank);
  }
  if (reports.george !== undefined) {
    writeFileSync(
      path.join(dir, ".review", "george-abc1234.md"),
      reports.george
    );
  }

  let status = 0;
  try {
    execFileSync("bash", ["scripts/review/triage.sh", "1"], {
      cwd: dir,
      stdio: "pipe",
      env,
    });
  } catch (cause) {
    status = (cause as { status?: number }).status ?? -1;
  }

  const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    env,
  }).trim();

  return {
    output: readFileSync(
      path.join(dir, ".review", `triage-round1-${sha}.md`),
      "utf8"
    ),
    status,
  };
}

/** The sections every triage document must carry, whatever the findings are. */
function expectWholeDocument(output: string) {
  expect(output).toContain("### Reviewer A — Frank");
  expect(output).toContain("### Reviewer B — George");
  expect(output).toContain("### Convergences");
  expect(output).toContain("### Verdicts");
  expect(output).toContain("escalation, not an approval");
}

describe("triage.sh writes a whole document in every finding combination (#524)", () => {
  it("both reviewers have findings", () => {
    const { output, status } = runTriage({
      frank: FRANK_WITH_FINDINGS,
      george: GEORGE_WITH_FINDINGS,
    });
    expect(status).toBe(0);
    expectWholeDocument(output);
    expect(output).toContain("something diff-local is wrong");
    expect(output).toContain("a contract mismatch in the unchanged tree");
  });

  it("Frank is clean and George has findings — the case observed on #542", () => {
    // The regression: Frank is extracted FIRST, so his empty result used to
    // kill the block and take George's findings and both verdicts with it.
    const { output, status } = runTriage({
      frank: FRANK_CLEAN,
      george: GEORGE_WITH_FINDINGS,
    });
    expect(status).toBe(0);
    expectWholeDocument(output);
    expect(output).toContain("Frank reported no findings");
    expect(output).toContain("a contract mismatch in the unchanged tree");
    // The verdicts table is the part whose loss was most dangerous.
    expect(output).toContain("REQUEST_CHANGES");
  });

  it("George is clean and Frank has findings", () => {
    const { output, status } = runTriage({
      frank: FRANK_WITH_FINDINGS,
      george: GEORGE_CLEAN,
    });
    expect(status).toBe(0);
    expectWholeDocument(output);
    expect(output).toContain("something diff-local is wrong");
    expect(output).toContain("George reported no findings");
  });

  it("both reviewers are clean", () => {
    const { output, status } = runTriage({
      frank: FRANK_CLEAN,
      george: GEORGE_CLEAN,
    });
    expect(status).toBe(0);
    expectWholeDocument(output);
    expect(output).toContain("Frank reported no findings");
    expect(output).toContain("George reported no findings");
    expect(output).not.toContain("REQUEST_CHANGES |");
  });

  it("a missing report is named, not silently skipped", () => {
    const { output, status } = runTriage({ george: GEORGE_WITH_FINDINGS });
    expect(status).toBe(0);
    expectWholeDocument(output);
    expect(output).toContain("no report found for Frank");
  });

  it("shouts when nothing extracts but the verdict is REQUEST_CHANGES", () => {
    // "The reviewer found nothing" and "this parser no longer understands the
    // report" must not render identically — the second means the format has
    // drifted and the findings are being dropped, which is the failure this
    // whole file exists to make loud.
    const drifted = `# Review A\n\nP2: the format changed shape entirely.\n\n**Verdict: REQUEST_CHANGES**\n`;
    const { output } = runTriage({
      frank: drifted,
      george: GEORGE_CLEAN,
    });
    expectWholeDocument(output);
    expect(output).toContain("NO FINDINGS EXTRACTED");
    expect(output).not.toContain("Frank reported no findings");
  });
});
