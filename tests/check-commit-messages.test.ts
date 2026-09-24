import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkMessage,
  checkRange,
  hasNonBlankBody,
  isMainEntry,
  isMergeSubject,
  parseArgs,
  parseLogRecords,
} from "../scripts/check-commit-messages.mjs";

/**
 * AGENTS.md ("Conventions") requires Conventional Commits with a subject AND
 * a body, neither blank. Nothing enforced that until #840 R3 — #776 and the
 * review bench's fix-lane commits on #792 (`7a41ee29d`) and #793
 * (`21108948e`) landed on `develop` with a subject and no body. Both are
 * expected to keep failing this check; that is the point.
 *
 * "A gate is tested in both states" (AGENTS.md): the sections below cover
 * the red case (subject only) and every green case (subject+body, merge,
 * Dependabot-shaped) for both entry points — the pure functions and the real
 * CLI subprocess, per the same rule's "test a gate script's entry path and
 * defaults, not just its exported function."
 */

describe("hasNonBlankBody / isMergeSubject", () => {
  it("finds no body after a subject-only message", () => {
    expect(hasNonBlankBody("fix(x): subject only\n")).toEqual({
      subject: "fix(x): subject only",
      hasBody: false,
    });
  });

  it("finds a body when a non-blank line follows the subject", () => {
    expect(hasNonBlankBody("fix(x): subject\n\nWhy this changed.\n")).toEqual({
      subject: "fix(x): subject",
      hasBody: true,
    });
  });

  it("ignores comment lines (default git comment char) on both sides", () => {
    const raw =
      "# comment before\nfix(x): subject\n# comment instead of body\n";
    expect(hasNonBlankBody(raw)).toEqual({
      subject: "fix(x): subject",
      hasBody: false,
    });
  });

  it("treats an empty/whitespace-only message as no subject, no body", () => {
    expect(hasNonBlankBody("   \n\n  \n")).toEqual({
      subject: "",
      hasBody: false,
    });
  });

  it("recognizes a merge subject", () => {
    expect(isMergeSubject("Merge pull request #1 from x/y")).toBe(true);
    expect(isMergeSubject("Merge branch 'develop'")).toBe(true);
    expect(isMergeSubject("fix(x): not a merge")).toBe(false);
  });
});

describe("checkMessage — the rule both entry points share", () => {
  // THE RED CASE.
  it("rejects a subject with no non-blank body", () => {
    const result = checkMessage("fix(x): subject only, no body\n");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/subject but no non-blank body/);
  });

  // THE GREEN CASES.
  it("accepts a subject with a real body", () => {
    const result = checkMessage(
      "fix(x): subject\n\nThis explains why the change was made.\n"
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a merge commit even with no body", () => {
    const result = checkMessage(
      "Merge pull request #999 from unfoldingWord/some-branch\n"
    );
    expect(result.ok).toBe(true);
  });

  // Dependabot's actual message shape in this repo (commit bb9318ccd0,
  // `chore(deps-dev): bump lint-staged from 16.4.0 to 17.5.1`, `git log
  // --all --author=dependabot`): a changelog body plus an
  // `updated-dependencies` / `Signed-off-by` trailer block. It already has a
  // non-blank body, so it needs no separate code exemption — this test pins
  // that observation as a contract, not a claim that Dependabot's template
  // can never change.
  it("accepts a Dependabot-shaped body (observed shape, no special-casing needed)", () => {
    const result = checkMessage(
      [
        "chore(deps-dev): bump lint-staged from 16.4.0 to 17.5.1",
        "",
        "Bumps lint-staged from 16.4.0 to 17.5.1.",
        "",
        "---",
        "updated-dependencies:",
        "- dependency-name: lint-staged",
        "...",
        "",
        "Signed-off-by: dependabot[bot] <support@github.com>",
        "",
      ].join("\n")
    );
    expect(result.ok).toBe(true);
  });

  it("does not gate an empty message (a different, pre-existing failure)", () => {
    expect(checkMessage("\n").ok).toBe(true);
  });
});

describe("parseLogRecords", () => {
  it("splits the git log record/field separators back into sha + body", () => {
    const stdout =
      "\naaa\x1fsubject one\n\nbody one\n\x1e\nbbb\x1fsubject two\n\x1e";
    expect(parseLogRecords(stdout)).toEqual([
      { sha: "aaa", body: "subject one\n\nbody one\n" },
      { sha: "bbb", body: "subject two\n" },
    ]);
  });

  it("returns an empty array for empty stdout (empty range)", () => {
    expect(parseLogRecords("")).toEqual([]);
  });
});

describe("checkRange — the CI form, against an injected git log", () => {
  it("reports failures for the bodyless commits and passes the rest", () => {
    const RS = "\x1e";
    const FS = "\x1f";
    const stdout = [
      `aaa1111${FS}fix(x): good commit\n\nReal body.\n${RS}`,
      `bbb2222${FS}fix(x): bad commit, no body\n${RS}`,
      `ccc3333${FS}chore: also no body\n${RS}`,
    ].join("\n");
    const { results, failures } = checkRange("base..head", {
      runGit: () => stdout,
    });
    expect(results).toHaveLength(3);
    expect(failures.map((f) => f.sha)).toEqual(["bbb2222", "ccc3333"]);
  });

  it("passes with zero failures when every commit has a body", () => {
    const RS = "\x1e";
    const FS = "\x1f";
    const stdout = `aaa1111${FS}fix(x): good\n\nBody.\n${RS}`;
    const { failures } = checkRange("base..head", { runGit: () => stdout });
    expect(failures).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("parses file mode from a bare positional argument", () => {
    expect(parseArgs(["/tmp/COMMIT_EDITMSG"])).toEqual({
      mode: "file",
      filePath: "/tmp/COMMIT_EDITMSG",
    });
  });

  it("parses range mode from --range", () => {
    expect(parseArgs(["--range", "origin/develop..HEAD"])).toEqual({
      mode: "range",
      range: "origin/develop..HEAD",
    });
  });

  it("throws when --range has no value", () => {
    expect(() => parseArgs(["--range"])).toThrow(/requires/);
  });

  it("throws when no argument is given at all", () => {
    expect(() => parseArgs([])).toThrow(/usage/);
  });
});

describe("isMainEntry", () => {
  it("is false when no argv path is given (import, not execution)", () => {
    expect(isMainEntry("file:///a/b.mjs", undefined)).toBe(false);
  });
});

describe("CLI entry point (real subprocess, not just the exported functions)", () => {
  // AGENTS.md, "A gate is tested in both states": every test above exercises
  // the exported functions directly, but nothing spawns the actual script —
  // the bottom-of-file `if (isMainEntry(...)) { main(); }` call could be
  // deleted and every test above would still pass. See
  // tests/check-deploy.test.ts for the same rationale on the sibling script.
  const SCRIPT = path.join(
    import.meta.dirname,
    "..",
    "scripts",
    "check-commit-messages.mjs"
  );

  function runCli(args: string[], cwd?: string) {
    try {
      const stdout = execFileSync("node", [SCRIPT, ...args], {
        encoding: "utf8",
        timeout: 10_000,
        cwd,
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as {
        status: number | null;
        stdout: string;
        stderr: string;
      };
      return { status: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  }

  // FILE MODE, RED.
  it("exits non-zero on a real subject-only message file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "commit-msg-file-red-"));
    try {
      const file = path.join(dir, "COMMIT_EDITMSG");
      writeFileSync(file, "fix(x): subject only, no body\n");
      const result = runCli([file]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no non-blank body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // FILE MODE, GREEN.
  it("exits zero on a real subject+body message file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "commit-msg-file-green-"));
    try {
      const file = path.join(dir, "COMMIT_EDITMSG");
      writeFileSync(file, "fix(x): subject\n\nBody explaining why.\n");
      const result = runCli([file]);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // FILE MODE, GREEN (merge).
  it("exits zero on a real merge-commit message file with no body", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "commit-msg-file-merge-"));
    try {
      const file = path.join(dir, "COMMIT_EDITMSG");
      writeFileSync(
        file,
        "Merge pull request #999 from unfoldingWord/some-branch\n"
      );
      const result = runCli([file]);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero with an unrecognized-argument message when given nothing", () => {
    const result = runCli([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL:");
    expect(result.stderr).toContain("usage");
  });

  // RANGE MODE, against a real scratch git repository — both states, and a
  // real merge commit excluded by `git log --no-merges` itself rather than
  // by the subject-based allowance file mode relies on.
  function initScratchRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "commit-msg-range-"));
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git([
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "chore: base",
      "-m",
      "Base commit body.",
    ]);
    git(["checkout", "-q", "-b", "feature"]);
    return dir;
  }

  it("passes a range where every non-merge commit has a body, merge commit included and excluded", () => {
    const dir = initScratchRepo();
    try {
      const git = (args: string[]) =>
        execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      git([
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "fix(x): good commit",
        "-m",
        "Real body.",
      ]);
      git(["checkout", "-q", "-b", "other"]);
      // A merge-commit-only, bodyless subject reaches this range ONLY as the
      // merge commit itself — `--no-merges` must exclude it for this to pass.
      git(["checkout", "-q", "feature"]);
      git([
        "merge",
        "-q",
        "--no-ff",
        "other",
        "-m",
        "Merge branch 'other' into feature",
      ]);
      const result = runCli(["--range", "master..feature"], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a range containing a real non-merge, bodyless commit, and reports its short sha", () => {
    const dir = initScratchRepo();
    try {
      const git = (args: string[]) =>
        execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      git([
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "fix(x): bad commit, no body",
      ]);
      const result = runCli(["--range", "master..feature"], dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("bad commit, no body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
