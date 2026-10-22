import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { region, stripHtmlComments, uniqueIndexOf } from "./support";

// #1636: whether a native lane built a commit, and whether it may be
// dispatched again, is decided by scripts/check-redispatch.mjs and nowhere
// else. #1613 tried to keep that rule as prose in two places and every review
// round found the copies and the commands disagreeing. These pins keep the
// tc-release skill and the runbook's §3a step 7 as pointers: each names the
// script once and carries none of the old rule's working parts.

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) =>
  stripHtmlComments(readFileSync(path.join(ROOT, p), "utf8"));

/** The building blocks of the prose rule #1613 carried. */
const RULE_PARTS = [
  "gh run list",
  "gh run view",
  "/actions/runs/",
  "android-apk-",
  "--limit",
  "conclusion",
  "skipped",
  "two reads",
  "Already built",
];

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("the tc-release skill points at the script and holds no second rule", () => {
  const skill = read(".claude/skills/tc-release/SKILL.md");

  it("names the script exactly once", () => {
    expect(count(skill, "npm run check:redispatch")).toBe(1);
  });

  it.each(RULE_PARTS)("carries no %s", (part) => {
    expect(skill).not.toContain(part);
  });

  it("keeps the dispatch human-only", () => {
    const at = uniqueIndexOf(skill, "- [ ] Human-only: a dispatch");
    const bullet = region(skill, {
      from: at,
      to: skill.indexOf("\n- [ ]", at + 1),
    });
    expect(bullet).toContain("OK to dispatch <lane>");
  });
});

describe("runbook §3a step 7 points at the script and holds no second rule", () => {
  const runbook = read("docs/release/promotion-v1.0.0.md");
  const step7 = region(runbook, {
    from: uniqueIndexOf(runbook, "7. **Native builds from one commit.**"),
    to: uniqueIndexOf(runbook, "8. **Check the APK before publishing.**"),
  });

  it("names the script exactly once", () => {
    expect(count(step7, "npm run check:redispatch")).toBe(1);
  });

  it.each(RULE_PARTS)("carries no %s", (part) => {
    expect(step7).not.toContain(part);
  });

  it("keeps the dispatch the DRI's, human-only", () => {
    expect(step7).toContain(
      "The DRI\n   dispatches a lane (human-only) only after"
    );
  });
});

describe("the script is reachable by its documented command", () => {
  it("package.json runs scripts/check-redispatch.mjs", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    expect(pkg.scripts["check:redispatch"]).toBe(
      "node scripts/check-redispatch.mjs"
    );
  });

  it("AGENTS.md Commands names it", () => {
    const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
    const commands = region(agents, {
      from: uniqueIndexOf(agents, "## Commands"),
      to: uniqueIndexOf(agents, "## Architecture"),
    });
    expect(commands).toContain("npm run check:redispatch -- --lane");
  });
});
