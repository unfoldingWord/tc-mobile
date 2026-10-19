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

  it("mentions --no-verify and merging only to forbid them", () => {
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

  it("dev5 runs the body gate before opening, refuses on failure, and hands back the READY-FOR-REVIEW line", () => {
    const t = skill("dev5-ship");
    expect(t).toContain("npm run check:pr-body");
    expect(t).toContain("READY-FOR-REVIEW");
    expect(t).toMatch(/closingIssuesReferences/);
  });

  it("dev1 names the always-stop decision categories and the ruling format", () => {
    const t = skill("dev1-scope");
    expect(t).toContain("Ruling:");
    expect(t).toMatch(/Check:/);
  });

  it("dev2 plans the failing test before the implementation", () => {
    expect(skill("dev2-plan")).toMatch(/failing test/i);
  });

  it("dev6 validates a different agent's work and says what a develop merge deploys", () => {
    const t = skill("dev6-validate");
    expect(t).toMatch(/NEEDS-DEVICE/);
    expect(t).toMatch(/preview/);
  });
});
