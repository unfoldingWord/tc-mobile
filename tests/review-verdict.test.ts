import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Entry-path tests for the review harness's verdict detection (#348, and the
// "line-anchored verdict" item of #220). These run the REAL scripts —
// scripts/review/_verdict.sh, frank.sh, george.sh, triage.sh — as real
// subprocesses, not a reimplementation of their logic in TypeScript. That is
// the only way to prove the actual gate (AGENTS.md: "test a gate script's
// entry path and defaults, not just its exported function").
//
// #348's root cause: `grep -qE "APPROVE|REQUEST_CHANGES"` is a bare substring
// match anywhere in the report. frank.sh's own prompt tells the reviewer
// "End with a verdict line: APPROVE or REQUEST_CHANGES." — and Codex's
// transcript echoes that prompt back, so the guard matches its own
// instructions and a stalled run (no real review, no real verdict) passes as
// clean. #220 names the same shape for prose ("whether to APPROVE or
// REQUEST_CHANGES") and for triage.sh's verdict extraction.
//
// The fix anchors the match to a line that IS the verdict and nothing else.
// Real verdict-line shapes this anchor must accept, taken from archived
// reports under /workspace/temp/tc-mobile-review/ (read, not guessed — see
// the plan file for the exact citations; reproduced here as synthetic
// fixtures rather than verbatim excerpts):
//   Verdict: APPROVE
//   **Verdict:** REQUEST_CHANGES
//   **Verdict: REQUEST_CHANGES**
//   **REQUEST_CHANGES**
//   REQUEST_CHANGES              (bare, its own line)
// and it must REJECT a line that merely mentions the words in prose, and a
// transcript that only echoes the instruction asking for a verdict.

const REPO_ROOT = path.join(import.meta.dirname, "..");
const REVIEW_DIR = path.join(REPO_ROOT, "scripts", "review");
const VERDICT_SH = path.join(REVIEW_DIR, "_verdict.sh");
const FRANK_SH = path.join(REVIEW_DIR, "frank.sh");
const GEORGE_SH = path.join(REVIEW_DIR, "george.sh");
const TRIAGE_SH = path.join(REVIEW_DIR, "triage.sh");

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Strips GIT_* environment variables (GIT_DIR, GIT_WORK_TREE,
// GIT_INDEX_FILE, ...) before spawning git or a review script against a
// throwaway temp repo. These tests are spawned by `npm test` itself, which
// runs inside `.husky/pre-push` when this suite runs via a real `git push`
// — git sets those vars for hook scripts so they operate on the repo being
// pushed, and without stripping them a child `git`/`frank.sh`/etc. run
// against an unrelated temp repo inherits them and fails with "Current
// directory is not a git directory!" — a real interaction this suite would
// otherwise be flaky under pre-push and pass everywhere else.
function cleanEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return { ...env, ...overrides };
}

function runBash(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Result {
  try {
    const stdout = execFileSync("bash", args, {
      encoding: "utf8",
      cwd: opts.cwd,
      env: opts.env ?? cleanEnv(),
      timeout: 15_000,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as {
      status: number | null;
      stdout: string;
      stderr: string;
    };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function mktemp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// verdict_token() — unit level, sourcing the real _verdict.sh
// ---------------------------------------------------------------------------

function verdictTokenOf(content: string | null): Result {
  const dir = mktemp("verdict-unit-");
  try {
    const file = path.join(dir, "report.md");
    if (content !== null) writeFileSync(file, content);
    else {
      // Deliberately never created — exercises the missing-file path.
    }
    const script = [
      "set -euo pipefail",
      `source ${shQuote(VERDICT_SH)}`,
      `verdict_token ${shQuote(file)}`,
    ].join("\n");
    return runBash(["-c", script]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("verdict_token (scripts/review/_verdict.sh)", () => {
  it("matches a plain 'Verdict: APPROVE' line", () => {
    const result = verdictTokenOf("Some findings.\n\nVerdict: APPROVE\n");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("APPROVE");
  });

  it("matches '**Verdict:** REQUEST_CHANGES' (bold label, plain token)", () => {
    const result = verdictTokenOf(
      "1. P1: none.\n\n**Verdict:** REQUEST_CHANGES\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("REQUEST_CHANGES");
  });

  it("matches '**Verdict: REQUEST_CHANGES**' (whole line bold)", () => {
    const result = verdictTokenOf(
      "Findings above.\n\n**Verdict: REQUEST_CHANGES**\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("REQUEST_CHANGES");
  });

  it("matches '**REQUEST_CHANGES**' (bold token, no label)", () => {
    const result = verdictTokenOf(
      "P1: none. P2: two.\n\n**REQUEST_CHANGES**\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("REQUEST_CHANGES");
  });

  it("matches a bare 'REQUEST_CHANGES' line with nothing else", () => {
    const result = verdictTokenOf(
      "P1: none. P2: two. P3: two.\n\nREQUEST_CHANGES\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("REQUEST_CHANGES");
  });

  it("takes the LAST anchored verdict when Codex echoes its final message twice", () => {
    const result = verdictTokenOf(
      "1. P1: None.\n\nVerdict: APPROVE\n\n1. P1: None.\n\nVerdict: APPROVE\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("APPROVE");
  });

  it("REJECTS a transcript that only echoes the reviewer prompt's instruction sentence (#348's exact mechanism)", () => {
    const result = verdictTokenOf(
      "Report findings as a numbered list. ... If you find nothing at a severity, say so explicitly. End with a verdict line: APPROVE or REQUEST_CHANGES.\n"
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
  });

  it("REJECTS prose that merely mentions both words (#220's example: 'whether to APPROVE or REQUEST_CHANGES')", () => {
    const result = verdictTokenOf(
      "The team should decide whether to APPROVE or REQUEST_CHANGES once more data is in.\n"
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
  });

  // The two cases below isolate ONE anchor each, so a test failure points at
  // which half of VERDICT_LINE_RE broke. The prose-mentions-both-words case
  // above exercises both anchors at once and would still pass with either one
  // alone removed (the token there is neither the first nor the last thing on
  // the line for a different reason each way), so it does not prove either
  // anchor is load-bearing by itself. Confirmed directly: stripping `^` from
  // VERDICT_LINE_RE makes the trailing-word case below match (APPROVE is the
  // last word on its line, so a start-anchor-free pattern finds it); stripping
  // `$` makes both token-plus-trailing-text cases match (APPROVE/
  // REQUEST_CHANGES open the line, so an end-anchor-free pattern is satisfied
  // before the trailing text is ever looked at). Restored before this file was
  // written.
  it("REJECTS a line where the verdict token is the trailing word of prose (kills removal of the ^ anchor)", () => {
    const result = verdictTokenOf(
      "Given the diff above, I'd lean toward APPROVE\n"
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
  });

  it("REJECTS a line where the verdict token is followed by more text (kills removal of the $ anchor)", () => {
    const commaCase = verdictTokenOf("APPROVE, pending the follow-up.\n");
    expect(commaCase.status).toBe(1);
    expect(commaCase.stdout.trim()).toBe("");

    const dashCase = verdictTokenOf("REQUEST_CHANGES — see finding 2.\n");
    expect(dashCase.status).toBe(1);
    expect(dashCase.stdout.trim()).toBe("");
  });

  it("does not let trailing prose override an earlier real anchored verdict", () => {
    const result = verdictTokenOf(
      "Verdict: APPROVE\n\nNote: the team can still decide later whether to APPROVE or REQUEST_CHANGES the follow-up.\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("APPROVE");
  });

  it("returns nothing (status 1) for a missing report file", () => {
    const result = verdictTokenOf(null);
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Entry-path: triage.sh — real subprocess, throwaway temp git repo
// ---------------------------------------------------------------------------

function makeTempRepo(): string {
  const dir = mktemp("triage-entry-");
  const env = cleanEnv();
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    env,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, env });
  // .review/ must be ignored, matching the real repo — otherwise
  // assert_tree_unchanged() (scripts/review/_preamble.sh) sees the report
  // files the scripts themselves write as an untracked-tree mutation and
  // fails the run for a reason that has nothing to do with this test.
  writeFileSync(path.join(dir, ".gitignore"), ".review/\n");
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "init"], {
    cwd: dir,
    env,
  });
  // triage.sh sources `scripts/review/_*.sh` relative to the repo toplevel
  // it `cd`s into — real helper files, copied verbatim, not reimplemented.
  const destReview = path.join(dir, "scripts", "review");
  mkdirSync(destReview, { recursive: true });
  for (const entry of readdirSync(REVIEW_DIR)) {
    if (entry.startsWith("_") && entry.endsWith(".sh")) {
      copyFileSync(path.join(REVIEW_DIR, entry), path.join(destReview, entry));
    }
  }
  return dir;
}

function runTriage(dir: string, round: string): Result {
  return runBash([TRIAGE_SH, round], { cwd: dir });
}

describe("triage.sh entry path (real subprocess)", () => {
  it("defaults both reviewers to 'not run' when no report exists (entry default, no crash — also regression-covers the $lens_ typo, #220 item 4, fixed alongside this because it otherwise aborts this exact default under set -u)", () => {
    const dir = makeTempRepo();
    try {
      const result = runTriage(dir, "1");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Triage skeleton:");
      const outFile = result.stdout.match(/Triage skeleton: (\S+)/)?.[1];
      expect(outFile).toBeTruthy();
      const body = execFileSync("cat", [outFile as string], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(body).toContain("| Frank  | not run |");
      expect(body).toContain("| George | not run |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a real anchored verdict for one reviewer and 'not run' for the missing other", () => {
    const dir = makeTempRepo();
    try {
      mkdirSync(path.join(dir, ".review"), { recursive: true });
      // The finding line matches extract()'s existing frank-shape regex so
      // this fixture doesn't trip the separate, out-of-scope #220 item 1
      // (extract()'s grep/sed/awk pipe aborts under pipefail on zero
      // matches) — this test is only about the Verdicts table.
      writeFileSync(
        path.join(dir, ".review", "frank-test0001.md"),
        "1. **P1** — none.\n\nVerdict: APPROVE\n"
      );
      const result = runTriage(dir, "2");
      expect(result.status).toBe(0);
      const outFile = result.stdout.match(
        /Triage skeleton: (\S+)/
      )?.[1] as string;
      const body = execFileSync("cat", [outFile], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(body).toContain("| Frank  | APPROVE |");
      expect(body).toContain("| George | not run |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT let trailing prose in a report override the real verdict in the triage table (#220's prose shape)", () => {
    const dir = makeTempRepo();
    try {
      mkdirSync(path.join(dir, ".review"), { recursive: true });
      // A real APPROVE, followed by prose that mentions REQUEST_CHANGES.
      // The pre-fix `grep -hoE ... | tail -1` picks the LAST bare
      // occurrence anywhere in the file, which is the prose word, not the
      // real verdict — a wrong entry in the triage table.
      writeFileSync(
        path.join(dir, ".review", "frank-test0002.md"),
        "1. **P1** — none.\n\nVerdict: APPROVE\n\nFollow-up note: the team can decide later whether to APPROVE or REQUEST_CHANGES the deferred item.\n"
      );
      const result = runTriage(dir, "3");
      expect(result.status).toBe(0);
      const outFile = result.stdout.match(
        /Triage skeleton: (\S+)/
      )?.[1] as string;
      const body = execFileSync("cat", [outFile], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(body).toContain("| Frank  | APPROVE |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Entry-path: frank.sh / george.sh — real subprocess, stub codex/grok on PATH
// ---------------------------------------------------------------------------

const STUB_CODEX = `#!/usr/bin/env bash
# Test stub for codex exec. Mirrors the one behaviour that matters here: the
# real Codex CLI echoes its prompt argument back into the transcript it
# streams to stdout. Invocation shape (frank.sh):
#   codex exec -c sandbox_mode="..." --skip-git-repo-check "<prompt>"
last="\${@: -1}"
printf '%s\\n' "$last"
if [ -n "\${STUB_CODEX_VERDICT:-}" ]; then
  printf '\\nVerdict: %s\\n' "$STUB_CODEX_VERDICT"
fi
`;

const STUB_GROK = `#!/usr/bin/env bash
# Test stub for grok. Real grok does NOT echo its prompt file back (observed
# directly in archived reports — george-*.md starts on the model's own
# analysis, never on prompt text), so this stub exercises the OTHER
# self-match shape #220 names instead: prose that merely mentions both verdict
# words without a real anchored verdict line.
if [ -n "\${STUB_GROK_PROSE_ONLY:-}" ]; then
  echo "Whatever we conclude, whether to APPROVE or REQUEST_CHANGES is ultimately a judgment call for the team."
fi
if [ -n "\${STUB_GROK_VERDICT:-}" ]; then
  printf 'Some findings here.\\n\\n**Verdict:** %s\\n' "$STUB_GROK_VERDICT"
fi
`;

function makeStubBin(scripts: Record<string, string>): string {
  const dir = mktemp("review-stub-bin-");
  for (const [name, content] of Object.entries(scripts)) {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    chmodSync(file, 0o755);
  }
  return dir;
}

function makeReviewRepo(): { dir: string; baseSha: string } {
  const dir = mktemp("review-entry-");
  const env = cleanEnv();
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    env,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, env });
  writeFileSync(path.join(dir, "README.md"), "base\n");
  // See makeTempRepo()'s comment: .review/ must be ignored so the scripts'
  // own report-writing isn't misread as a working-tree mutation.
  writeFileSync(path.join(dir, ".gitignore"), ".review/\n");
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir, env });
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    env,
    encoding: "utf8",
  }).trim();
  writeFileSync(path.join(dir, "feature.txt"), "change\n");
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "feature change"], {
    cwd: dir,
    env,
  });

  // frank.sh/george.sh `source scripts/review/_*.sh` relative to the repo
  // toplevel they `cd` into — real helper files, copied verbatim, not
  // reimplemented. A glob (not a hardcoded name) so a future helper file
  // needs no test-side update to be picked up.
  const destReview = path.join(dir, "scripts", "review");
  mkdirSync(destReview, { recursive: true });
  for (const entry of readdirSync(REVIEW_DIR)) {
    if (entry.startsWith("_") && entry.endsWith(".sh")) {
      copyFileSync(path.join(REVIEW_DIR, entry), path.join(destReview, entry));
    }
  }
  return { dir, baseSha };
}

function withReviewFixture(
  fn: (ctx: { dir: string; baseSha: string; stubBin: string }) => void,
  stubs: Record<string, string>
): void {
  const { dir, baseSha } = makeReviewRepo();
  const stubBin = makeStubBin(stubs);
  try {
    fn({ dir, baseSha, stubBin });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubBin, { recursive: true, force: true });
  }
}

describe("frank.sh entry path (real subprocess, stub codex on PATH)", () => {
  it("FAILS the run when codex only echoes the prompt back (#348's exact reproduction, using frank.sh's real prompt template)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([FRANK_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({ PATH: `${stubBin}:${process.env.PATH}` }),
        });
        expect(result.status).toBe(3);
        expect(result.stderr).toContain(
          "FAILED RUN: Frank produced no verdict — stalled or cancelled."
        );
      },
      { codex: STUB_CODEX }
    );
  });

  it("passes with a real anchored verdict appended after the echoed prompt", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([FRANK_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_CODEX_VERDICT: "APPROVE",
          }),
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Report: ");
      },
      { codex: STUB_CODEX }
    );
  });
});

describe("george.sh entry path (real subprocess, stub grok on PATH)", () => {
  it("FAILS the run when grok's output only mentions the verdict words in prose (#220's prose shape)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_PROSE_ONLY: "1",
          }),
        });
        expect(result.status).toBe(3);
        expect(result.stderr).toContain(
          "FAILED RUN: George produced no verdict — stalled or cancelled, not a pass."
        );
      },
      { grok: STUB_GROK }
    );
  });

  it("passes with a real anchored verdict line", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_VERDICT: "REQUEST_CHANGES",
          }),
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Report: ");
      },
      { grok: STUB_GROK }
    );
  });
});
