import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { COLLATERAL_SURFACES } from "../scripts/check-pr-body.mjs";
import {
  RULES,
  classify,
  formatReport,
  parseDiff,
} from "../scripts/collateral.mjs";

/**
 * #1442. `collateral.mjs` pre-fills the seven Collateral surfaces from a
 * diff. Each rule is tested for a path it must hit and a near-miss it must
 * not, the pre-fill is tested against the PR-body gate (an unedited pre-fill
 * must NOT pass), and the real CLI runs against a scratch repository.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "collateral.mjs");

const GIT_ENV_KEYS = [
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
  for (const key of GIT_ENV_KEYS) delete env[key];
  return env;
}
const REAL_HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  cwd: ROOT,
}).trim();
afterEach(() => {
  const now = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    cwd: ROOT,
  }).trim();
  expect(now).toBe(REAL_HEAD);
});

const change = (p: string, added: string[] = []) => ({ path: p, added });
const hit = (p: string, added: string[] = []) =>
  classify([change(p, added)]).filter((r) => r.state !== "none");

describe("RULES", () => {
  it("are the seven surfaces, in the gate's order", () => {
    expect(RULES.map((r) => r.key)).toEqual(COLLATERAL_SURFACES);
  });
});

describe("classify — a path each surface must hit, and a near-miss it must not", () => {
  it.each([
    [
      "release-notes",
      "RELEASE_NOTES_UNRELEASED.md",
      "RELEASE_NOTES_UNRELEASED.md.bak",
    ],
    ["legal-content", "PRIVACY.md", "docs/PRIVACY.md"],
    ["legal-content", "public/licenses/lgpl-3.0.txt", "public/licensesx/a.txt"],
    [
      "legal-content",
      "src/components/about-panel.tsx",
      "src/components/about.tsx",
    ],
    [
      "help-articles",
      "docs/training/facilitator-runbook.md",
      "docs/trainings/a.md",
    ],
    ["help-articles", "docs/tester-install.md", "docs/tester-install.txt"],
    ["feature-doc", "AGENTS.md", "docs/AGENTS.md.bak"],
    ["feature-doc", "docs/decisions/0009-x.md", "docs/decisionsx/0009.md"],
    ["feature-doc", "docs/design/pivot-plan.md", "docs/designs/a.md"],
    ["schema-doc", "src/lib/storage/db.ts", "src/lib/storagex/db.ts"],
    ["schema-doc", "docs/release/promotion-v1.0.0.md", "docs/release/notes.md"],
    ["service-catalog", "wrangler.jsonc", "wrangler.json"],
    [
      "service-catalog",
      ".github/workflows/android-apk.yml",
      ".github/dependabot.yml",
    ],
    ["service-catalog", "capacitor.config.ts", "capacitor.config.json"],
    ["mobile-parity", "android/app/build.gradle", "docs/android/a.gradle"],
    ["mobile-parity", "ios/App/App/Info.plist", "docs/ios/a.plist"],
    ["mobile-parity", "src/hooks/audio-io.ts", "src/hooks/use-audio.ts"],
  ])("%s: hits %s, not %s", (key, yes, no) => {
    const keysFor = (p: string) =>
      hit(p)
        .filter((r) => r.state === "touched")
        .map((r) => r.key);
    expect(keysFor(yes)).toContain(key);
    expect(keysFor(no)).not.toContain(key);
  });

  it("names the paths that touched a surface", () => {
    const r = classify([change("AGENTS.md"), change("docs/design/a.md")]).find(
      (x) => x.key === "feature-doc"
    );
    expect(r?.state).toBe("touched");
    expect(r?.paths).toEqual(["AGENTS.md", "docs/design/a.md"]);
  });

  it("an empty diff touches nothing", () => {
    expect(classify([]).every((r) => r.state === "none")).toBe(true);
    expect(classify([])).toHaveLength(7);
  });

  it("a docs-only change to a runbook touches help-articles and not storage or parity", () => {
    const keys = hit("docs/training/facilitator-runbook.md").map((r) => r.key);
    expect(keys).toEqual(["help-articles"]);
  });
});

describe("classify — hints (`check`) for surfaces a diff may owe", () => {
  it("a src change with no release-notes edit says release-notes may be owed", () => {
    const r = classify([change("src/components/menu.tsx")]).find(
      (x) => x.key === "release-notes"
    );
    expect(r?.state).toBe("check");
  });

  it("a src change WITH a release-notes edit is touched, not a hint", () => {
    const r = classify([
      change("src/components/menu.tsx"),
      change("RELEASE_NOTES_UNRELEASED.md"),
    ]).find((x) => x.key === "release-notes");
    expect(r?.state).toBe("touched");
  });

  it("a tests-only or docs-only change raises no release-notes hint", () => {
    for (const p of [
      "tests/a.test.ts",
      "src/lib/a.test.ts",
      "docs/progress_tracker.md",
      "scripts/x.mjs",
    ]) {
      const r = classify([change(p)]).find((x) => x.key === "release-notes");
      expect(r?.state, p).toBe("none");
    }
  });

  it("a UI change asks for a mobile-parity statement", () => {
    for (const p of ["src/components/menu.tsx", "src/app/App.tsx"]) {
      const r = classify([change(p)]).find((x) => x.key === "mobile-parity");
      expect(r?.state, p).toBe("check");
    }
  });

  it("an added DB_VERSION line touches schema-doc even outside lib/storage", () => {
    const r = classify([
      change("src/hooks/x.ts", ["const DB_VERSION = 12;"]),
    ]).find((x) => x.key === "schema-doc");
    expect(r?.state).toBe("touched");
  });

  it("an added docblock line in src touches feature-doc; code alone does not", () => {
    const f = (added: string[]) =>
      classify([change("src/lib/x.ts", added)]).find(
        (x) => x.key === "feature-doc"
      )?.state;
    expect(f(["/** What this does. */"])).toBe("touched");
    expect(f(["// a note"])).toBe("touched");
    expect(f(["const x = 1;"])).toBe("none");
  });
});

describe("parseDiff", () => {
  it("reads paths and added lines from a zero-context diff, and ignores removals", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new line",
      "diff --git a/old name.md b/new name.md",
      "similarity index 100%",
      "rename from old name.md",
      "rename to new name.md",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    expect(parseDiff(diff)).toEqual([
      { path: "src/a.ts", added: ["new line"] },
      { path: "new name.md", oldPath: "old name.md", added: [] },
      { path: "gone.ts", added: [] },
    ]);
  });

  it("unquotes a header git C-quotes, and keeps a rename's source path", () => {
    const diff = [
      String.raw`diff --git "a/docs/training/caf\303\251.md" "b/docs/training/caf\303\251.md"`,
      "new file mode 100644",
      "--- /dev/null",
      String.raw`+++ "b/docs/training/caf\303\251.md"`,
      "@@ -0,0 +1 @@",
      "+hi",
      "diff --git a/x b/y.md b/x b/y.md",
      "diff --git a/PRIVACY.md b/docs/PRIVACY.md",
      "similarity index 100%",
      "rename from PRIVACY.md",
      "rename to docs/PRIVACY.md",
    ].join("\n");
    expect(parseDiff(diff)).toEqual([
      { path: "docs/training/café.md", added: ["hi"] },
      { path: "x b/y.md", added: [] },
      { path: "docs/PRIVACY.md", oldPath: "PRIVACY.md", added: [] },
    ]);
  });

  it("refuses a header it cannot read rather than dropping the file", () => {
    for (const h of ["AGENTS.md AGENTS.md", "i/AGENTS.md w/AGENTS.md"]) {
      expect(() => parseDiff(`diff --git ${h}`)).toThrow(/diff header/);
    }
  });

  it("a rename matches a path rule on either name", () => {
    const r = classify([
      { path: "docs/PRIVACY.md", oldPath: "PRIVACY.md", added: [] },
    ]).find((x) => x.key === "legal-content");
    expect(r?.state).toBe("touched");
    expect(r?.paths).toEqual(["PRIVACY.md → docs/PRIVACY.md"]);
  });

  it("does not take a '+++' content line for a file header", () => {
    const diff = [
      "diff --git a/a.md b/a.md",
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -0,0 +1 @@",
      "++++ four plus",
    ].join("\n");
    expect(parseDiff(diff)[0]?.added).toEqual(["+++ four plus"]);
  });
});

describe("formatReport", () => {
  it("prints seven Collateral lines, in order, each as a placeholder the gate refuses", async () => {
    const { checkBody } = await import("../scripts/check-pr-body.mjs");
    const text = formatReport(
      classify([change("AGENTS.md"), change("src/components/menu.tsx")])
    );
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.map((l) => (l.split(":")[0] ?? "").slice(2))).toEqual(
      COLLATERAL_SURFACES
    );
    // Pasted into a body unedited, every line must still fail: the author has
    // to write the answer, the script only says where to look.
    const missing = checkBody(`## Collateral\n\n${lines.join("\n")}\n`).filter(
      (m) => m.startsWith("Collateral:")
    );
    expect(missing).toHaveLength(7);
  });

  it("the same lines, once the author answers each, pass the gate (the legitimate state)", async () => {
    const { checkBody } = await import("../scripts/check-pr-body.mjs");
    const lines = formatReport(classify([change("AGENTS.md")]))
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => `${l.split(":")[0]}: N/A — nothing here changes it`);
    const missing = checkBody(`## Collateral\n\n${lines.join("\n")}\n`).filter(
      (m) => m.startsWith("Collateral:")
    );
    expect(missing).toEqual([]);
  });

  it("says which paths touched a surface", () => {
    const text = formatReport(classify([change("AGENTS.md")]));
    expect(text).toMatch(/feature-doc: <touched.*AGENTS\.md/);
  });
});

describe("CLI entry point (real subprocess)", () => {
  function run(args: string[], cwd: string) {
    try {
      const stdout = execFileSync("node", [SCRIPT, ...args], {
        encoding: "utf8",
        timeout: 15_000,
        cwd,
        env: cleanGitEnv(),
        stdio: ["ignore", "pipe", "pipe"],
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

  function withRepo<T>(fn: (dir: string) => T, name = "collateral-") {
    const dir = mkdtempSync(path.join(tmpdir(), name));
    try {
      const git = (...a: string[]) =>
        execFileSync("git", a, { cwd: dir, env: cleanGitEnv(), stdio: "pipe" });
      git("init", "-q", "-b", "develop");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      writeFileSync(path.join(dir, "a.txt"), "x\n");
      git("add", ".");
      git("commit", "-q", "-m", "base", "-m", "body");
      git("update-ref", "refs/remotes/origin/develop", "HEAD");
      git("checkout", "-q", "-b", "feat/x");
      mkdirSync(path.join(dir, "docs", "training"), { recursive: true });
      writeFileSync(path.join(dir, "docs", "training", "r.md"), "hello\n");
      writeFileSync(path.join(dir, "AGENTS.md"), "rules\n");
      git("add", ".");
      git("commit", "-q", "-m", "change", "-m", "body");
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("with no argument, diffs origin/develop...HEAD and prints seven lines", () =>
    withRepo((dir) => {
      const r = run([], dir);
      expect(r.status).toBe(0);
      const lines = r.stdout.split("\n").filter((l) => l.startsWith("- "));
      expect(lines).toHaveLength(7);
      expect(r.stdout).toMatch(
        /help-articles: <touched.*docs\/training\/r\.md/
      );
      expect(r.stdout).toMatch(/feature-doc: <touched.*AGENTS\.md/);
      expect(r.stdout).toMatch(/schema-doc: <no rule hit/);
    }));

  it("takes an explicit range", () =>
    withRepo((dir) => {
      const r = run(["origin/develop...feat/x"], dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/AGENTS\.md/);
    }));

  it("works from a path that contains a space, and through a symlink", () =>
    withRepo((dir) => {
      const link = path.join(dir, "linked.mjs");
      symlinkSync(SCRIPT, link);
      const out = execFileSync("node", [link], {
        encoding: "utf8",
        cwd: dir,
        env: cleanGitEnv(),
      });
      expect(out).toMatch(/AGENTS\.md/);
    }, "collateral with space "));

  it("reads real git output under diff.noprefix and diff.mnemonicPrefix: a quoted non-ASCII path and a rename source", () =>
    withRepo((dir) => {
      const git = (...a: string[]) =>
        execFileSync("git", a, { cwd: dir, env: cleanGitEnv(), stdio: "pipe" });
      writeFileSync(path.join(dir, "PRIVACY.md"), "one\ntwo\nthree\n");
      git("add", ".");
      git("commit", "-q", "-m", "privacy", "-m", "body");
      git("update-ref", "refs/remotes/origin/develop", "HEAD");
      git("mv", "PRIVACY.md", "docs/PRIVACY.md");
      writeFileSync(path.join(dir, "docs", "training", "café.md"), "hi\n");
      git("add", ".");
      git("commit", "-q", "-m", "move", "-m", "body");
      for (const cfg of [[], ["diff.noprefix"], ["diff.mnemonicPrefix"]]) {
        if (cfg[0]) git("config", cfg[0], "true");
        const r = run([], dir);
        expect(r.status, cfg[0]).toBe(0);
        expect(r.stdout, cfg[0]).toMatch(
          /legal-content: <touched: PRIVACY\.md → docs\/PRIVACY\.md/
        );
        expect(r.stdout, cfg[0]).toMatch(
          /help-articles: <touched: docs\/training\/café\.md/
        );
      }
    }));

  it("refuses a range git would read as an option", () =>
    withRepo((dir) => {
      const r = run(["--output=x"], dir);
      expect(r.status).toBe(1);
      expect(existsSync(path.join(dir, "x"))).toBe(false);
    }));

  it("exits 1 with a message for a range git cannot resolve, and for outside a repo", () =>
    withRepo((dir) => {
      const bad = run(["nope...alsonope"], dir);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/FAIL/);
      const outside = mkdtempSync(path.join(tmpdir(), "not-a-repo-"));
      try {
        const r = run([], outside);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/FAIL/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    }));
});
