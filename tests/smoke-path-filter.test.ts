import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The browser-smoke path filter, gated in both states (QA review P2 on #457).
 *
 * `ci.yml`'s "Changed paths" step decides whether the Headless-Chromium Smoke
 * job runs at all, and its failure mode is silent: a skipped browser gate looks
 * exactly like a passing one. So the filter itself has to be tested, and it had
 * not been.
 *
 * It has now been wrong twice by enumeration. Round 1 of #251 covered only
 * `src/hooks/` and `vite.config.ts`, which would have skipped the suite for
 * #236/#240's `db.ts` changes (Frank C2). #457 then enumerated the theme
 * suite's dependencies and still missed four — `src/app/globals.css`,
 * `src/app/App.tsx`, `src/components/menu.tsx`, `src/components/control.tsx` —
 * every one of which can break the user-visible theme. Hence `src/`, and hence
 * this file.
 *
 * WHAT IT ACTUALLY RUNS. Not a reimplementation of the regex: it extracts the
 * literal pattern out of `ci.yml` and hands it to the same `grep -qE` the
 * workflow runs, with the same `<<<` here-string. A test that re-typed the
 * pattern would pass while the workflow's own copy rotted, which is the defect
 * class AGENTS.md calls out for gate scripts — "test a gate script's entry path
 * and defaults, not just its exported function".
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  path.join(ROOT, ".github", "workflows", "ci.yml"),
  "utf8"
);

/** The pattern exactly as `ci.yml` spells it, single quotes stripped. */
function smokeFilter(): string {
  const line = /if grep -qE '([^']+)' <<<"\$changed"; then/.exec(workflow);
  if (!line?.[1]) throw new Error("no smoke path filter found in ci.yml");
  return line[1];
}

/** Ask the real `grep -qE` whether this path trips the gate. */
function triggersSmoke(filePath: string): boolean {
  try {
    execFileSync("grep", ["-qE", smokeFilter()], {
      input: `${filePath}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

describe("the browser-smoke path filter (#457 QA P2)", () => {
  it("is still in ci.yml where this test reads it from", () => {
    // If the step is rewritten or the quoting changes, fail loudly here rather
    // than silently asserting nothing.
    expect(() => smokeFilter()).not.toThrow();
    expect(smokeFilter()).toContain("src/");
  });

  // THE POSITIVE HALF. Every path the suite genuinely depends on. The four at
  // the end are the ones the enumerated filter missed — they are listed by
  // name, not covered incidentally by `src/`, so that a future narrowing has
  // to delete a named assertion rather than quietly shrink a prefix.
  const mustRun = [
    // The harness specs' own subjects (#251).
    "src/hooks/mp3-codec.ts",
    "src/lib/audio/mp3-align.ts",
    "src/lib/storage/db.ts",
    "src/app/e2e-harness.ts",
    "src/app/main.tsx",
    // The theme suite's subjects (#171).
    "src/lib/theme.ts",
    "src/hooks/use-theme.ts",
    "src/components/books-screen.tsx",
    "src/lib/i18n/en.ts",
    "src/app/styles/2-semantic.css",
    "index.html",
    // The four the enumerated filter skipped (the QA finding).
    "src/app/globals.css",
    "src/app/App.tsx",
    "src/components/menu.tsx",
    "src/components/control.tsx",
    // The suite and its harness config.
    "e2e/theme-toggle.spec.ts",
    "playwright.config.ts",
    "vite.config.ts",
    "package.json",
    "package-lock.json",
  ];

  for (const filePath of mustRun) {
    it(`runs the smoke for ${filePath}`, () => {
      expect(triggersSmoke(filePath)).toBe(true);
    });
  }

  // THE NEGATIVE HALF — the part AGENTS.md records three tooling PRs skipping.
  // A filter that matched everything would pass every assertion above and be
  // useless, and AGENTS.md separately requires `docs/**` and `*.md` not to burn
  // builds.
  const mustNotRun = [
    "docs/progress_tracker.md",
    "docs/design/pivot-plan.md",
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "scripts/check-deploy.mjs",
    "scripts/review/both.sh",
    "wrangler.toml",
    ".gitignore",
    "LICENSE",
  ];

  for (const filePath of mustNotRun) {
    it(`does NOT run the smoke for ${filePath}`, () => {
      expect(triggersSmoke(filePath)).toBe(false);
    });
  }

  // `tests/**` is deliberately absent from BOTH lists above and asserted here
  // on its own, because it is the one judgement call. The Node suite runs in
  // the Code Quality job on every PR regardless, and no Playwright spec imports
  // from `tests/`, so a unit-test-only change cannot affect the browser suite.
  it("does not run the smoke for a Node-only test change", () => {
    expect(triggersSmoke("tests/theme.test.ts")).toBe(false);
    expect(triggersSmoke("tests/contrast.test.ts")).toBe(false);
  });

  it("is anchored, so a path is matched at its start and not anywhere inside", () => {
    // `^` matters: without it, `vendor/src/x.ts` or a doc that merely mentions
    // a path would trip the gate. Cheap to assert, and the kind of thing a
    // hand-edit drops.
    expect(smokeFilter().startsWith("^(")).toBe(true);
    expect(triggersSmoke("vendor/src/thing.ts")).toBe(false);
    expect(triggersSmoke("docs/src/notes.md")).toBe(false);
  });
});
