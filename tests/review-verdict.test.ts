import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
//
// #348 round 3 (Frank at 0fa4d99, two P1s) removed the round-2 tail window
// entirely: a verdict is now read ONLY from a completion artifact each
// script wrote for this run and cleared before starting — Frank's
// -o/--output-last-message file (now also cleared before every invocation,
// closing a stale-artifact false PASS across reruns at the same sha), and
// George's extracted `--output-format json` "text" field (replacing the
// live-streamed transcript window George previously relied on). triage.sh
// was updated to match: its Verdicts table reads from the same isolated
// *.final-message.txt artifacts, not the .md report/transcript files.
//
// #348 round 4 (PR #510 round 3 triage) generalized this into ONE RULE
// rather than patching a sixth call site: every artifact frank.sh/george.sh
// write is now keyed by the head SHA AND a per-run id (RUN_ID — a lexically
// sortable timestamp+pid, generated once at entry, overridable via
// $REVIEW_RUN_ID so a test can pin the exact path a run will use), and every
// one of those paths is truncated at entry, before anything in either
// script can abort. triage.sh's lookups are scoped to `frank-$SHA-*` /
// `george-$SHA-*` — never a bare `frank-*.md` spanning every SHA ever
// reviewed — sorted (not `ls -t`), and a run's verdict file is derived from
// the SAME run id as its own picked report, never chosen independently.

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

  // -------------------------------------------------------------------------
  // #348 round 2 (Frank at c7b46e3, P1 — overruling round 1's REFUTE) added a
  // VERDICT_TAIL_LINES tail window here so a draft verdict followed by real
  // further investigation would fall outside it before a stall. #348 round 3
  // (Frank at 0fa4d99, P1 #2) named that window itself as the defect: a
  // distance-based heuristic, not a completion-based guarantee (a draft
  // verdict closer to a stall than the window's size still passed, and the
  // round-2 test only proved the one chosen distance). The window is gone —
  // verdict_token() no longer defends against "draft, then more
  // investigation, then a stall" at all; THE ONE RULE moves that defense to
  // the CALLER instead (scripts/review/_verdict.sh's top comment): both
  // frank.sh and george.sh now hand verdict_token() a file that is ONLY ever
  // populated with a genuine completion (codex's -o file; George's extracted
  // --output-format json "text" field), cleared before every run, so a
  // draft-then-stall scenario leaves that file absent or empty rather than
  // containing an early anchored line for a window to have to out-run. The
  // entry-path tests below (frank.sh's "premature draft, then stall" case,
  // george.sh's JSON-completion cases) now carry that coverage instead of a
  // unit-level window test.

  // George's own reports are NOT guaranteed to end on the verdict line
  // itself — confirmed directly (not guessed) in two archived reports under
  // /workspace/temp/tc-mobile-review/, reproduced here as a synthetic
  // fixture rather than verbatim (per this file's header note): both
  // george-492-r1-c21a6aa.md:128-132 and george-457-r5-25ea428.md:77-81 put
  // exactly one trailing wrap-up sentence after the verdict line. A tail
  // WINDOW (not a strict "last non-blank line" rule, which was tried first
  // here and rejected precisely because it would misread both of those real
  // reports as "no verdict") is what accepts this real shape.
  it("ACCEPTS a real verdict line with one short trailing wrap-up sentence after it (real George report shape, not a bare last-line rule)", () => {
    const result = verdictTokenOf(
      "## Verdict\n\n**REQUEST_CHANGES**\n\nP2-1 is a real contract bug; P3s can go to issues.\n"
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("REQUEST_CHANGES");
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

function headShaOf(dir: string): string {
  return execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
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

  it("reads a real anchored verdict for one reviewer and 'not run' for the missing other (#348 round 3: verdict read from the isolated *.final-message.txt artifact, not the .md report; #348 round 4: both are now looked up by a SHA-scoped, run-id-suffixed filename — 'frank-$SHA-$RUN_ID.*' — not a fixed 'frank-$SHA.*' name)", () => {
    const dir = makeTempRepo();
    try {
      const sha = headShaOf(dir);
      mkdirSync(path.join(dir, ".review"), { recursive: true });
      // The finding line matches extract()'s existing frank-shape regex so
      // this fixture doesn't trip the separate, out-of-scope #220 item 1
      // (extract()'s grep/sed/awk pipe aborts under pipefail on zero
      // matches) — this test is only about the Verdicts table. The .md
      // report carries the findings text; the verdict itself now comes from
      // a separate final-message file, matching frank.sh's/george.sh's own
      // gate exactly.
      writeFileSync(
        path.join(dir, ".review", `frank-${sha}-1000000000000000000-1.md`),
        "1. **P1** — none.\n\nVerdict: APPROVE\n"
      );
      writeFileSync(
        path.join(
          dir,
          ".review",
          `frank-${sha}-1000000000000000000-1.final-message.txt`
        ),
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
      const sha = headShaOf(dir);
      mkdirSync(path.join(dir, ".review"), { recursive: true });
      // A real APPROVE, followed by prose that mentions REQUEST_CHANGES.
      // The pre-fix `grep -hoE ... | tail -1` picks the LAST bare
      // occurrence anywhere in the file, which is the prose word, not the
      // real verdict — a wrong entry in the triage table.
      writeFileSync(
        path.join(dir, ".review", `frank-${sha}-1000000000000000000-2.md`),
        "1. **P1** — none.\n\nVerdict: APPROVE\n\nFollow-up note: the team can decide later whether to APPROVE or REQUEST_CHANGES the deferred item.\n"
      );
      writeFileSync(
        path.join(
          dir,
          ".review",
          `frank-${sha}-1000000000000000000-2.final-message.txt`
        ),
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

  it("reads 'not run' when a reviewer's .md report exists but its final-message artifact does not (a failed/stalled run leaves a transcript behind but never a completion artifact — #348 round 3)", () => {
    const dir = makeTempRepo();
    try {
      const sha = headShaOf(dir);
      mkdirSync(path.join(dir, ".review"), { recursive: true });
      // Models the exact shape a FAILED frank.sh/george.sh run leaves on
      // disk: the tee'd/report file contains a draft verdict followed by
      // more investigation (frank.sh's own STUB_CODEX_DRAFT_THEN_STALL
      // shape), but the isolated final-message file was never (re)written
      // because the run never reached genuine completion. The triage table
      // must agree with the reviewer's own exit code (3, a failure) and say
      // "not run" — not resurrect a verdict from the leftover transcript.
      writeFileSync(
        path.join(dir, ".review", `frank-${sha}-1000000000000000000-3.md`),
        "1. **P1** — none.\n\nVerdict: APPROVE\n\nActually, let me keep investigating this further.\n"
      );
      const result = runTriage(dir, "4");
      expect(result.status).toBe(0);
      const outFile = result.stdout.match(
        /Triage skeleton: (\S+)/
      )?.[1] as string;
      const body = execFileSync("cat", [outFile], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(body).toContain("| Frank  | not run |");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------
  // #348 round 4 (PR #510 round 3 triage, Frank's P1 #2). Both new tests
  // below are written to go RED against the round-3 code at `afcbf16`
  // (confirmed manually, see the PR triage comment): round-3 triage.sh does
  // `ls -t .review/frank-*.md | head -1` and, independently,
  // `ls -t .review/frank-*.final-message.txt | head -1` — two globs across
  // EVERY sha ever reviewed in the checkout, by mtime, not scoped to the
  // current head and not paired to each other's run.
  // ---------------------------------------------------------------------

  it("shows only the head SHA's report and verdict when a DIFFERENT SHA's artifacts are also present on disk, with a NEWER mtime and a clean APPROVE (#348 round 4 rule 4 — never `ls -t` across SHAs)", () => {
    const dir = makeTempRepo();
    try {
      const headSha = headShaOf(dir);
      // Deliberately not the real head sha of this temp repo — a
      // plausible-looking but unrelated 9-char short sha.
      const otherSha = "0ffff00ff";
      mkdirSync(path.join(dir, ".review"), { recursive: true });

      // The HEAD sha's own real finding, REQUEST_CHANGES — written FIRST,
      // so its mtime is OLDER than the other SHA's files below.
      writeFileSync(
        path.join(dir, ".review", `frank-${headSha}-1000000000000000000-1.md`),
        "1. **P1** — a real finding at the head sha.\n\nVerdict: REQUEST_CHANGES\n"
      );
      writeFileSync(
        path.join(
          dir,
          ".review",
          `frank-${headSha}-1000000000000000000-1.final-message.txt`
        ),
        "1. **P1** — a real finding at the head sha.\n\nVerdict: REQUEST_CHANGES\n"
      );

      // A DIFFERENT sha's artifacts — written SECOND, so `ls -t` (mtime,
      // newest-first) would pick these over the head sha's own files above,
      // reproducing the round-3 bug. Must never surface in the head SHA's
      // triage table.
      writeFileSync(
        path.join(dir, ".review", `frank-${otherSha}-9999999999999999999-1.md`),
        "1. **P1** — a finding that belongs to a different commit entirely.\n\nVerdict: APPROVE\n"
      );
      writeFileSync(
        path.join(
          dir,
          ".review",
          `frank-${otherSha}-9999999999999999999-1.final-message.txt`
        ),
        "Verdict: APPROVE\n"
      );

      const result = runTriage(dir, "5");
      expect(result.status).toBe(0);
      const outFile = result.stdout.match(
        /Triage skeleton: (\S+)/
      )?.[1] as string;
      const body = execFileSync("cat", [outFile], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(body).toContain("| Frank  | REQUEST_CHANGES |");
      expect(body).toContain("a real finding at the head sha");
      expect(body).not.toContain("APPROVE");
      expect(body).not.toContain(otherSha);
      expect(body).not.toContain("belongs to a different commit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("picks the LATEST run id's report for the head SHA, and requires that SAME run's own verdict artifact — a newer (aborted) run must not inherit an OLDER run's approval at the same SHA (#348 round 3 P1 #2's exact shape)", () => {
    const dir = makeTempRepo();
    try {
      const sha = headShaOf(dir);
      mkdirSync(path.join(dir, ".review"), { recursive: true });

      // An older, genuinely completed run — real APPROVE, report and
      // verdict artifact paired at the same run id.
      writeFileSync(
        path.join(dir, ".review", `frank-${sha}-1000000000000000000-1.md`),
        "1. **P1** — none.\n\nVerdict: APPROVE\n"
      );
      writeFileSync(
        path.join(
          dir,
          ".review",
          `frank-${sha}-1000000000000000000-1.final-message.txt`
        ),
        "Verdict: APPROVE\n"
      );

      // A NEWER run (higher run id) at the SAME sha — its report exists
      // (frank.sh/george.sh's entry-point truncate, #348 round 4 rule 2,
      // "reserves" this run id even if the run then crashes) but is empty,
      // because this run never got further than that truncate. Deliberately
      // no matching final-message.txt for run 2000...-2 — the run stalled
      // or was killed before ever reaching completion.
      writeFileSync(
        path.join(dir, ".review", `frank-${sha}-2000000000000000000-2.md`),
        ""
      );

      const result = runTriage(dir, "6");
      expect(result.status).toBe(0);
      const outFile = result.stdout.match(
        /Triage skeleton: (\S+)/
      )?.[1] as string;
      const body = execFileSync("cat", [outFile], {
        cwd: dir,
        encoding: "utf8",
      });
      // Must read as "not run" for the latest attempt — never fall back to
      // the older run's real APPROVE.
      expect(body).toContain("| Frank  | not run |");
      expect(body).not.toContain("APPROVE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Entry-path: frank.sh / george.sh — real subprocess, stub codex/grok on PATH
// ---------------------------------------------------------------------------

const STUB_CODEX = `#!/usr/bin/env bash
# Test stub for codex exec. Mirrors two real Codex CLI behaviours:
#  1. It echoes its prompt argument back into the transcript it streams to
#     stdout. Invocation shape (frank.sh):
#       codex exec -c sandbox_mode="..." --skip-git-repo-check \\
#         -o <file> "<prompt>"
#  2. -o/--output-last-message writes ONLY the agent's own last message to
#     that file, never the streamed transcript (#348 round 2). This stub
#     locates the value following -o in "$@" the same way a real flag parser
#     would, rather than assuming its position.
if [ -n "\${STUB_CODEX_CRASH:-}" ]; then
  # #348 round 4: models codex being killed/crashing before it produces
  # ANYTHING — not even the prompt echo below — the same shape Frank's
  # round-3 P1 #1 named for grok ("killed while running, before the
  # completion artifact is ever (re)written"). frank.sh's own entry-point
  # truncation (rule 2) is what this scenario tests: \$LAST_MSG must already
  # be empty from before this stub ever ran, never a leftover from a prior
  # run at a different run id.
  echo "simulated crash: codex killed mid-run" >&2
  exit 1
fi

last="\${@: -1}"
printf '%s\\n' "$last"

out_file=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out_file="$arg"
  fi
  prev="$arg"
done

if [ -n "\${STUB_CODEX_VERDICT:-}" ]; then
  printf '\\nVerdict: %s\\n' "$STUB_CODEX_VERDICT"
  if [ -n "$out_file" ]; then
    printf 'Verdict: %s\\n' "$STUB_CODEX_VERDICT" > "$out_file"
  fi
fi

if [ -n "\${STUB_CODEX_DRAFT_THEN_STALL:-}" ]; then
  # #348 round 2's exact failure shape: a premature/draft verdict, then more
  # investigation, then the run stalls before a genuine final answer. The
  # transcript (stdout, tee'd to $REPORT) carries the draft verdict; the -o
  # file is deliberately never written here, because a real codex only
  # writes it on a genuine completion (codex exec --help) and this run does
  # not reach one.
  printf '\\nVerdict: APPROVE\\n\\nActually, let me keep investigating this further before concluding.\\n\\nChecking the error paths again...\\n\\nStill reviewing the edge cases here...\\n'
fi
`;

// Test stub for grok --output-format json (#348 round 3). george.sh always
// passes --output-format json now, and reads its verdict ONLY from the
// "text" field of the single JSON completion object this stub writes to
// stdout — never from stderr, never from a live-streamed tail. Real grok's
// json-mode contract (probed directly, round 2 and again round 3 via a live
// smoke call): exactly one JSON object, printed once, at genuine completion.
//
// STUB_GROK_JSON_TEXT carries the desired "text" field value (may contain
// newlines — env vars here are set on the spawned process's env object
// directly, never shell-parsed, so no escaping is needed). It is JSON-encoded
// by a small embedded node call rather than hand-escaped in bash, since a
// real reviewer's final answer routinely contains quotes and backticks.
const STUB_GROK = `#!/usr/bin/env bash
if [ -n "\${STUB_GROK_CRASH:-}" ]; then
  # #348 round 4 (Frank's round-3 P1 #1, concrete scenario): grok is killed
  # or crashes WHILE RUNNING, before it ever writes a completion object —
  # so george.sh's node -e extraction step is never reached. george.sh's own
  # entry-point truncation (rule 2) is what this scenario proves: \$JSON_OUT
  # and \$FINAL_MSG must already be empty from before this stub ever ran,
  # never a leftover from a prior run at a different run id.
  echo "simulated crash: grok killed mid-run" >&2
  exit 1
fi

if [ -n "\${STUB_GROK_STDERR_DRAFT:-}" ]; then
  # #348 round 3 (Frank at 0fa4d99, P1 #2)'s "streamed part": a
  # verdict-shaped line landing somewhere OTHER than the completion object's
  # own "text" field — grok's own logging/tool-call chatter on stderr, not a
  # genuine final answer. Must never be read as a verdict.
  printf 'Verdict: APPROVE\\n' >&2
fi

if [ -n "\${STUB_GROK_NO_OUTPUT:-}" ]; then
  # A genuine stall: nothing is ever printed to stdout — no completion
  # object at all.
  exit 0
fi

if [ -n "\${STUB_GROK_MALFORMED_JSON:-}" ]; then
  printf '{"text": "Verdict: APPROVE"'  # deliberately unterminated
  exit 0
fi

if [ -n "\${STUB_GROK_NO_TEXT_FIELD:-}" ]; then
  printf '{"stopReason": "end_turn"}\\n'
  exit 0
fi

if [ -n "\${STUB_GROK_JSON_TEXT+x}" ]; then
  node -e 'process.stdout.write(JSON.stringify({ text: process.env.STUB_GROK_JSON_TEXT, stopReason: "end_turn" }))'
  exit 0
fi

echo "test stub grok: no STUB_GROK_* scenario selected" >&2
exit 1
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

  it("FAILS the run when codex writes a premature draft verdict, keeps investigating, then stalls before a real final answer (#348 round 2, P1 — overrules round 1's REFUTE)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([FRANK_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_CODEX_DRAFT_THEN_STALL: "1",
          }),
        });
        // The streamed transcript ($REPORT) DOES contain an anchored
        // "Verdict: APPROVE" line — the draft — proving this is not just
        // the #348-round-1 "no verdict at all" shape. The run must still
        // fail, because the -o last-message file (what verdict_token() now
        // reads) was never written.
        expect(result.status).toBe(3);
        expect(result.stderr).toContain(
          "FAILED RUN: Frank produced no verdict — stalled or cancelled."
        );
      },
      { codex: STUB_CODEX }
    );
  });

  // ---------------------------------------------------------------------
  // #348 round 4 (PR #510 round 3 triage). Filenames are now keyed by SHA
  // AND a per-run id (RUN_ID) — frank.sh reads $REVIEW_RUN_ID when set, so
  // these tests can pin the exact artifact path a run will use instead of
  // guessing the freshly-generated one. Both tests below are new this
  // round and are written to go RED against the round-3 code at `afcbf16`
  // (confirmed manually, see the PR triage comment): round-3 frank.sh names
  // its artifacts "frank-$SHA.*" (no run id, no $REVIEW_RUN_ID override), so
  // a stale same-SHA artifact planted at that fixed name — from what round 4
  // treats as "a different run" — is the SAME file a round-3 rerun would
  // read, and round 3's `rm -f "$LAST_MSG"` sits AFTER prompt/diff
  // construction, not at entry, so the crash case below (which dies before
  // that line is ever reached) leaves the stale approval untouched.
  // ---------------------------------------------------------------------

  it("FAILS a rerun at the SAME sha AND the SAME run id when codex writes no final message, even though a stale APPROVE at that exact path is still on disk (#348 round 3 P1 #1, defense in depth under round 4's SHA+RUN_ID keying — rule 2's entry-point truncate)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
          cwd: dir,
          encoding: "utf8",
        }).trim();
        const runId = "1000000000000000000-11111";
        const lastMsgPath = path.join(
          dir,
          ".review",
          `frank-${sha}-${runId}.final-message.txt`
        );
        mkdirSync(path.dirname(lastMsgPath), { recursive: true });
        // Pre-seed a stale artifact at the EXACT path this run will use
        // (pinned via REVIEW_RUN_ID) — the residual gap rule 2 defends
        // against even though RUN_ID makes a real collision vanishingly
        // unlikely: a rerun whose codex produces no final message must not
        // silently inherit this leftover approval.
        writeFileSync(lastMsgPath, "Verdict: APPROVE\n");

        // This run's stub codex only echoes the prompt back (no
        // STUB_CODEX_VERDICT set), so it never (re)writes the -o file —
        // modeling a genuine stall at the same sha+run id as the stale file.
        const result = runBash([FRANK_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            REVIEW_RUN_ID: runId,
          }),
        });

        expect(result.status).toBe(3);
        expect(result.stderr).toContain(
          "FAILED RUN: Frank produced no verdict — stalled or cancelled."
        );
        expect(readFileSync(lastMsgPath, "utf8")).toBe("");
      },
      { codex: STUB_CODEX }
    );
  });

  it("does NOT inherit a stale APPROVE left by a DIFFERENT, earlier run at the same SHA (#348 round 4 — every artifact is keyed by SHA and a per-run id, so a different run's file can never be mistaken for this run's own)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
          cwd: dir,
          encoding: "utf8",
        }).trim();
        const staleRunId = "0000000000000000001-99999";
        const staleLastMsgPath = path.join(
          dir,
          ".review",
          `frank-${sha}-${staleRunId}.final-message.txt`
        );
        mkdirSync(path.dirname(staleLastMsgPath), { recursive: true });
        writeFileSync(staleLastMsgPath, "Verdict: APPROVE\n");

        // This run gets its own, different, auto-generated RUN_ID (no
        // override) and its stub codex never writes -o — a genuine stall,
        // at the same SHA as the older run above but a different run id.
        const result = runBash([FRANK_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({ PATH: `${stubBin}:${process.env.PATH}` }),
        });

        expect(result.status).toBe(3);
        expect(result.stderr).toContain(
          "FAILED RUN: Frank produced no verdict — stalled or cancelled."
        );
        // The older run's own artifact is untouched — round 4 isolates by
        // naming, it does not go hunting for other runs' files to clear.
        expect(readFileSync(staleLastMsgPath, "utf8")).toBe(
          "Verdict: APPROVE\n"
        );
      },
      { codex: STUB_CODEX }
    );
  });

  it("a run that aborts before codex ever writes anything (crashed/killed) still leaves no usable verdict, even at a path pre-seeded with a stale APPROVE (#348 round 4 rule 2 — truncated at entry, before ANYTHING in the script, including the codex invocation itself, can abort)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
          cwd: dir,
          encoding: "utf8",
        }).trim();
        const runId = "2000000000000000000-22222";
        const lastMsgPath = path.join(
          dir,
          ".review",
          `frank-${sha}-${runId}.final-message.txt`
        );
        mkdirSync(path.dirname(lastMsgPath), { recursive: true });
        writeFileSync(lastMsgPath, "Verdict: APPROVE\n");

        const result = runBash([FRANK_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            REVIEW_RUN_ID: runId,
            STUB_CODEX_CRASH: "1",
          }),
        });

        // The script itself dies (via `set -e`+`pipefail` on codex's
        // nonzero exit) rather than reaching its own "FAILED RUN" message —
        // that is fine; the property under test is the ARTIFACT, which a
        // LATER triage.sh read would trust. It must never still say APPROVE.
        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("Report: ");
        expect(readFileSync(lastMsgPath, "utf8")).toBe("");
      },
      { codex: STUB_CODEX }
    );
  });
});

describe("george.sh entry path (real subprocess, stub grok --output-format json on PATH, #348 round 3)", () => {
  it("FAILS the run when grok's completion JSON has no 'text' field", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_NO_TEXT_FIELD: "1",
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

  it("FAILS the run when grok's completion JSON is truncated/malformed", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_MALFORMED_JSON: "1",
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

  it("FAILS the run when grok produces no output at all (a genuine stall — no completion object ever printed)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_NO_OUTPUT: "1",
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

  it("FAILS the run when a verdict-shaped line appears only on stderr, never in the completion JSON's own 'text' field (#348 round 3, P1 #2 — the 'streamed part' must never be read for a verdict)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_JSON_TEXT:
              "Some findings so far. Still need to check one more call site before concluding.",
            STUB_GROK_STDERR_DRAFT: "1",
          }),
        });
        // $REPORT (george.sh) DOES carry the stderr "Verdict: APPROVE" line,
        // in its own clearly-labelled diagnostic section — proving this is
        // not the #348-round-1 "nothing captured at all" shape. The run must
        // still fail, because verdict_token() is handed only the extracted
        // "text" field, which has no anchored verdict line.
        expect(result.status).toBe(3);
        expect(result.stderr).toContain(
          "FAILED RUN: George produced no verdict — stalled or cancelled, not a pass."
        );
      },
      { grok: STUB_GROK }
    );
  });

  it("FAILS the run when the completion JSON's 'text' field only mentions the verdict words in prose (#220's prose shape, now inside the extracted final answer)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_JSON_TEXT:
              "Whatever we conclude, whether to APPROVE or REQUEST_CHANGES is ultimately a judgment call for the team.",
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

  it("passes with a real anchored verdict line in the completion JSON's 'text' field", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_JSON_TEXT:
              "Some findings here.\n\n**Verdict:** REQUEST_CHANGES\n",
          }),
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Report: ");
      },
      { grok: STUB_GROK }
    );
  });

  it("passes with a real verdict line followed by one short trailing wrap-up sentence (the archived real George report shape)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_JSON_TEXT:
              "## Verdict\n\n**REQUEST_CHANGES**\n\nP2-1 is a real contract bug; P3s can go to issues.\n",
          }),
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Report: ");
      },
      { grok: STUB_GROK }
    );
  });

  // ---------------------------------------------------------------------
  // #348 round 4 (PR #510 round 3 triage, Frank's P1 #1). Round 3 cleared
  // $JSON_OUT before every grok invocation but NOT $FINAL_MSG — the file
  // verdict_token() actually reads — so a run killed WHILE grok is running
  // (before the node -e extraction step further down is ever reached) left
  // a prior run's stale approval untouched. Filenames are now keyed by SHA
  // AND a per-run id; george.sh reads $REVIEW_RUN_ID when set, so these
  // tests can pin the exact artifact path a run will use. Both tests below
  // are new this round and are written to go RED against the round-3 code
  // at `afcbf16` (confirmed manually, see the PR triage comment): round-3
  // george.sh names its artifacts "george-$SHA.*" (no run id, no
  // $REVIEW_RUN_ID override, no entry-point truncate of $FINAL_MSG), so a
  // stale same-SHA artifact planted at that fixed name is exactly what a
  // round-3 rerun killed mid-grok leaves behind.
  // ---------------------------------------------------------------------

  it("a run killed WHILE grok is running (before the completion JSON, let alone the extraction step, is ever produced) still leaves no usable verdict, even at a path pre-seeded with a stale APPROVE (#348 round 3 P1 #1 — the exact scenario; round 4 rule 2 truncates at entry, before ANYTHING in the script, including the grok invocation itself, can abort)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
          cwd: dir,
          encoding: "utf8",
        }).trim();
        const runId = "3000000000000000000-33333";
        const finalMsgPath = path.join(
          dir,
          ".review",
          `george-${sha}-${runId}.final-message.txt`
        );
        mkdirSync(path.dirname(finalMsgPath), { recursive: true });
        writeFileSync(finalMsgPath, "Verdict: APPROVE\n");

        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            REVIEW_RUN_ID: runId,
            STUB_GROK_CRASH: "1",
          }),
        });

        // The script itself dies (via `set -e` on grok's nonzero exit)
        // rather than reaching its own "FAILED RUN" message — that is fine;
        // the property under test is the ARTIFACT, which a LATER triage.sh
        // read would trust. It must never still say APPROVE.
        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("Report: ");
        expect(readFileSync(finalMsgPath, "utf8")).toBe("");
      },
      { grok: STUB_GROK }
    );
  });

  it("does NOT inherit a stale APPROVE left by a DIFFERENT, earlier run at the same SHA (#348 round 4 — every artifact is keyed by SHA and a per-run id, so a different run's file can never be mistaken for this run's own)", () => {
    withReviewFixture(
      ({ dir, baseSha, stubBin }) => {
        const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
          cwd: dir,
          encoding: "utf8",
        }).trim();
        const staleRunId = "0000000000000000002-88888";
        const staleFinalMsgPath = path.join(
          dir,
          ".review",
          `george-${sha}-${staleRunId}.final-message.txt`
        );
        mkdirSync(path.dirname(staleFinalMsgPath), { recursive: true });
        writeFileSync(staleFinalMsgPath, "Verdict: APPROVE\n");

        // This run gets its own, different, auto-generated RUN_ID (no
        // override) and its stub grok crashes immediately — modeling a
        // genuine kill mid-run, at the same SHA as the older run above but
        // a different run id.
        const result = runBash([GEORGE_SH, baseSha], {
          cwd: dir,
          env: cleanEnv({
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_GROK_CRASH: "1",
          }),
        });

        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("Report: ");
        // The older run's own artifact is untouched — round 4 isolates by
        // naming, it does not go hunting for other runs' files to clear.
        expect(readFileSync(staleFinalMsgPath, "utf8")).toBe(
          "Verdict: APPROVE\n"
        );
      },
      { grok: STUB_GROK }
    );
  });
});
