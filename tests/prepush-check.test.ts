import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkEngines,
  findNegatedClosures,
  isMainEntry,
  isTestFile,
  parseAddedLines,
  rangeMinimum,
  run,
  satisfies,
  scanAddedLines,
} from "../scripts/prepush-check.mjs";

/**
 * scripts/prepush-check.mjs is a gate, so it is tested in both states
 * (AGENTS.md, "A gate is tested in both states"): each FAIL rule goes red on
 * the state it exists to catch and stays green on the legitimate states
 * beside it, each WARN rule prints without failing, and the entry path runs
 * as a real subprocess against scratch repositories, including the
 * missing-context paths that must exit 0.
 */

// Same safety net as tests/check-commit-messages.test.ts: a scratch-repo git
// command must never move this checkout's HEAD.
const REAL_REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const REAL_HEAD_BEFORE = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  cwd: REAL_REPO_ROOT,
}).trim();

afterEach(() => {
  const headNow = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    cwd: REAL_REPO_ROOT,
  }).trim();
  expect(headNow).toBe(REAL_HEAD_BEFORE);
});

// git hooks export these into every child process; see the docblock of
// `cleanGitEnv` in tests/check-commit-messages.test.ts.
const GIT_ENV_KEYS_TO_STRIP = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS_TO_STRIP) delete env[key];
  // Stop git discovery at the tmpdir so a scratch dir that is not a repo
  // cannot resolve to one above it.
  env.GIT_CEILING_DIRECTORIES = tmpdir();
  return env;
}

describe("findNegatedClosures — rule (a)", () => {
  it.each([
    ["This does not close #108.", "108"],
    ["It doesn't fix #9 yet.", "9"],
    ["This won't resolve #3", "3"],
    ["does not fully close #12", "12"],
    ["Never closes: #44", "44"],
    ["no longer fixes unfoldingWord/tc-mobile#7", "7"],
    ["DOES NOT CLOSE #5", "5"],
  ])("flags %j", (message, issue) => {
    expect(findNegatedClosures(message).map((h) => h.issue)).toEqual([issue]);
  });

  it.each([
    "Closes #12",
    "Part of #12",
    "Fixes #3 and resolves #4",
    "This is not closing #5 (closing is not a keyword)",
    "Does not touch the prefix #7 path",
    "Not a fix; see #8",
  ])("does not flag the legitimate message %j", (message) => {
    expect(findNegatedClosures(message)).toEqual([]);
  });

  it("reports every hit in a multi-line body", () => {
    const hits = findNegatedClosures(
      "fix: x\n\nThis does not close #1.\nIt also doesn't fix #2.\nCloses #3\n"
    );
    expect(hits.map((h) => h.issue)).toEqual(["1", "2"]);
  });
});

describe("satisfies / rangeMinimum — rule (b)'s range reader", () => {
  it("reads this repo's floor as its lowest admitted version", () => {
    expect(rangeMinimum("^22.12.0 || >=24.0.0")).toBe("22.12.0");
    expect(rangeMinimum(">=24.0.0 || ^22.12.0")).toBe("22.12.0");
    expect(rangeMinimum(">=18")).toBe("18.0.0");
    expect(rangeMinimum("<20")).toBe(null);
    expect(rangeMinimum(undefined)).toBe(null);
  });

  it.each([
    // The #989/#990 chain: both exclude 22.12.0.
    ["^22.13.0", false],
    ["^22.22.2", false],
    ["^20.19.0 || >=22.13.0", false],
    [">=24", false],
    ["^20.19.0", false],
    ["~22.11", false],
    ["22.13 - 24", false],
    ["<22.12.0", false],
    [">22.12.0", false],
    ["^0.0.3", false],
    // Admitting forms.
    ["^20.19.0 || >=22.12.0", true],
    ["^18.18.0 || ^20.9.0 || >=21.1.0", true],
    [">=22.12", true],
    [">= 18", true],
    ["18 - 22", true],
    ["~22.12", true],
    ["22.x", true],
    ["*", true],
    [">22.11 <23", true],
    ["<=22.12.0", true],
    ["=22.12.0", true],
    ["v22.12.0", true],
  ])("admits 22.12.0 under %j: %s", (range, expected) => {
    expect(satisfies("22.12.0", range)).toBe(expected);
  });

  it("returns null for a range it cannot read, so the caller skips", () => {
    expect(satisfies("22.12.0", "not a range")).toBe(null);
    expect(satisfies("22.12.0", 22)).toBe(null);
  });
});

describe("checkEngines — rule (b)", () => {
  const manifests: Record<
    string,
    { version: string; engines?: { node?: string } }
  > = {
    bad: { version: "10.0.0", engines: { node: "^22.13.0" } },
    good: { version: "1.0.0", engines: { node: "^20.19.0 || >=22.12.0" } },
    plain: { version: "2.0.0" },
    odd: { version: "3.0.0", engines: { node: "whenever" } },
  };
  const read = (name: string) => manifests[name] ?? null;

  it("fails a dependency whose engines exclude the floor", () => {
    expect(checkEngines("22.12.0", ["bad"], read)).toEqual({
      failures: [{ name: "bad", version: "10.0.0", range: "^22.13.0" }],
      notes: [],
    });
  });

  it("passes a dependency that admits the floor and one with no engines", () => {
    expect(checkEngines("22.12.0", ["good", "plain"], read)).toEqual({
      failures: [],
      notes: [],
    });
  });

  it("notes, never fails, an uninstalled dependency or an unreadable range", () => {
    const { failures, notes } = checkEngines(
      "22.12.0",
      ["missing", "odd"],
      read
    );
    expect(failures).toEqual([]);
    expect(notes).toEqual([
      "missing: not installed, skipped (run npm ci)",
      'odd@3.0.0: engines.node "whenever" not readable, skipped',
    ]);
  });
});

describe("parseAddedLines", () => {
  it("returns added lines with their new-file line numbers", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@ function x() {",
      "+const one = 1;",
      "+const two = 2;",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "src/a.ts", line: 4, text: "const one = 1;" },
      { file: "src/a.ts", line: 5, text: "const two = 2;" },
      { file: "src/a.ts", line: 12, text: "new" },
    ]);
  });
});

describe("scanAddedLines — rules (c), (d), (e)", () => {
  const noFile = () => null;

  it("recognises test files", () => {
    expect(isTestFile("tests/a.test.ts")).toBe(true);
    expect(isTestFile("e2e/b.spec.ts")).toBe(true);
    expect(isTestFile("src/a.ts")).toBe(false);
  });

  it("(c) warns on a verification claim, with file:line", () => {
    const warnings = scanAddedLines(
      [
        { file: "src/a.ts", line: 3, text: "// Verified on iOS." },
        { file: "src/b.ts", line: 4, text: "// Licence obligations met." },
        { file: "src/c.ts", line: 5, text: "// the recorder has no renderer" },
        { file: "docs/x.md", line: 6, text: "Tested on a Pixel." },
      ],
      noFile
    );
    expect(warnings.map((w) => `${w.rule} ${w.where}`)).toEqual([
      "c src/a.ts:3",
      "c src/b.ts:4",
      "c src/c.ts:5",
      "c docs/x.md:6",
    ]);
  });

  it("(c) stays quiet on the honest negated form and on the run record", () => {
    expect(
      scanAddedLines(
        [
          { file: "src/a.ts", line: 1, text: "// Not verified on a device." },
          { file: "src/a.ts", line: 2, text: "// This is unverified." },
          {
            file: "docs/progress_tracker.md",
            line: 3,
            text: "Verified on staging.",
          },
        ],
        noFile
      )
    ).toEqual([]);
  });

  it("(d) warns on a loose negative assertion in a test, not elsewhere", () => {
    const warnings = scanAddedLines(
      [
        { file: "tests/a.test.ts", line: 7, text: "expect(x).not.toBe(3);" },
        {
          file: "tests/a.test.ts",
          line: 8,
          text: "expect(y).not.toEqual([]);",
        },
        { file: "src/a.ts", line: 9, text: "// expect(x).not.toBe(3)" },
      ],
      noFile
    );
    expect(warnings.map((w) => `${w.rule} ${w.where}`)).toEqual([
      "d tests/a.test.ts:7",
      "d tests/a.test.ts:8",
    ]);
  });

  it("(e) warns on indexOf or a regex only in a test that reads CSS or config", () => {
    const files: Record<string, string> = {
      "tests/css.test.ts":
        'const css = readFileSync("src/app/styles/3-components.css", "utf8");',
      "tests/plain.test.ts": "const xs = [1, 2, 3];",
    };
    const warnings = scanAddedLines(
      [
        {
          file: "tests/css.test.ts",
          line: 2,
          text: 'const at = css.indexOf(".share-scrim");',
        },
        {
          file: "tests/css.test.ts",
          line: 3,
          text: "expect(css).toMatch(/--p-cool/);",
        },
        { file: "tests/plain.test.ts", line: 4, text: "xs.indexOf(2);" },
      ],
      (file) => files[file] ?? null
    );
    expect(warnings.map((w) => `${w.rule} ${w.where}`)).toEqual([
      "e tests/css.test.ts:2",
      "e tests/css.test.ts:3",
    ]);
  });
});

describe("isMainEntry", () => {
  it("is false when no argv path is given (import, not execution)", () => {
    expect(isMainEntry("file:///a/b.mjs", undefined)).toBe(false);
  });
});

describe("run — injected git, missing context", () => {
  it("skips with exit 0 and a reason when origin/develop is missing", () => {
    const lines: string[] = [];
    const code = run({
      git: (args) => {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
          return "/repo\n";
        }
        throw new Error("fatal: Needed a single revision");
      },
      log: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines).toEqual([
      "SKIP: origin/develop is not available here (run `git fetch origin develop`); prepush check not run.",
    ]);
  });
});

describe("CLI entry point (real subprocess against scratch repositories)", () => {
  const SCRIPT = path.join(
    import.meta.dirname,
    "..",
    "scripts",
    "prepush-check.mjs"
  );

  const FLOOR_PKG = {
    name: "scratch",
    private: true,
    engines: { node: "^22.12.0 || >=24.0.0" },
    devDependencies: { good: "1.0.0", plain: "2.0.0" } as Record<
      string,
      string
    >,
  };

  function runCli(cwd: string) {
    try {
      const stdout = execFileSync("node", [SCRIPT], {
        encoding: "utf8",
        timeout: 10_000,
        cwd,
        env: cleanGitEnv(),
      });
      return { status: 0, stdout };
    } catch (err) {
      const e = err as { status: number | null; stdout: string };
      return { status: e.status, stdout: e.stdout };
    }
  }

  function makeDir(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    if (dir === REAL_REPO_ROOT || !dir.startsWith(tmpdir())) {
      throw new Error(`scratch dir ${dir} is not isolated`);
    }
    return dir;
  }

  function gitIn(dir: string) {
    return (args: string[]) =>
      execFileSync(
        "git",
        ["--git-dir", path.join(dir, ".git"), "--work-tree", dir, ...args],
        { encoding: "utf8", env: cleanGitEnv() }
      );
  }

  function write(dir: string, file: string, content: string) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  function installDep(dir: string, name: string, engines?: string) {
    write(
      dir,
      `node_modules/${name}/package.json`,
      JSON.stringify({
        name,
        version: "1.0.0",
        ...(engines ? { engines: { node: engines } } : {}),
      })
    );
  }

  /**
   * A repo on branch `feature`, one commit past `origin/develop`, with the
   * base package.json committed and `good` (admits the floor) and `plain`
   * (no engines) installed. `withOrigin: false` leaves origin/develop unset.
   */
  function initScratchRepo({ withOrigin = true } = {}): string {
    const dir = makeDir("prepush-check-");
    execFileSync("git", ["init", "-q", "-b", "develop", dir], {
      encoding: "utf8",
      env: cleanGitEnv(),
    });
    const git = gitIn(dir);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    write(dir, ".gitignore", "node_modules\n");
    write(dir, "package.json", JSON.stringify(FLOOR_PKG, null, 2));
    installDep(dir, "good", "^20.19.0 || >=22.12.0");
    installDep(dir, "plain");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "chore: base", "-m", "Base commit body."]);
    if (withOrigin) {
      git(["update-ref", "refs/remotes/origin/develop", "HEAD"]);
    }
    git(["checkout", "-q", "-b", "feature"]);
    return dir;
  }

  function commit(dir: string, subject: string, body: string) {
    const git = gitIn(dir);
    git(["add", "-A"]);
    git(["commit", "-q", "--allow-empty", "-m", subject, "-m", body]);
  }

  it("exits 0 with a reason when origin/develop is missing", () => {
    const dir = initScratchRepo({ withOrigin: false });
    try {
      const result = runCli(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SKIP: origin/develop is not available");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 with a reason outside a git work tree", () => {
    const dir = makeDir("prepush-check-nogit-");
    try {
      const result = runCli(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SKIP: not inside a git work tree");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 with a reason when there is no merge base", () => {
    const dir = initScratchRepo({ withOrigin: false });
    try {
      const git = gitIn(dir);
      git(["checkout", "-q", "--orphan", "unrelated"]);
      commit(dir, "chore: unrelated root", "Unrelated history.");
      git(["update-ref", "refs/remotes/origin/develop", "HEAD"]);
      git(["checkout", "-q", "feature"]);
      const result = runCli(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SKIP: no merge base");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (a) RED.
  it("fails a commit whose body negates a closing keyword", () => {
    const dir = initScratchRepo();
    try {
      commit(dir, "fix(x): a slice", "This does not close #108.");
      const result = runCli(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(
        /^FAIL \(a\) [0-9a-f]{7}: "not close #108" closes #108 on merge/m
      );
      expect(result.stdout).toContain("prepush-check: FAIL, 1 failure(s)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (a) GREEN.
  it("passes plain Closes and Part of messages", () => {
    const dir = initScratchRepo();
    try {
      commit(dir, "fix(x): the whole issue", "Closes #5");
      commit(dir, "fix(y): a slice", "Part of #6");
      const result = runCli(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "prepush-check: PASS, 0 failure(s), 0 warning(s)"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (b) RED.
  it("fails a dependency whose installed engines exclude the floor", () => {
    const dir = initScratchRepo();
    try {
      write(
        dir,
        "package.json",
        JSON.stringify(
          {
            ...FLOOR_PKG,
            devDependencies: { ...FLOOR_PKG.devDependencies, bad: "10.0.0" },
          },
          null,
          2
        )
      );
      installDep(dir, "bad", "^22.13.0");
      commit(dir, "chore(deps): add bad", "Adds a dependency.");
      const result = runCli(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'FAIL (b) bad@1.0.0: engines.node "^22.13.0" does not admit 22.12.0'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (b) GREEN: an admitting dep and a dep with no engines field.
  it("passes when package.json changes and every dependency admits the floor", () => {
    const dir = initScratchRepo();
    try {
      write(
        dir,
        "package.json",
        JSON.stringify({ ...FLOOR_PKG, description: "changed" }, null, 2)
      );
      commit(dir, "chore: touch package.json", "Triggers rule (b).");
      const result = runCli(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "prepush-check: PASS, 0 failure(s), 0 warning(s)"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (b) SCOPE: a branch that did not change dependencies is not blocked by
  // one already installed.
  it("does not run rule (b) when the range leaves package files alone", () => {
    const dir = initScratchRepo();
    try {
      installDep(dir, "good", "^22.13.0");
      write(dir, "src/a.ts", "export const a = 1;\n");
      commit(dir, "feat: add a", "No dependency change.");
      const result = runCli(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("prepush-check: PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (c)-(e): print, exit 0.
  it("prints each warning with file:line and still exits 0", () => {
    const dir = initScratchRepo();
    try {
      write(
        dir,
        "tests/x.test.ts",
        [
          'const css = readFileSync("src/x.css", "utf8");',
          "// Verified on iOS.",
          "expect(1).not.toBe(2);",
          'const at = css.indexOf(".rule");',
          "",
        ].join("\n")
      );
      commit(dir, "test: add x", "Adds a test.");
      const result = runCli(dir);
      expect(result.status).toBe(0);
      const warnLines = result.stdout
        .split("\n")
        .filter((l) => l.startsWith("WARN"))
        .map((l) => l.split(": ")[0]);
      expect(warnLines).toEqual([
        "WARN (c) tests/x.test.ts:2",
        "WARN (d) tests/x.test.ts:3",
        "WARN (e) tests/x.test.ts:4",
      ]);
      expect(result.stdout).toContain(
        "prepush-check: PASS, 0 failure(s), 3 warning(s)"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
