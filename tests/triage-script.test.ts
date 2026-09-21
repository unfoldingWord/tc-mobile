import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  // Stripping GIT_* does not stop git reading ~/.gitconfig, and this helper
  // is the only test in the tree that runs `git commit`. A developer with
  // `commit.gpgsign=true` would have it block on pinentry, and a global
  // `core.hooksPath` would run their hooks against the fixture repo — both
  // inside `.husky/pre-push`, which is the very path this PR is fixing
  // (George R1 P3). Point git at no config at all; these are set AFTER the
  // strip above, which would otherwise remove them.
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  return env;
}

/** A throwaway git repo with the script and the given reviewer reports in it. */
function runTriage(reports: { frank?: string; george?: string }): {
  output: string;
  status: number;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "triage-"));
  const env = gitFreeEnv();
  // Every child gets an explicit timeout. vitest's per-`it` timeout cannot
  // interrupt a blocked `execFileSync` — only Node's own kill can — which is
  // why `check-deploy.test.ts` does the same thing (George R1 P3).
  const TIMEOUT = 10_000;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "pipe",
      env,
      timeout: TIMEOUT,
    });

  try {
    git("init", "--quiet");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(path.join(dir, "seed"), "seed\n");
    git("add", "seed");
    // Belt and braces alongside GIT_CONFIG_GLOBAL: signing and hooks are the
    // two things that turn this commit into an interactive wait.
    git(
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "seed"
    );

    mkdirSync(path.join(dir, "scripts", "review"), { recursive: true });
    cpSync(TRIAGE, path.join(dir, "scripts", "review", "triage.sh"));

    mkdirSync(path.join(dir, ".review"), { recursive: true });
    if (reports.frank !== undefined) {
      writeFileSync(
        path.join(dir, ".review", "frank-abc1234.md"),
        reports.frank
      );
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
        timeout: TIMEOUT,
      });
    } catch (cause) {
      status = (cause as { status?: number }).status ?? -1;
    }

    const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      env,
      timeout: TIMEOUT,
    }).trim();

    return {
      output: readFileSync(
        path.join(dir, ".review", `triage-round1-${sha}.md`),
        "utf8"
      ),
      status,
    };
  } finally {
    // Six of these per run, each an initialised repo (Frank R1 P3).
    rmSync(dir, { recursive: true, force: true });
  }
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
    expect(output).toContain("NOT evidence of a clean report");
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
    // George has no stable all-clear spelling anywhere in this tree, so the
    // script refuses to CLAIM his report is clean and asks for confirmation
    // instead. That is the honest answer: it cannot tell.
    expect(output).toContain("NOT evidence of a clean report");
    expect(output).not.toContain("reported no findings");
  });

  it("both reviewers are clean", () => {
    const { output, status } = runTriage({
      frank: FRANK_CLEAN,
      george: GEORGE_CLEAN,
    });
    expect(status).toBe(0);
    expectWholeDocument(output);
    // Frank ends a clean review with an explicit line per severity, which is
    // machine-checkable; George does not, so the two render differently.
    expect(output).toContain("NOT evidence of a clean report");
    expect(output).toContain("NOT evidence of a clean report");
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
    expect(output).toContain("NOTHING EXTRACTED");
    expect(output).not.toContain("reported no findings");
  });
  it("never claims clean on APPROVE when the findings were not recognised", () => {
    // Frank R1 P2 and George R1 P2, independently: an empty extraction is NOT
    // evidence of a clean report. dual-review.md keeps P3s — they are
    // "deferred to an issue, not dropped" — and an APPROVE round carrying only
    // P3s is legitimate, so this shape must never render as "no findings".
    const approveWithUnmatchedP3 = `# Review B

## P3

\`runTriage\` never deletes its temp directories.

## Verdict

**APPROVE**
`;
    const { output } = runTriage({
      frank: FRANK_CLEAN,
      george: approveWithUnmatchedP3,
    });
    expectWholeDocument(output);
    expect(output).toContain("NOT evidence of a clean report");
    expect(output).not.toContain("reported no findings");
  });

  it("does not go quiet on the severity-heading shape George really uses", () => {
    // Not hypothetical. `.review/george-38dbd60.md` is a REQUEST_CHANGES round
    // whose P1/P2/P3 findings are written as `### P2` severity headings rather
    // than `### 1. P2 — …`, so the extractor matches none of them. 13 of the
    // 38 reports in `.review/` extract empty this way and five of those block
    // merge. Widening the extractor is its own change; what this pins is that
    // the shape can never be reported as nothing-to-see.
    const severityHeadings = `# Review B (DEEP-TREE)

## Findings

### P1

None.

### P2

- **Concrete failure scenario:** the protective entry is gone.

### P3

- **Concrete failure scenario:** None at runtime.

## Verdict

**REQUEST_CHANGES**
`;
    const { output } = runTriage({
      frank: FRANK_CLEAN,
      george: severityHeadings,
    });
    expectWholeDocument(output);
    expect(output).toContain("NOTHING EXTRACTED");
    expect(output).toContain("REQUEST_CHANGES");
    expect(output).not.toContain("reported no findings");
  });
  // ── Frank R2 / George R2, convergent ────────────────────────────────────
  //
  // A reviewer report is not just the reviewer's prose: `frank.sh`/`george.sh`
  // embed the prompt AND the diff under review. So a report ABOUT this file
  // contains this file's fixtures, which spell all three all-clear phrases.
  // Frank's own R2 report on this PR is REQUEST_CHANGES with a live P2 and
  // contains "No P1 findings" 20 times, "No P2 findings" 14 and "No P3
  // findings" 18. An unanchored all-clear search declares it clean.
  //
  // These two fixtures quote the phrases the way a transcript really does —
  // indented inside a snippet, and as `+` diff lines — so they pin the
  // anchoring, not just the verdict guard.
  const QUOTED_ALL_CLEAR = `I read \`explicit_all_clear\`:

    grep -qiE 'No P1 findings' "$f" \\
      && grep -qiE 'No P2 findings' "$f" \\
      && grep -qiE 'No P3 findings' "$f"

and the fixture it is matched against:

+1. No P1 findings.
+
+2. No P2 findings.
+
+3. No P3 findings.
`;

  it("a blocking verdict can never be reported as clean, whatever the transcript quotes", () => {
    const blocking = `# Review B

## Findings

### P2

${QUOTED_ALL_CLEAR}

## Verdict

**REQUEST_CHANGES**
`;
    const { output } = runTriage({ frank: FRANK_CLEAN, george: blocking });
    expectWholeDocument(output);
    expect(output).toContain("NOTHING EXTRACTED");
    expect(output).not.toContain("reported no findings");
  });

  it("quoted all-clear text does not trip the detector on an APPROVE round either", () => {
    // The verdict guard alone would let this through; only the anchoring
    // stops it. An unmatched P3 on an APPROVE round is a legitimate round
    // (dual-review.md: deferred to an issue, NOT dropped).
    const approveWithQuote = `# Review B

## P3

${QUOTED_ALL_CLEAR}

## Verdict

**APPROVE**
`;
    const { output } = runTriage({
      frank: FRANK_CLEAN,
      george: approveWithQuote,
    });
    expectWholeDocument(output);
    expect(output).toContain("NOT evidence of a clean report");
    expect(output).not.toContain("reported no findings");
  });
});
