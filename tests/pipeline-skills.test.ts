import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PROD_LINE_CAP } from "../scripts/check-pr-body.mjs";

/**
 * #1442. The seven stage skills exist, say how each stage ends, are not
 * swallowed by `.gitignore` (which ignores `.claude/skills/*` by default, so
 * a skill that is not un-ignored never reaches a PR), point at the scripts
 * that enforce what they ask, and do not restate the size cap (the number
 * lives in scripts/check-pr-body.mjs; a second copy is how rules disagree).
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const STAGES = [
  "dev1-scope",
  "dev2-plan",
  "dev3-build",
  "dev4-check",
  "dev5-ship",
  "dev6-validate",
  "dev7-close",
] as const;

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const skill = (name: string) => read(`.claude/skills/${name}/SKILL.md`);
const gitignore = read(".gitignore");
const agents = read("AGENTS.md");

describe.each(STAGES)("%s", (name) => {
  it("exists", () => {
    expect(
      existsSync(path.join(ROOT, ".claude", "skills", name, "SKILL.md"))
    ).toBe(true);
  });

  it("has frontmatter whose name is its directory and whose description is one line", () => {
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill(name));
    expect(m?.[1]).toBe(name);
    expect(m?.[2]?.length ?? 0).toBeGreaterThan(40);
  });

  it("states how the stage ends on an `Exit:` line", () => {
    expect(skill(name)).toMatch(/^Exit: \S/m);
  });

  it("is un-ignored in .gitignore", () => {
    expect(gitignore.split("\n")).toContain(`!.claude/skills/${name}/`);
  });

  it("is named in AGENTS.md", () => {
    expect(agents).toContain(`.claude/skills/${name}`);
  });

  it("does not restate the size cap", () => {
    expect(skill(name)).not.toMatch(new RegExp(`\\b${PROD_LINE_CAP}\\b`));
  });

  it("never mentions --no-verify, gh pr merge or --admin without a nearby never/not/no", () => {
    const text = skill(name);
    for (const m of text.matchAll(/--no-verify|gh pr merge|--admin/g)) {
      const before = text.slice(Math.max(0, m.index - 25), m.index);
      expect(before, m[0]).toMatch(/\b(?:never|not|no)\b/i);
    }
  });
});

describe("the stages point at the tooling that enforces them", () => {
  it("dev4 is a gate, runs verify, prepush, collateral and the body check, and does not review", () => {
    const t = skill("dev4-check");
    expect(t).toContain("gate, not a review");
    for (const cmd of [
      "npm run verify",
      "npm run check:prepush",
      "npm run collateral",
      "npm run check:pr-body",
    ]) {
      expect(t, cmd).toContain(cmd);
    }
  });

  it("dev5 names the body gate, the READY-FOR-REVIEW line and closingIssuesReferences", () => {
    const t = skill("dev5-ship");
    expect(t).toContain("npm run check:pr-body");
    expect(t).toContain("READY-FOR-REVIEW");
    expect(t).toMatch(/closingIssuesReferences/);
  });

  it("dev1 names the Ruling: format and Check: rows", () => {
    const t = skill("dev1-scope");
    expect(t).toContain("Ruling:");
    expect(t).toMatch(/Check:/);
  });

  it("dev2 plans the failing test before the implementation", () => {
    expect(skill("dev2-plan")).toMatch(/failing test/i);
  });

  it("dev6 names the NEEDS-DEVICE verdict and the preview build a develop merge reaches", () => {
    const t = skill("dev6-validate");
    expect(t).toMatch(/NEEDS-DEVICE/);
    expect(t).toMatch(/preview/);
  });
});

describe("the exits that gate the next stage", () => {
  it("dev4 treats a missing collateral script as not a FAIL", () => {
    const t = skill("dev4-check");
    expect(t).toMatch(/package\.json/);
    expect(t).toMatch(/not a FAIL/);
  });

  it("dev4's PASS carries the SHA from git rev-parse HEAD, and a later commit voids it", () => {
    const t = skill("dev4-check");
    expect(t).toContain("git rev-parse HEAD");
    expect(t).toMatch(/PASS <sha>/);
    expect(t).toMatch(/voids/);
  });

  it("dev5 refuses gh pr create unless HEAD equals dev4's SHA", () => {
    const t = skill("dev5-ship");
    expect(t).toMatch(/refuse/i);
    expect(t).toMatch(/HEAD/);
    expect(t).toMatch(/dev4/);
    expect(t).toMatch(/SHA/);
  });

  it("dev6 sends a FAIL to dev3-build and never to dev7-close", () => {
    const t = skill("dev6-validate");
    const exit = t.slice(t.indexOf("Exit:"));
    expect(exit).toContain("dev3-build");
    expect(exit).toMatch(/never[^.]*dev7|dev7[^.]*never/i);
  });

  it("dev7 closes on a recorded device check only with the needs-device label, and never on a FAIL", () => {
    const t = skill("dev7-close");
    expect(t).toContain("needs-device");
    expect(t).toMatch(/never[^.]*FAIL|FAIL[^.]*never/i);
  });

  it("no skill tells an agent to post a session link or carries a session URL", () => {
    for (const n of STAGES) {
      expect(skill(n), n).not.toMatch(
        /session (?:link|line)|session_|claude\.ai/i
      );
    }
  });

  it("no skill names a person or a reviewer", () => {
    for (const n of STAGES) {
      expect(skill(n), n).not.toMatch(/\b(?:tim|seth|frank|george)\b/i);
    }
  });
});
